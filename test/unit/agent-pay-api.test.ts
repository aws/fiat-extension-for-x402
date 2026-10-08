// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for Agent Pay API integration (Tasks 32-37)
 *
 * Covers:
 * - CreateAgentPayment API shape
 * - Client token (idempotency)
 * - DPoP key binding (toDpopJwk)
 * - Auto-capture (no settle call)
 * - Quote token extensions (description, dimensions)
 * - DEFAULT_NETWORK constant
 * - IdempotencyConflictError
 */

import { describe, it, expect } from 'vitest';
import * as jose from 'jose';
import { createMockAgentPayClient } from '../helpers/mock-agent-pay-client';
import { AgentPayScheme as AgentPayClientSchemeImpl } from '../../src/agent-pay/client/scheme';
import { AgentPayScheme as AgentPayServerSchemeImpl } from '../../src/agent-pay/server/scheme';
import { settlePayment } from '../../src/agent-pay/facilitator/settle';
import { generateDPoPKeyPair, toDpopJwk } from '../../src/dpop';
import {
  DEFAULT_NETWORK,
  AGENT_PAY_SCHEME,
  DEFAULT_QUOTE_VALIDITY_SECONDS,
} from '../../src/constants';
import { IdempotencyConflictError, ValidationError } from '../../src/types';
import type { PaymentRequirements } from '@x402/core/types';

