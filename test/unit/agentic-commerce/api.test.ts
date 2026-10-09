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
import { createMockAgenticCommerceClient } from '../../helpers/mock-agentic-commerce-client';
import { ExactAgenticCommerceScheme as AgenticCommerceServerSchemeImpl } from '../../../src/agentic-commerce/exact/server';
import { toQuoteSigner } from '../../../src/signers/protocol';
import { settlePayment } from '../../../src/agentic-commerce/facilitator/settle';
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
    it('settlePayment returns success immediately without HTTP call', async () => {
      const mock = await createMockAgenticCommerceClient('test-pay');

      const result = await settlePayment(
        mock.agenticCommerceClient,
        { x402Version: 2, payload: {} as any },
        {
          scheme: SCHEME_EXACT,
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
        { x402Version: 2, scheme: SCHEME_EXACT, network: 'aws:base' as any },
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
        { x402Version: 2, scheme: SCHEME_EXACT, network: 'aws:base' as any },
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
        { x402Version: 2, scheme: SCHEME_EXACT, network: 'aws:base' as any },
        []
      );

      const quoteToken = (enhanced.extra as any).quoteToken;
      const decoded = jose.decodeJwt(quoteToken);
      expect((decoded as any).dimensions).toEqual(dimensions);
    });
  });
});
