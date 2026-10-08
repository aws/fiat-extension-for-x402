// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach } from 'vitest';
import * as jose from 'jose';
import { AgentPayScheme } from '../../../src/agent-pay/server/scheme';
import type { ServiceAgentPaySigner } from '../../../src/config';
import type { PaymentRequirements, AssetAmount } from '@x402/core/types';
import { AGENT_PAY_SCHEME } from '../../../src/constants';
import { AGENT_PAY_SENTINEL_PAY_TO, DEFAULT_QUOTE_VALIDITY_SECONDS } from '../../../src/constants';
import { createMockServiceSigner } from '../../helpers/mock-service-signer';

describe('Agent Pay Server Scheme', () => {
  let signer: ServiceAgentPaySigner;
  let publicKey: jose.KeyLike;
  let scheme: AgentPayScheme;
  const serviceUrl = 'https://api.example.com';

  beforeEach(async () => {
    // Create mock service signer
    const mock = await createMockServiceSigner(serviceUrl);
    signer = mock.signer;
    publicKey = mock.publicKey;

    scheme = new AgentPayScheme({ signer });
  });

  it('should parse price correctly', async () => {
    // Test string price (the amount string is kept verbatim)
    const result1 = await scheme.parsePrice('1.50 USD', 'fab:test');
    expect(result1).toEqual({
      amount: '1.50',
      asset: 'iso4217:USD',
      extra: {},
    });

    // Test number price (assumes USD)
    const result2 = await scheme.parsePrice(2.99, 'fab:test');
    expect(result2).toEqual({
      amount: '2.99',
      asset: 'iso4217:USD',
      extra: {},
    });

    // Test AssetAmount (pass through)
    const assetAmount: AssetAmount = {
      amount: '5.00',
      asset: 'iso4217:EUR',
      extra: {},
    };
    const result3 = await scheme.parsePrice(assetAmount, 'fab:test');
    expect(result3).toEqual(assetAmount);
  });

  it('should enhance payment requirements with quote token', async () => {
    const requirements: PaymentRequirements = {
      scheme: AGENT_PAY_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: {},
    };

    const supportedKind = {
      x402Version: 2,
      scheme: AGENT_PAY_SCHEME,
      network: 'fab:test' as const,
      extra: { agentPayId: 'agent-pay-123' },
    };

    const result = await scheme.enhancePaymentRequirements(requirements, supportedKind, []);

    expect(result).toBeDefined();
    expect(result.extra).toBeDefined();
    expect((result.extra as any).quoteToken).toBeDefined();
    expect(typeof (result.extra as any).quoteToken).toBe('string');

    // Verify quote token structure
    const decoded = jose.decodeJwt((result.extra as any).quoteToken);
    expect(decoded.iss).toBe(serviceUrl);
    expect(decoded.aud).toBe('aws:marketplace');
    expect((decoded as any).price).toEqual({
      amount: '1.50',
      currency: 'USD',
    });
  });

  it('should sign quote token with service signer', async () => {
    const requirements: PaymentRequirements = {
      scheme: AGENT_PAY_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: {},
    };

    const supportedKind = {
      x402Version: 2,
      scheme: AGENT_PAY_SCHEME,
      network: 'fab:test' as const,
      extra: { agentPayId: 'agent-pay-123' },
    };

    const result = await scheme.enhancePaymentRequirements(requirements, supportedKind, []);

    const quoteToken = (result.extra as any).quoteToken;

    // Verify token can be verified with public key
    const verified = await jose.jwtVerify(quoteToken, publicKey);
    expect(verified.payload.iss).toBe(serviceUrl);
    expect(verified.payload.aud).toBe('aws:marketplace');
  });

  // Moved from the deleted network-preset tests: the base scheme accepts ES256 signing keys.
  // Construction only: signing with them still uses RS256 (src/signer.ts), a separate fix.
  it('should construct with ES256 signing keys', async () => {
    const { privateKey, publicKey: es256PublicKey } = await jose.generateKeyPair('ES256');
    const es256Scheme = new AgentPayScheme({
      signingKeys: { privateKey, publicKey: await jose.exportJWK(es256PublicKey), alg: 'ES256' },
      serviceUrl,
    });

    expect(es256Scheme.scheme).toBe(AGENT_PAY_SCHEME);
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
      scheme: AGENT_PAY_SCHEME,
      network: 'fab:test',
      amount: '1.50',
      asset: 'iso4217:USD',
      payTo: 'service-pay',
      maxTimeoutSeconds: 3600,
      extra: {},
    };

    const supportedKind = {
      x402Version: 2,
      scheme: AGENT_PAY_SCHEME,
      network: 'fab:test' as const,
      extra: { agentPayId: 'agent-pay-123' },
    };

    it('should set payTo to AGENT_PAY_SENTINEL_PAY_TO in enhanced requirements', async () => {
      const result = await scheme.enhancePaymentRequirements(baseRequirements, supportedKind, []);

      expect(result.payTo).toBe(AGENT_PAY_SENTINEL_PAY_TO);
      expect(result.payTo).toBe('urn:x402:agent-pay:see-quote');
    });

    it('should set maxTimeoutSeconds to quote validity window (exp - iat)', async () => {
      const result = await scheme.enhancePaymentRequirements(baseRequirements, supportedKind, []);

      expect(result.maxTimeoutSeconds).toBe(3600);
    });

    it('should preserve real payTo inside the signed quote token', async () => {
      const result = await scheme.enhancePaymentRequirements(baseRequirements, supportedKind, []);

      // Outer payTo is sentinel
      expect(result.payTo).toBe(AGENT_PAY_SENTINEL_PAY_TO);

      // Inner quote token payTo is the real value
      const decoded = jose.decodeJwt((result.extra as any).quoteToken);
      expect((decoded as any).payTo).toBe('service-pay');
    });

    it('should keep amount and asset as real values (not sentinels)', async () => {
      const result = await scheme.enhancePaymentRequirements(baseRequirements, supportedKind, []);

      expect(result.amount).toBe('1.50');
      expect(result.asset).toBe('iso4217:USD');
    });
  });
});
