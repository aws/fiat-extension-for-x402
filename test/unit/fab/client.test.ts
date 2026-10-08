// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest';
import * as jose from 'jose';
import { AgentPayScheme } from '../../../src/agent-pay/client/scheme';
import type { PaymentRequirements } from '@x402/core/types';
import { AGENT_PAY_SCHEME } from '../../../src/constants';
import { AGENT_PAY_SENTINEL_PAY_TO } from '../../../src/constants';
import { createMockAgentPayClient } from '../../helpers/mock-agent-pay-client';

/**
 * Agent Pay Client Unit Tests
 *
 * Tests the client scheme with mock Agent Pay client.
 * The client sends the quote token to the Agent Pay Service and receives
 * a signed payment JWT in return.
 */

describe('Agent Pay Client Scheme', () => {
  let privateKey: jose.KeyLike;
  let publicKey: jose.KeyLike;
  let scheme: AgentPayScheme;
  const agentPayId = 'agent-pay-test-456';

  beforeEach(async () => {
    const mock = await createMockAgentPayClient(agentPayId);
    privateKey = mock.privateKey;
    publicKey = mock.publicKey;

    scheme = new AgentPayScheme({
      agentPayId,
      agentPayClient: mock.agentPayClient,
    });
  });

  it('should create payment payload with valid quote token', async () => {
    const quotePayload = {
      iss: 'https://api.example.com',
      aud: 'fab:test',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: 'quote_123',
      price: { amount: '1.50', currency: 'USD' },
      payTo: 'service-pay',
      capture: 'manual',
      reference: 'TEST',
    };
    const quoteToken = await new jose.SignJWT(quotePayload as any)
      .setProtectedHeader({ alg: 'RS256' })
      .sign(privateKey);

    const requirements: PaymentRequirements = {
      scheme: AGENT_PAY_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: { quoteToken } as unknown as Record<string, unknown>,
    };

    const result = await scheme.createPaymentPayload(2, requirements);

    expect(result).toBeDefined();
    expect(result.x402Version).toBe(2);
    expect(result.payload).toBeDefined();
    expect(result.payload.paymentToken).toBeDefined();
    expect(result.payload.paymentId).toBeDefined();
    // Backward compat: transactionId is also set
    expect(result.payload.transactionId).toBe(result.payload.paymentId);
    expect(typeof result.payload.paymentToken).toBe('string');

    // Verify payment token structure (Agent Pay format)
    const decoded = jose.decodeJwt(result.payload.paymentToken as string);
    expect(decoded.iss).toBe('awsmp-agentpay.amazonaws.com');
    expect(decoded.sub).toBe(agentPayId);
    expect(decoded.payment_id).toBeDefined();
  });

  it('should throw error when quote token is missing', async () => {
    const requirements: PaymentRequirements = {
      scheme: AGENT_PAY_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: {} as Record<string, unknown>,
    };

    await expect(scheme.createPaymentPayload(2, requirements)).rejects.toThrow(
      'Missing quoteToken'
    );
  });

  it('should generate valid payment ID in awsmp format', async () => {
    const quotePayload = {
      iss: 'https://api.example.com',
      aud: 'fab:test',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: 'quote_123',
      price: { amount: '1.50', currency: 'USD' },
      payTo: 'service-pay',
      capture: 'manual',
      reference: 'TEST',
    };
    const quoteToken = await new jose.SignJWT(quotePayload as any)
      .setProtectedHeader({ alg: 'RS256' })
      .sign(privateKey);

    const requirements: PaymentRequirements = {
      scheme: AGENT_PAY_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: { quoteToken } as unknown as Record<string, unknown>,
    };

    const result = await scheme.createPaymentPayload(2, requirements);
    const paymentId = result.payload.paymentId as string;

    expect(paymentId).toBeDefined();
    expect(paymentId).toMatch(/^awsmp-/);
  });

  it('should produce verifiable payment token', async () => {
    const quotePayload = {
      iss: 'https://api.example.com',
      aud: 'fab:test',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
      jti: 'quote_123',
      price: { amount: '1.50', currency: 'USD' },
      payTo: 'service-pay',
      capture: 'manual',
      reference: 'TEST',
    };
    const quoteToken = await new jose.SignJWT(quotePayload as any)
      .setProtectedHeader({ alg: 'RS256' })
      .sign(privateKey);

    const requirements: PaymentRequirements = {
      scheme: AGENT_PAY_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: { quoteToken } as unknown as Record<string, unknown>,
    };

    const result = await scheme.createPaymentPayload(2, requirements);
    const paymentToken = result.payload.paymentToken as string;

    // Verify token can be verified with Agent Pay's public key
    const verified = await jose.jwtVerify(paymentToken, publicKey);
    expect(verified.payload.iss).toBe('awsmp-agentpay.amazonaws.com');
    expect(verified.payload.sub).toBe(agentPayId);
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
        reference: 'TEST',
      };
      const quoteToken = await new jose.SignJWT(quotePayload as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      // Use sentinel payTo — this is what the server scheme produces
      const requirements: PaymentRequirements = {
        scheme: AGENT_PAY_SCHEME,
        network: 'fab:test',
        amount: '1.50',
        asset: 'iso4217:USD',
        payTo: AGENT_PAY_SENTINEL_PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { quoteToken } as unknown as Record<string, unknown>,
      };

      const result = await scheme.createPaymentPayload(2, requirements);

      expect(result).toBeDefined();
      expect(result.payload.paymentToken).toBeDefined();
      expect(result.payload.paymentId).toBeDefined();

      // Client sends only the quoteToken to Agent Pay — sentinel payTo is irrelevant
      const decoded = jose.decodeJwt(result.payload.paymentToken as string);
      expect(decoded.iss).toBe('awsmp-agentpay.amazonaws.com');
    });

    it('should not pass sentinel value to Agent Pay — only sends quoteToken', async () => {
      const quotePayload = {
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_sentinel_2',
        price: { amount: '2.00', currency: 'USD' },
        payTo: 'real-service-pay',
        capture: 'manual',
        reference: 'TEST',
      };
      const quoteToken = await new jose.SignJWT(quotePayload as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const requirements: PaymentRequirements = {
        scheme: AGENT_PAY_SCHEME,
        network: 'fab:test',
        amount: '2.00',
        asset: 'iso4217:USD',
        payTo: AGENT_PAY_SENTINEL_PAY_TO,
        maxTimeoutSeconds: 300,
        extra: { quoteToken } as unknown as Record<string, unknown>,
      };

      const result = await scheme.createPaymentPayload(2, requirements);

      // The payment token embeds the quote token in payment_context,
      // proving Agent Pay received and processed it correctly
      const decoded = jose.decodeJwt(result.payload.paymentToken as string);
      expect((decoded.payment_context as any).quote_token).toBe(quoteToken);
    });
  });
});