describe('Agent Pay API Integration', () => {
  describe('Task 32: CreateAgentPayment API shape', () => {
    it('client sends only quoteToken, clientToken, dpopJwk to Agent Pay', async () => {
      const mock = await createMockAgentPayClient('test-pay');
      const scheme = new AgentPayClientSchemeImpl({
        agentPayId: 'test-pay',
        agentPayClient: mock.agentPayClient,
      });

      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'aws-marketplace',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'q1',
        price: { amount: '0.01', currency: 'USD' },
        payTo: 'seller',
        capture: 'auto',
        reference: 'TEST',
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(mock.privateKey);

      const requirements: PaymentRequirements = {
        scheme: AGENT_PAY_SCHEME,
        network: 'aws:base',
        amount: '0.01',
        asset: 'iso4217:USD',
        payTo: 'urn:x402:agent-pay:see-quote',
        maxTimeoutSeconds: 300,
        extra: { quoteToken } as unknown as Record<string, unknown>,
      };

      const result = await scheme.createPaymentPayload(2, requirements);

      // Response has paymentId in awsmp format
      expect(result.payload.paymentId).toMatch(/^awsmp-/);
      // Backward compat: transactionId equals paymentId
      expect(result.payload.transactionId).toBe(result.payload.paymentId);
      // Payment token is a valid JWT
      const decoded = jose.decodeJwt(result.payload.paymentToken as string);
      expect(decoded.iss).toBe('awsmp-agentpay.amazonaws.com');
      expect(decoded.payment_id).toBe(result.payload.paymentId);
    });

    it('response includes createdAt timestamp', async () => {
      const mock = await createMockAgentPayClient('test-pay');
      const result = await mock.agentPayClient.createPayment({
        quoteToken: 'eyJ...',
      });
      expect(result.createdAt).toBeDefined();
      expect(new Date(result.createdAt).getTime()).toBeGreaterThan(0);
    });
  });

  describe('Task 33: DPoP key binding', () => {
    it('toDpopJwk converts ES256 key pair to Agent Pay format', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const jwk = toDpopJwk(keyPair);

      expect(jwk.kty).toBe('EC');
      expect(jwk.crv).toBe('P-256');
      expect(jwk.x).toBeDefined();
      expect(jwk.y).toBeDefined();
      // Should NOT have private key material
      expect((jwk as any).d).toBeUndefined();
    });

    it('toDpopJwk converts ES384 key pair to Agent Pay format', async () => {
      const keyPair = await generateDPoPKeyPair('ES384');
      const jwk = toDpopJwk(keyPair);

      expect(jwk.kty).toBe('EC');
      expect(jwk.crv).toBe('P-384');
      expect(jwk.x).toBeDefined();
      expect(jwk.y).toBeDefined();
    });

    it('toDpopJwk converts ES512 key pair to Agent Pay format', async () => {
      const keyPair = await generateDPoPKeyPair('ES512');
      const jwk = toDpopJwk(keyPair);

      expect(jwk.kty).toBe('EC');
      expect(jwk.crv).toBe('P-521');
      expect(jwk.x).toBeDefined();
      expect(jwk.y).toBeDefined();
    });

    it('toDpopJwk throws for RSA keys (Agent Pay only supports EC)', async () => {
      const keyPair = await generateDPoPKeyPair('RS256');
      expect(() => toDpopJwk(keyPair)).toThrow('Agent Pay only supports EC keys');
    });

    it('payment token includes cnf.jkt when dpopJwk is provided', async () => {
      const mock = await createMockAgentPayClient('test-pay');
      const keyPair = await generateDPoPKeyPair('ES256');
      const dpopJwk = toDpopJwk(keyPair);

      const result = await mock.agentPayClient.createPayment({
        quoteToken: 'eyJ...',
        dpopJwk,
      });

      const decoded = jose.decodeJwt(result.paymentToken);
      expect((decoded as any).cnf).toBeDefined();
      expect((decoded as any).cnf.jkt).toBeDefined();
      expect(typeof (decoded as any).cnf.jkt).toBe('string');
    });

    it('payment token does NOT include cnf when dpopJwk is omitted', async () => {
      const mock = await createMockAgentPayClient('test-pay');

      const result = await mock.agentPayClient.createPayment({
        quoteToken: 'eyJ...',
      });

      const decoded = jose.decodeJwt(result.paymentToken);
      expect((decoded as any).cnf).toBeUndefined();
    });
  });

  describe('Task 34: Client token (idempotency)', () => {
    it('same clientToken returns same response (idempotency)', async () => {
      const mock = await createMockAgentPayClient('test-pay');

      const result1 = await mock.agentPayClient.createPayment({
        quoteToken: 'eyJ...',
        clientToken: 'idem-123',
      });
      const result2 = await mock.agentPayClient.createPayment({
        quoteToken: 'eyJ...',
        clientToken: 'idem-123',
      });

      expect(result1.paymentId).toBe(result2.paymentId);
      expect(result1.paymentToken).toBe(result2.paymentToken);
    });

    it('different clientTokens produce different payments', async () => {
      const mock = await createMockAgentPayClient('test-pay');

      const result1 = await mock.agentPayClient.createPayment({
        quoteToken: 'eyJ...',
        clientToken: 'token-a',
      });
      const result2 = await mock.agentPayClient.createPayment({
        quoteToken: 'eyJ...',
        clientToken: 'token-b',
      });

      expect(result1.paymentId).not.toBe(result2.paymentId);
    });

    it('IdempotencyConflictError has correct properties', () => {
      const err = new IdempotencyConflictError('my-token', 'Custom message');
      expect(err.clientToken).toBe('my-token');
      expect(err.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(err.message).toBe('Custom message');
      expect(err).toBeInstanceOf(Error);
    });

    it('IdempotencyConflictError has default message', () => {
      const err = new IdempotencyConflictError('tok-456');
      expect(err.message).toContain('tok-456');
      expect(err.message).toContain('Idempotency conflict');
    });

    it('client scheme auto-generates clientToken', async () => {
      const mock = await createMockAgentPayClient('test-pay');
      const scheme = new AgentPayClientSchemeImpl({
        agentPayId: 'test-pay',
        agentPayClient: mock.agentPayClient,
      });

      const quoteToken = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'aws-marketplace',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'q1',
        price: { amount: '0.01', currency: 'USD' },
        payTo: 'seller',
        capture: 'auto',
        reference: 'TEST',
      } as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(mock.privateKey);

      const requirements: PaymentRequirements = {
        scheme: AGENT_PAY_SCHEME,
        network: 'aws:base',
        amount: '0.01',
        asset: 'iso4217:USD',
        payTo: 'urn:x402:agent-pay:see-quote',
        maxTimeoutSeconds: 300,
        extra: { quoteToken } as unknown as Record<string, unknown>,
      };

      // Two calls should produce different payments (different auto-generated clientTokens)
      const r1 = await scheme.createPaymentPayload(2, requirements);
      const r2 = await scheme.createPaymentPayload(2, requirements);
      expect(r1.payload.paymentId).not.toBe(r2.payload.paymentId);
    });
  });

  describe('Task 35: DEFAULT_NETWORK constant', () => {
    it('DEFAULT_NETWORK is aws:base', () => {
      expect(DEFAULT_NETWORK).toBe('aws:base');
    });

    it('is exported from the package', async () => {
      const pkg = await import('../../src/index');
      expect(pkg.DEFAULT_NETWORK).toBe('aws:base');
    });
  });

  describe('Task 36: Auto-capture (no settle call)', () => {
    it('settlePayment returns success immediately without HTTP call', async () => {
      const mock = await createMockAgentPayClient('test-pay');

      const result = await settlePayment(
        mock.agentPayClient,
        { x402Version: 2, payload: {} as any },
        {
          scheme: 'agent-pay',
          network: 'aws:base',
          amount: '1.00',
          asset: 'iso4217:USD',
          payTo: 'seller',
          maxTimeoutSeconds: 300,
          extra: {},
        },
        { paymentToken: 'tok', paymentId: 'awsmp-123', transactionId: 'awsmp-123' }
      );

      expect(result.success).toBe(true);
      expect(result.transaction).toBe('awsmp-123');
      expect(result.network).toBe('aws:base');
    });
  });

  describe('Task 37: Quote token extensions (description, dimensions)', () => {
    it('server scheme includes description in quote token when provided', async () => {
      const { privateKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK((await jose.generateKeyPair('RS256')).publicKey);

      const serverScheme = new AgentPayServerSchemeImpl({
        signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
        serviceUrl: 'https://api.example.com',
      });

      const requirements: PaymentRequirements = {
        scheme: AGENT_PAY_SCHEME,
        network: 'aws:base',
        amount: '0.50',
        asset: 'iso4217:USD',
        payTo: 'seller-123',
        maxTimeoutSeconds: 300,
        extra: {
          description: 'Premium API access - 1 request',
          dimensions: { requests: 1, tier: 'premium' },
        },
      };

      const enhanced = await serverScheme.enhancePaymentRequirements(
        requirements,
        { x402Version: 2, scheme: 'agent-pay', network: 'aws:base' as any },
        []
      );

      // Decode the quote token to verify description and dimensions
      const quoteToken = (enhanced.extra as any).quoteToken;
      const decoded = jose.decodeJwt(quoteToken);
      expect((decoded as any).description).toBe('Premium API access - 1 request');
      expect((decoded as any).dimensions).toEqual({ requests: 1, tier: 'premium' });
    });

    it('server scheme omits description/dimensions when not provided', async () => {
      const { privateKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK((await jose.generateKeyPair('RS256')).publicKey);

      const serverScheme = new AgentPayServerSchemeImpl({
        signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
        serviceUrl: 'https://api.example.com',
      });

      const requirements: PaymentRequirements = {
        scheme: AGENT_PAY_SCHEME,
        network: 'aws:base',
        amount: '0.50',
        asset: 'iso4217:USD',
        payTo: 'seller-123',
        maxTimeoutSeconds: 300,
        extra: {},
      };

      const enhanced = await serverScheme.enhancePaymentRequirements(
        requirements,
        { x402Version: 2, scheme: 'agent-pay', network: 'aws:base' as any },
        []
      );

      const quoteToken = (enhanced.extra as any).quoteToken;
      const decoded = jose.decodeJwt(quoteToken);
      expect((decoded as any).description).toBeUndefined();
      expect((decoded as any).dimensions).toBeUndefined();
    });

    it('dimensions supports mixed string and number values', async () => {
      const { privateKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK((await jose.generateKeyPair('RS256')).publicKey);

      const serverScheme = new AgentPayServerSchemeImpl({
        signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
        serviceUrl: 'https://api.example.com',
      });

      const dimensions = { tokens: 1500, model: 'claude-4', region: 'us-east-1' };
      const requirements: PaymentRequirements = {
        scheme: AGENT_PAY_SCHEME,
        network: 'aws:base',
        amount: '0.02',
        asset: 'iso4217:USD',
        payTo: 'seller-123',
        maxTimeoutSeconds: 300,
        extra: { dimensions },
      };

      const enhanced = await serverScheme.enhancePaymentRequirements(
        requirements,
        { x402Version: 2, scheme: 'agent-pay', network: 'aws:base' as any },
        []
      );

      const quoteToken = (enhanced.extra as any).quoteToken;
      const decoded = jose.decodeJwt(quoteToken);
      expect((decoded as any).dimensions).toEqual(dimensions);
    });
  });
});
