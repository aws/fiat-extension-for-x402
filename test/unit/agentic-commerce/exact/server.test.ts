// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { x402Facilitator } from '@x402/core/facilitator';
import { x402ResourceServer } from '@x402/core/server';
import type {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
} from '@x402/core/types';
import { ExactAgenticCommerceScheme } from '../../../../src/agentic-commerce/exact/server';
import { InProcessFacilitatorClient } from '../../../../src/facilitator-client';
import { toQuoteSigner } from '../../../helpers/jwt-signers';
import { QUOTE_TOKEN_AUDIENCE, SCHEME_EXACT, SENTINEL_PAY_TO } from '../../../../src/constants';
import { ValidationError } from '../../../../src/types';

const SELLER_URL = 'https://seller.example.com';
const supportedKind = { x402Version: 2, scheme: 'exact', network: 'aws:base' as const };

let publicKey: jose.KeyLike;
let scheme: ExactAgenticCommerceScheme;

beforeEach(async () => {
  const keys = await jose.generateKeyPair('ES256');
  publicKey = keys.publicKey;
  const signer = toQuoteSigner(keys.privateKey, await jose.exportJWK(keys.publicKey), SELLER_URL);
  scheme = new ExactAgenticCommerceScheme({ signer });
});

afterEach(() => {
  vi.useRealTimers();
});

function baseRequirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'aws:base',
    amount: '0.10',
    asset: 'iso4217:USD',
    payTo: 'prod-abc123',
    maxTimeoutSeconds: 300,
    extra: { description: 'Weather', settlement: { mode: 'immediate' } },
    ...overrides,
  };
}

describe('ExactAgenticCommerceScheme: declaration', () => {
  it('is the exact scheme', () => {
    expect(scheme.scheme).toBe('exact');
    expect(scheme.scheme).toBe(SCHEME_EXACT);
  });

  it('declares the payment-token asset transfer method with authorization only', () => {
    expect(scheme.defaultAssetTransferMethod).toBe('payment-token');
    expect(scheme.paymentFlows).toEqual({
      'payment-token': { supported: ['authorization'], default: 'authorization' },
    });
    expect(Object.isFrozen(scheme.paymentFlows)).toBe(true);
    expect(Object.isFrozen(scheme.paymentFlows['payment-token'])).toBe(true);
  });

  it('declares quoteToken as its only dynamic extra field', () => {
    expect(scheme.dynamicExtraFields).toEqual(['quoteToken']);
  });

  it("gives each instance its own dynamicExtraFields, so one cannot change another's", async () => {
    const { privateKey, publicKey: pub } = await jose.generateKeyPair('ES256');
    const other = new ExactAgenticCommerceScheme({
      signer: toQuoteSigner(privateKey, await jose.exportJWK(pub), SELLER_URL),
    });
    scheme.dynamicExtraFields.push('extraField');
    expect(other.dynamicExtraFields).toEqual(['quoteToken']);
  });

  it('has no caipFamily: that member belongs to the facilitator interface', () => {
    expect(scheme).not.toHaveProperty('caipFamily');
  });

  it('requires a signer', () => {
    expect(() => new ExactAgenticCommerceScheme({} as never)).toThrow(ValidationError);
    expect(() => new ExactAgenticCommerceScheme(undefined as never)).toThrow(
      'ExactAgenticCommerceServerScheme requires a signer'
    );
  });
});

describe('ExactAgenticCommerceScheme: parsePrice', () => {
  // The full parsePrice matrix is in test/unit/price-parsing.test.ts.
  it.each([
    ['$1.50', { amount: '1.50', asset: 'iso4217:USD', extra: {} }],
    ['2 EUR', { amount: '2', asset: 'iso4217:EUR', extra: {} }],
    [1e-7, { amount: '0.0000001', asset: 'iso4217:USD', extra: {} }],
  ])('parses %j', async (price, expected) => {
    await expect(scheme.parsePrice(price, 'aws:base')).resolves.toEqual(expected);
  });

  it('passes an AssetAmount through as the same object', async () => {
    const price = { amount: '5.00', asset: 'iso4217:EUR', extra: { k: 'v' } };
    await expect(scheme.parsePrice(price, 'aws:base')).resolves.toBe(price);
  });

  it.each([{ amount: 5, asset: 'iso4217:USD' }, { amount: '5' }, {}])(
    'rejects the object %j, which is not an AssetAmount',
    async (price) => {
      await expect(scheme.parsePrice(price as never, 'aws:base')).rejects.toThrow(
        new ValidationError(`Invalid price: ${JSON.stringify(price)}`)
      );
    }
  );
});

