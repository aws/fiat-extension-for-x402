// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for Agentic Commerce API integration (Tasks 35-37)
 *
 * Covers:
 * - DEFAULT_NETWORK constant
 * - Auto-capture (no settle call)
 * - Quote token extensions (description, dimensions)
 */

import { describe, it, expect } from 'vitest';
import * as jose from 'jose';
import { FakePaymentService } from '../../helpers/fake-payment-service';
import { ExactAgenticCommerceScheme as AgenticCommerceServerSchemeImpl } from '../../../src/agentic-commerce/exact/server';
import { toQuoteSigner } from '../../../src/signers/protocol';
import { settleExactPayment } from '../../../src/agentic-commerce/exact/facilitator';
import { DEFAULT_NETWORK, SCHEME_EXACT } from '../../../src/constants';
import type { PaymentRequirements } from '@x402/core/types';

describe('Agentic Commerce API Integration', () => {
  describe('Task 35: DEFAULT_NETWORK constant', () => {
    it('DEFAULT_NETWORK is aws:base', () => {
      expect(DEFAULT_NETWORK).toBe('aws:base');
    });

    it('is exported from the package', async () => {
      const pkg = await import('../../../src/index');
      expect(pkg.DEFAULT_NETWORK).toBe('aws:base');
    });
  });

  describe('Task 36: Auto-capture (no settle call)', () => {
    it('settle returns the payment token payment_id immediately, without an HTTP call', async () => {
      const service = await FakePaymentService.create();
      const paymentToken = await service.issue('quote');
      const result = settleExactPayment(
        { x402Version: 2, payload: { paymentToken, paymentId: 'buyer-chosen' } } as never,
        {
          scheme: SCHEME_EXACT,
          network: 'aws:base',
          amount: '1.00',
          asset: 'iso4217:USD',
          payTo: 'seller',
          maxTimeoutSeconds: 300,
          extra: {},
        }
      );

      expect(result.success).toBe(true);
      expect(result.transaction).toBe(jose.decodeJwt(paymentToken).payment_id);
      expect(result.network).toBe('aws:base');
    });
  });

  describe('Task 37: Quote token extensions (description, dimensions)', () => {
    it('server scheme includes description in quote token when provided', async () => {
      const { privateKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK((await jose.generateKeyPair('RS256')).publicKey);

      const serverScheme = new AgenticCommerceServerSchemeImpl({
        signer: toQuoteSigner(privateKey, publicJWK, 'https://api.example.com'),
      });

      const requirements: PaymentRequirements = {
        scheme: SCHEME_EXACT,
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
        { x402Version: 2, scheme: SCHEME_EXACT, network: 'aws:base' },
        []
      );

      // Decode the quote token to verify description and dimensions
      const { quoteToken } = enhanced.extra as { quoteToken: string };
      const decoded = jose.decodeJwt(quoteToken);
      expect(decoded.description).toBe('Premium API access - 1 request');
      expect(decoded.dimensions).toEqual({ requests: 1, tier: 'premium' });
    });

    it('server scheme omits description/dimensions when not provided', async () => {
      const { privateKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK((await jose.generateKeyPair('RS256')).publicKey);

      const serverScheme = new AgenticCommerceServerSchemeImpl({
        signer: toQuoteSigner(privateKey, publicJWK, 'https://api.example.com'),
      });

      const requirements: PaymentRequirements = {
        scheme: SCHEME_EXACT,
        network: 'aws:base',
        amount: '0.50',
        asset: 'iso4217:USD',
        payTo: 'seller-123',
        maxTimeoutSeconds: 300,
        extra: {},
      };

      const enhanced = await serverScheme.enhancePaymentRequirements(
        requirements,
        { x402Version: 2, scheme: SCHEME_EXACT, network: 'aws:base' },
        []
      );

      const { quoteToken } = enhanced.extra as { quoteToken: string };
      const decoded = jose.decodeJwt(quoteToken);
      expect(decoded.description).toBeUndefined();
      expect(decoded.dimensions).toBeUndefined();
    });

    it('dimensions supports mixed string and number values', async () => {
      const { privateKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK((await jose.generateKeyPair('RS256')).publicKey);

      const serverScheme = new AgenticCommerceServerSchemeImpl({
        signer: toQuoteSigner(privateKey, publicJWK, 'https://api.example.com'),
      });

      const dimensions = { tokens: 1500, model: 'claude-4', region: 'us-east-1' };
      const requirements: PaymentRequirements = {
        scheme: SCHEME_EXACT,
        network: 'aws:base',
        amount: '0.02',
        asset: 'iso4217:USD',
        payTo: 'seller-123',
        maxTimeoutSeconds: 300,
        extra: { dimensions },
      };

      const enhanced = await serverScheme.enhancePaymentRequirements(
        requirements,
        { x402Version: 2, scheme: SCHEME_EXACT, network: 'aws:base' },
        []
      );

      const { quoteToken } = enhanced.extra as { quoteToken: string };
      const decoded = jose.decodeJwt(quoteToken);
      expect(decoded.dimensions).toEqual(dimensions);
    });
  });
});
