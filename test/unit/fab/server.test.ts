import { describe, it, expect, beforeEach } from 'vitest';
import * as jose from 'jose';
import { FABScheme } from '../../../src/fab/server/scheme';
import type { ServiceFABSigner } from '../../../src/config';
import type { PaymentRequirements, AssetAmount } from '@x402/core/types';
import { FAB_SCHEME } from '../../../src/constants';
import { FAB_SENTINEL_PAY_TO, DEFAULT_QUOTE_VALIDITY_SECONDS } from '../../../src/constants';
import { createMockServiceSigner } from '../../helpers/mock-service-signer';

describe('FAB Server Scheme', () => {
  let signer: ServiceFABSigner;
  let publicKey: jose.KeyLike;
  let scheme: FABScheme;
  const serviceUrl = 'https://api.example.com';

  beforeEach(async () => {
    // Create mock service signer
    const mock = await createMockServiceSigner(serviceUrl);
    signer = mock.signer;
    publicKey = mock.publicKey;

    scheme = new FABScheme({ signer });
  });

  it('should parse price correctly', async () => {
    // Test string price
    const result1 = await scheme.parsePrice('1.50 USD', 'fab:test');
    expect(result1).toEqual({
      amount: '1.5',
      asset: 'iso4217:USD',
      extra: {}
    });

    // Test number price (assumes USD)
    const result2 = await scheme.parsePrice(2.99, 'fab:test');
    expect(result2).toEqual({
      amount: '2.99',
      asset: 'iso4217:USD',
      extra: {}
    });

    // Test AssetAmount (pass through)
    const assetAmount: AssetAmount = {
      amount: '5.00',
      asset: 'iso4217:EUR',
      extra: {}
    };
    const result3 = await scheme.parsePrice(assetAmount, 'fab:test');
    expect(result3).toEqual(assetAmount);
  });

  it('should enhance payment requirements with quote token', async () => {
    const requirements: PaymentRequirements = {
      scheme: FAB_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: {}
    };

    const supportedKind = {
      x402Version: 2,
      scheme: FAB_SCHEME,
      network: 'fab:test' as const,
      extra: { agenticPayId: 'agentic-pay-123' }
    };

    const result = await scheme.enhancePaymentRequirements(
      requirements,
      supportedKind,
      []
    );

    expect(result).toBeDefined();
    expect(result.extra).toBeDefined();
    expect((result.extra as any).quoteToken).toBeDefined();
    expect(typeof (result.extra as any).quoteToken).toBe('string');

    // Verify quote token structure
    const decoded = jose.decodeJwt((result.extra as any).quoteToken);
    expect(decoded.iss).toBe(serviceUrl);
    expect(decoded.aud).toBe('fab:test');
    expect((decoded as any).price).toEqual({
      amount: '1.50',
      currency: 'USD'
    });
  });

  it('should sign quote token with service signer', async () => {
    const requirements: PaymentRequirements = {
      scheme: FAB_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: {}
    };

    const supportedKind = {
      x402Version: 2,
      scheme: FAB_SCHEME,
      network: 'fab:test' as const,
      extra: { agenticPayId: 'agentic-pay-123' }
    };

    const result = await scheme.enhancePaymentRequirements(
      requirements,
      supportedKind,
      []
    );

    const quoteToken = (result.extra as any).quoteToken;

    // Verify token can be verified with public key
    const verified = await jose.jwtVerify(quoteToken, publicKey);
    expect(verified.payload.iss).toBe(serviceUrl);
    expect(verified.payload.aud).toBe('fab:test');
  });

  it('should handle multiple price currencies', async () => {
    // Test USD
    const result1 = await scheme.parsePrice('1.50 USD', 'fab:test');
    expect(result1.asset).toBe('iso4217:USD');

    // Test EUR
    const result2 = await scheme.parsePrice('2.99 EUR', 'fab:test');
    expect(result2.asset).toBe('iso4217:EUR');

    // Test GBP
    const result3 = await scheme.parsePrice('3.49 GBP', 'fab:test');
    expect(result3.asset).toBe('iso4217:GBP');
  });

  describe('Sentinel Values (Task 28)', () => {
    const baseRequirements: PaymentRequirements = {
      scheme: FAB_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: {}
    };

    const supportedKind = {
      x402Version: 2,
      scheme: FAB_SCHEME,
      network: 'fab:test' as const,
      extra: { agenticPayId: 'agentic-pay-123' }
    };

    it('should set payTo to FAB_SENTINEL_PAY_TO in enhanced requirements', async () => {
      const result = await scheme.enhancePaymentRequirements(
        baseRequirements,
        supportedKind,
        []
      );

      expect(result.payTo).toBe(FAB_SENTINEL_PAY_TO);
      expect(result.payTo).toBe('urn:x402:fab:see-quote');
    });

    it('should set maxTimeoutSeconds to quote validity window (exp - iat)', async () => {
      const result = await scheme.enhancePaymentRequirements(
        baseRequirements,
        supportedKind,
        []
      );

      expect(result.maxTimeoutSeconds).toBe(DEFAULT_QUOTE_VALIDITY_SECONDS);
    });

    it('should preserve real payTo inside the signed quote token', async () => {
      const result = await scheme.enhancePaymentRequirements(
        baseRequirements,
        supportedKind,
        []
      );

      // Outer payTo is sentinel
      expect(result.payTo).toBe(FAB_SENTINEL_PAY_TO);

      // Inner quote token payTo is the real value
      const decoded = jose.decodeJwt((result.extra as any).quoteToken);
      expect((decoded as any).payTo).toBe('service-pay');
    });

    it('should keep amount and asset as real values (not sentinels)', async () => {
      const result = await scheme.enhancePaymentRequirements(
        baseRequirements,
        supportedKind,
        []
      );

      expect(result.amount).toBe('1.50');
      expect(result.asset).toBe('iso4217:USD');
    });
  });
});