describe('ExactAgenticCommerceScheme: enhancePaymentRequirements', () => {
  it('signs a quote that verifies with the seller key and carries the product ID', async () => {
    const enhanced = await scheme.enhancePaymentRequirements(baseRequirements(), supportedKind, []);
    const { quoteToken } = enhanced.extra as { quoteToken: string };

    expect(jose.decodeProtectedHeader(quoteToken)).toEqual({ alg: 'ES256', typ: 'JWT' });
    const { payload } = await jose.jwtVerify(quoteToken, publicKey, {
      audience: QUOTE_TOKEN_AUDIENCE,
      issuer: SELLER_URL,
    });
    expect(payload.payTo).toBe('prod-abc123');
    expect(payload.settlement).toEqual({ mode: 'immediate', product_id: 'prod-abc123' });
  });

  it('returns the sentinel payTo, the quote validity and the untouched settlement', async () => {
    const enhanced = await scheme.enhancePaymentRequirements(
      baseRequirements({ maxTimeoutSeconds: 120 }),
      supportedKind,
      []
    );
    expect(enhanced.payTo).toBe(SENTINEL_PAY_TO);
    expect(enhanced.maxTimeoutSeconds).toBe(120);
    expect(enhanced.extra.settlement).toEqual({ mode: 'immediate' });
  });

  it('rejects an empty issuer', async () => {
    const { privateKey, publicKey: pub } = await jose.generateKeyPair('ES256');
    const noIssuer = new ExactAgenticCommerceScheme({
      signer: toQuoteSigner(privateKey, await jose.exportJWK(pub), ' '),
    });
    await expect(
      noIssuer.enhancePaymentRequirements(baseRequirements(), supportedKind, [])
    ).rejects.toThrow(ValidationError);
  });

  it('is deterministic for everything except quoteToken', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1790000000 * 1000);
    const first = await scheme.enhancePaymentRequirements(baseRequirements(), supportedKind, []);
    // A later 402 for the same route, as on the buyer's paid retry.
    vi.setSystemTime(1790000042 * 1000);
    const second = await scheme.enhancePaymentRequirements(baseRequirements(), supportedKind, []);

    const withoutQuote = (r: PaymentRequirements) => {
      const { quoteToken: _quoteToken, ...extra } = r.extra;
      return { ...r, extra };
    };
    expect(withoutQuote(second)).toEqual(withoutQuote(first));
    expect(JSON.stringify(withoutQuote(second))).toBe(JSON.stringify(withoutQuote(first)));
    expect(second.extra.quoteToken).not.toBe(first.extra.quoteToken);
  });
});

describe('ExactAgenticCommerceScheme with x402 core (contract)', () => {
  // A stand-in facilitator: these tests exercise the resource server only.
  const facilitatorScheme: SchemeNetworkFacilitator = {
    scheme: 'exact',
    caipFamily: 'aws:*',
    getExtra: () => undefined,
    getSigners: () => [],
    verify: () => Promise.resolve({ isValid: true }),
    settle: () => Promise.resolve({ success: true, transaction: '', network: 'aws:base' }),
  };

  async function resourceServer() {
    const facilitator = new x402Facilitator().register('aws:base', facilitatorScheme);
    const server = new x402ResourceServer(new InProcessFacilitatorClient(facilitator));
    server.register('aws:base', scheme);
    await server.initialize();
    return server;
  }

  const route = {
    scheme: 'exact',
    network: 'aws:base' as const,
    payTo: 'prod-abc123',
    price: '$0.10',
    extra: { description: 'Weather' },
  };

  it('buildPaymentRequirements returns one exact accept with the quote and no flow fields', async () => {
    const server = await resourceServer();
    const accepts = await server.buildPaymentRequirements(route);

    expect(accepts).toHaveLength(1);
    const [accept] = accepts;
    expect(accept).toMatchObject({
      scheme: 'exact',
      network: 'aws:base',
      amount: '0.10',
      asset: 'iso4217:USD',
      payTo: SENTINEL_PAY_TO,
      maxTimeoutSeconds: 300,
    });
    // authorization is the default flow, so core adds nothing to extra.
    expect(Object.keys(accept.extra as object).sort()).toEqual(['description', 'quoteToken']);
    expect(server.getPaymentFlow({} as PaymentPayload, accept)).toBe('authorization');
  });

  it('findMatchingRequirements matches a quote from an earlier 402 against re-minted requirements', async () => {
    const server = await resourceServer();
    const [accepted] = await server.buildPaymentRequirements(route);
    const [reMinted] = await server.buildPaymentRequirements(route);
    expect(reMinted.extra.quoteToken).not.toBe(accepted.extra.quoteToken);

    const payload = { x402Version: 2, accepted, payload: {} } as PaymentPayload;
    expect(server.findMatchingRequirements([reMinted], payload)).toBe(reMinted);
  });

  it('findMatchingRequirements still rejects a buyer who changed any other field', async () => {
    const server = await resourceServer();
    const [accepted] = await server.buildPaymentRequirements(route);
    const [reMinted] = await server.buildPaymentRequirements(route);

    for (const tampered of [
      { ...accepted, amount: '0.01' },
      { ...accepted, asset: 'iso4217:EUR' },
      { ...accepted, payTo: 'prod-other' },
      { ...accepted, maxTimeoutSeconds: 3600 },
      { ...accepted, extra: { ...accepted.extra, description: 'Cheaper' } },
    ]) {
      const payload = { x402Version: 2, accepted: tampered, payload: {} } as PaymentPayload;
      expect(server.findMatchingRequirements([reMinted], payload)).toBeUndefined();
    }
  });
});
