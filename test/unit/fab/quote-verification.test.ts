/**
 * Quote Token Signature Verification Tests (Task 27)
 * 
 * Tests that the in-process facilitator MANDATORILY verifies quote token
 * signatures using the service's JWKS endpoint.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as jose from 'jose';
import { verifyPayment } from '../../../src/agent-pay/facilitator/verify';
import { clearServiceJWKSCache } from '../../../src/utils';
import type { AgentPayClientForFacilitator } from '../../../src/config';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import type { AgentPayPayloadV2 } from '../../../src/types';
import { AGENT_PAY_SCHEME } from '../../../src/constants';

describe('Quote Token Signature Verification (Task 27)', () => {
  let servicePrivateKey: jose.KeyLike;
  let servicePublicKey: jose.KeyLike;
  let servicePublicJWK: jose.JWK;
  let agentPayPrivateKey: jose.KeyLike;
  let agentPayPublicKey: jose.KeyLike;
  let mockAgentPayClient: AgentPayClientForFacilitator;
  const serviceUrl = 'https://api.example.com';

  // Mock fetch for JWKS endpoints
  const mockFetch = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    clearServiceJWKSCache();

    // Generate service key pair (for quote token signing)
    const serviceKeys = await jose.generateKeyPair('RS256');
    servicePrivateKey = serviceKeys.privateKey;
    servicePublicKey = serviceKeys.publicKey;
    servicePublicJWK = await jose.exportJWK(servicePublicKey);
    servicePublicJWK.kid = 'service-key-1';
    servicePublicJWK.alg = 'RS256';
    servicePublicJWK.use = 'sig';

    // Generate Agent Pay key pair (for payment token signing)
    const apKeys = await jose.generateKeyPair('RS256');
    agentPayPrivateKey = apKeys.privateKey;
    agentPayPublicKey = apKeys.publicKey;

    // Mock Agent Pay client that verifies payment tokens
    mockAgentPayClient = {
      verifyPaymentToken: async (token: string) => {
        const { payload } = await jose.jwtVerify(token, agentPayPublicKey);
        return {
          iss: payload.iss as string,
          sub: payload.sub as string | undefined,
          aud: payload.aud as string | undefined,
          iat: payload.iat as number,
          exp: payload.exp as number,
          payment_id: (payload.payment_id as string) || '',
          payment_context: payload.payment_context as any,
          cnf: payload.cnf as any,
        };
      },
    };

    // Default: service JWKS endpoint returns the service's public key
    mockFetch.mockImplementation(async (url: string) => {
      if (url === `${serviceUrl}/.well-known/jwks.json`) {
        return {
          ok: true,
          json: async () => ({ keys: [servicePublicJWK] }),
        };
      }
      return { ok: false, statusText: 'Not Found' };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearServiceJWKSCache();
  });

  async function createQuoteToken(overrides: Record<string, unknown> = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: serviceUrl,
      aud: 'aws-marketplace',
      iat: now,
      exp: now + 300,
      jti: 'quote-test-001',
      price: { amount: '0.10', currency: 'USD' },
      payTo: 'seller-123',
      capture: 'auto',
      reference: 'TEST',
      ...overrides,
    };
    return new jose.SignJWT(payload as any)
      .setProtectedHeader({ alg: 'RS256', kid: 'service-key-1' })
      .sign(servicePrivateKey);
  }

  async function createPaymentToken(quoteToken: string, paymentId: string): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    return new jose.SignJWT({
      iss: 'awsmp-agentpay.amazonaws.com',
      sub: 'buyer-123',
      iat: now,
      exp: now + 3600,
      payment_id: paymentId,
      payment_context: { transaction_id: paymentId, quote_token: quoteToken },
    } as any)
      .setProtectedHeader({ alg: 'RS256' })
      .sign(agentPayPrivateKey);
  }

  function buildPayloadAndRequirements(quoteToken: string, paymentToken: string, paymentId: string) {
    const payload: PaymentPayload = {
      x402Version: 2,
      payload: { paymentToken, paymentId, transactionId: paymentId } as unknown as Record<string, unknown>,
    };
    const requirements: PaymentRequirements = {
      scheme: AGENT_PAY_SCHEME,
      network: 'aws:base',
      amount: '0.10',
      asset: 'iso4217:USD',
      payTo: 'urn:x402:agent-pay:see-quote',
      maxTimeoutSeconds: 300,
      extra: { quoteToken } as unknown as Record<string, unknown>,
    };
    const apPayload: AgentPayPayloadV2 = { paymentToken, paymentId, transactionId: paymentId };
    return { payload, requirements, apPayload };
  }

  it('should succeed when quote token is signed by service and JWKS is reachable', async () => {
    const quoteToken = await createQuoteToken();
    const paymentId = 'awsmp-00000000-0000-0000-0000-000000000001';
    const paymentToken = await createPaymentToken(quoteToken, paymentId);
    const { payload, requirements, apPayload } = buildPayloadAndRequirements(quoteToken, paymentToken, paymentId);

    const result = await verifyPayment(mockAgentPayClient, payload, requirements, apPayload);

    expect(result.isValid).toBe(true);
    expect(result.payer).toBe('buyer-123');
  });

  it('should fail with invalid_quote when quote token signature does not match service key', async () => {
    // Sign quote with a DIFFERENT key than what the JWKS endpoint returns
    const wrongKeys = await jose.generateKeyPair('RS256');
    const quoteToken = await new jose.SignJWT({
      iss: serviceUrl,
      aud: 'aws-marketplace',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: 'quote-bad-sig',
      price: { amount: '0.10', currency: 'USD' },
      payTo: 'seller-123',
      capture: 'auto',
      reference: 'TEST',
    } as any).setProtectedHeader({ alg: 'RS256' }).sign(wrongKeys.privateKey);

    const paymentId = 'awsmp-00000000-0000-0000-0000-000000000002';
    const paymentToken = await createPaymentToken(quoteToken, paymentId);
    const { payload, requirements, apPayload } = buildPayloadAndRequirements(quoteToken, paymentToken, paymentId);

    const result = await verifyPayment(mockAgentPayClient, payload, requirements, apPayload);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe('invalid_quote');
    expect(result.invalidMessage).toContain('Quote token signature verification failed');
  });

  it('should fail with invalid_quote when service JWKS endpoint returns non-200', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('jwks.json')) {
        return { ok: false, statusText: 'Service Unavailable' };
      }
      return { ok: false, statusText: 'Not Found' };
    });

    const quoteToken = await createQuoteToken();
    const paymentId = 'awsmp-00000000-0000-0000-0000-000000000003';
    const paymentToken = await createPaymentToken(quoteToken, paymentId);
    const { payload, requirements, apPayload } = buildPayloadAndRequirements(quoteToken, paymentToken, paymentId);

    const result = await verifyPayment(mockAgentPayClient, payload, requirements, apPayload);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe('invalid_quote');
    expect(result.invalidMessage).toContain('Quote token signature verification failed');
  });

  it('should fail with invalid_quote when quote token iss is missing', async () => {
    // Create quote token without iss
    const now = Math.floor(Date.now() / 1000);
    const quoteToken = await new jose.SignJWT({
      aud: 'aws-marketplace',
      iat: now,
      exp: now + 300,
      jti: 'quote-no-iss',
      price: { amount: '0.10', currency: 'USD' },
      payTo: 'seller-123',
      capture: 'auto',
      reference: 'TEST',
    } as any).setProtectedHeader({ alg: 'RS256' }).sign(servicePrivateKey);

    const paymentId = 'awsmp-00000000-0000-0000-0000-000000000004';
    const paymentToken = await createPaymentToken(quoteToken, paymentId);
    const { payload, requirements, apPayload } = buildPayloadAndRequirements(quoteToken, paymentToken, paymentId);

    const result = await verifyPayment(mockAgentPayClient, payload, requirements, apPayload);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe('invalid_quote');
    expect(result.invalidMessage).toContain('missing issuer (iss) claim');
  });

  it('should fail with quote_expired when quote token exp is in the past', async () => {
    const pastTime = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
    const quoteToken = await createQuoteToken({
      iat: pastTime - 300,
      exp: pastTime, // expired
    });

    const paymentId = 'awsmp-00000000-0000-0000-0000-000000000005';
    const paymentToken = await createPaymentToken(quoteToken, paymentId);
    const { payload, requirements, apPayload } = buildPayloadAndRequirements(quoteToken, paymentToken, paymentId);

    const result = await verifyPayment(mockAgentPayClient, payload, requirements, apPayload);

    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe('quote_expired');
    expect(result.invalidMessage).toContain('Quote token expired');
  });

  it('should succeed when quote token exp is in the future', async () => {
    const quoteToken = await createQuoteToken({
      exp: Math.floor(Date.now() / 1000) + 600, // 10 minutes from now
    });

    const paymentId = 'awsmp-00000000-0000-0000-0000-000000000006';
    const paymentToken = await createPaymentToken(quoteToken, paymentId);
    const { payload, requirements, apPayload } = buildPayloadAndRequirements(quoteToken, paymentToken, paymentId);

    const result = await verifyPayment(mockAgentPayClient, payload, requirements, apPayload);

    expect(result.isValid).toBe(true);
  });

  it('should use serviceJWKSUrl override when provided', async () => {
    const customJwksUrl = 'https://keys.example.com';
    mockFetch.mockImplementation(async (url: string) => {
      if (url === `${customJwksUrl}/.well-known/jwks.json`) {
        return { ok: true, json: async () => ({ keys: [servicePublicJWK] }) };
      }
      // The default serviceUrl JWKS should NOT be called
      if (url === `${serviceUrl}/.well-known/jwks.json`) {
        return { ok: false, statusText: 'Should not be called' };
      }
      return { ok: false, statusText: 'Not Found' };
    });

    const quoteToken = await createQuoteToken();
    const paymentId = 'awsmp-00000000-0000-0000-0000-000000000007';
    const paymentToken = await createPaymentToken(quoteToken, paymentId);
    const { payload, requirements, apPayload } = buildPayloadAndRequirements(quoteToken, paymentToken, paymentId);

    const result = await verifyPayment(mockAgentPayClient, payload, requirements, apPayload, {
      serviceJWKSUrl: customJwksUrl,
    });

    expect(result.isValid).toBe(true);
  });
});
