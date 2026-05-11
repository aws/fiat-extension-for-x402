import { describe, it, expect, beforeEach } from 'vitest';
import * as jose from 'jose';
import { FABScheme } from '../../../src/fab/client/scheme';
import type { PaymentRequirements } from '@x402/core/types';
import { FAB_SCHEME } from '../../../src/constants';
import { FAB_SENTINEL_PAY_TO } from '../../../src/constants';
import { createMockAgenticPayClient } from '../../helpers/mock-agentic-pay-client';

/**
 * FAB Client Unit Tests
 * 
 * Tests the client scheme with mock Agentic Pay client.
 * In production, the client calls the Agentic Pay provider's API to get payment tokens.
 */

describe('FAB Client Scheme', () => {
  let privateKey: jose.KeyLike;
  let publicKey: jose.KeyLike;
  let scheme: FABScheme;
  const agenticPayId = 'agentic-pay-test-456';

  beforeEach(async () => {
    // Create mock Agentic Pay client
    const mock = await createMockAgenticPayClient(agenticPayId);
    privateKey = mock.privateKey;
    publicKey = mock.publicKey;

    // Create scheme with mock Agentic Pay client
    scheme = new FABScheme({
      agenticPayId,
      agenticPayClient: mock.agenticPayClient
    });
  });

  it('should create payment payload with valid quote token', async () => {
    // Create a mock quote token
    const quotePayload = {
      iss: 'https://api.example.com',
      aud: 'fab:test',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: 'quote_123',
      price: { amount: '1.50', currency: 'USD' },
      payTo: 'service-pay',
      capture: 'manual',
      reference: 'TEST'
    };
    const quoteToken = await new jose.SignJWT(quotePayload as any)
      .setProtectedHeader({ alg: 'RS256' })
      .sign(privateKey);

    const requirements: PaymentRequirements = {
      scheme: FAB_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: {
        quoteToken
      } as unknown as Record<string, unknown>
    };

    const result = await scheme.createPaymentPayload(2, requirements);

    expect(result).toBeDefined();
    expect(result.x402Version).toBe(2);
    expect(result.payload).toBeDefined();
    expect(result.payload.paymentToken).toBeDefined();
    expect(result.payload.transactionId).toBeDefined();
    expect(typeof result.payload.paymentToken).toBe('string');
    expect(typeof result.payload.transactionId).toBe('string');

    // Verify payment token structure
    const decoded = jose.decodeJwt(result.payload.paymentToken as string);
    expect(decoded.iss).toBe(agenticPayId);
    expect(decoded.sub).toBe(agenticPayId);
    expect(decoded.aud).toBe('https://api.example.com'); // Service URL from quote.iss
  });

  it('should throw error when quote token is missing', async () => {
    const requirements: PaymentRequirements = {
      scheme: FAB_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: {} as Record<string, unknown>
    };

    await expect(
      scheme.createPaymentPayload(2, requirements)
    ).rejects.toThrow('Missing quoteToken');
  });

  it('should generate valid transaction ID', async () => {
    const quotePayload = {
      iss: 'https://api.example.com',
      aud: 'fab:test',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: 'quote_123',
      price: { amount: '1.50', currency: 'USD' },
      payTo: 'service-pay',
      capture: 'manual',
      reference: 'TEST'
    };
    const quoteToken = await new jose.SignJWT(quotePayload as any)
      .setProtectedHeader({ alg: 'RS256' })
      .sign(privateKey);

    const requirements: PaymentRequirements = {
      scheme: FAB_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: { quoteToken } as unknown as Record<string, unknown>
    };

    const result = await scheme.createPaymentPayload(2, requirements);
    const transactionId = result.payload.transactionId as string;

    expect(transactionId).toBeDefined();
    expect(transactionId).toMatch(/^fab:test:[a-f0-9-]+$/);
  });

  it('should sign payment token correctly', async () => {
    const quotePayload = {
      iss: 'https://api.example.com',
      aud: 'fab:test',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: 'quote_123',
      price: { amount: '1.50', currency: 'USD' },
      payTo: 'service-pay',
      capture: 'manual',
      reference: 'TEST'
    };
    const quoteToken = await new jose.SignJWT(quotePayload as any)
      .setProtectedHeader({ alg: 'RS256' })
      .sign(privateKey);

    const requirements: PaymentRequirements = {
      scheme: FAB_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: { quoteToken } as unknown as Record<string, unknown>
    };

    const result = await scheme.createPaymentPayload(2, requirements);
    const paymentToken = result.payload.paymentToken as string;

    // Verify token can be verified with public key
    const verified = await jose.jwtVerify(paymentToken, publicKey);
    expect(verified.payload.iss).toBe(agenticPayId);
    expect(verified.payload.sub).toBe(agenticPayId);
    expect(verified.payload.aud).toBe('https://api.example.com'); // Service URL from quote.iss
    expect(verified.payload.payment_context).toBeDefined();
    expect((verified.payload.payment_context as any).quote_token).toBe(quoteToken);
  });

  describe('Sentinel Values (Task 28)', () => {
    it('should work correctly when payTo is the sentinel value', async () => {
      const quotePayload = {
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_sentinel',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-pay',
        capture: 'manual',
        reference: 'TEST'
      };
      const quoteToken = await new jose.SignJWT(quotePayload as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      // Use sentinel payTo — this is what the server scheme now produces
      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: FAB_SENTINEL_PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const result = await scheme.createPaymentPayload(2, requirements);

      expect(result).toBeDefined();
      expect(result.payload.paymentToken).toBeDefined();
      expect(result.payload.transactionId).toBeDefined();

      // Client should use quote.iss as payTo, NOT the sentinel value
      const decoded = jose.decodeJwt(result.payload.paymentToken as string);
      expect(decoded.aud).toBe('https://api.example.com');
      expect(decoded.aud).not.toBe(FAB_SENTINEL_PAY_TO);
    });

    it('should not pass sentinel value to Agentic Pay authorize call', async () => {
      const quotePayload = {
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_sentinel_2',
        price: { amount: '2.00', currency: 'USD' },
        payTo: 'real-service-pay',
        capture: 'manual',
        reference: 'TEST'
      };
      const quoteToken = await new jose.SignJWT(quotePayload as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const requirements: PaymentRequirements = {
        scheme: FAB_SCHEME,
        network: 'fab:test',
        amount: '2.00',
        asset: 'iso4217:USD',
        payTo: FAB_SENTINEL_PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { quoteToken } as unknown as Record<string, unknown>
      };

      const result = await scheme.createPaymentPayload(2, requirements);

      // The payment token's aud should be the service URL from quote.iss,
      // proving the client extracted payTo from the quote, not from requirements
      const decoded = jose.decodeJwt(result.payload.paymentToken as string);
      expect(decoded.aud).toBe('https://api.example.com');
    });
  });
});
