// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import * as jose from 'jose';
import type { PaymentRequirements } from '@x402/core/types';
import { enhancePaymentRequirements } from '../../../../src/agentic-commerce/exact/quote';
import { toQuoteSigner } from '../../../helpers/jwt-signers';
import {
  DEFAULT_QUOTE_VALIDITY_SECONDS,
  QUOTE_TOKEN_AUDIENCE,
  SENTINEL_PAY_TO,
} from '../../../../src/constants';
import { ValidationError } from '../../../../src/types';
import {
  FIXED_JTI,
  FIXED_NOW,
  MINTED_QUOTE_PAYLOAD_JSON,
  MINTED_QUOTE_TOKEN,
  QUOTE_INPUT,
  QUOTE_OUTPUT,
  QUOTE_PAYLOAD_JSON,
  QUOTE_TOKEN,
  SELLER_PUBLIC_JWK,
  SELLER_URL,
} from '../../../helpers/fixed-vectors';

// enhancePaymentRequirements: the quote claims it signs and the requirements it
// returns, plus the fixed quote vector.

function requirements(overrides: Record<string, unknown> = {}): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'aws:base',
    asset: 'iso4217:USD',
    amount: '0.10',
    payTo: 'seller-1',
    maxTimeoutSeconds: 0,
    ...overrides,
  } as unknown as PaymentRequirements;
}

/** A signer that records the claims it is asked to sign */
function recordingSigner(serviceUrl = SELLER_URL) {
  const signed: Record<string, unknown>[] = [];
  return {
    signed,
    signQuote: vi.fn((payload: unknown) => {
      signed.push(payload as Record<string, unknown>);
      return Promise.resolve('signed-quote');
    }),
    getPublicKey: () => ({}),
    getServiceUrl: () => serviceUrl,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('enhancePaymentRequirements: the fixed quote vector', () => {
  async function enhanceFixture() {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW * 1000);
    vi.spyOn(webcrypto, 'randomUUID').mockReturnValue(FIXED_JTI);
    const { privateKey } = await jose.generateKeyPair('ES256');
    const signer = toQuoteSigner(privateKey, SELLER_PUBLIC_JWK, SELLER_URL);
    return enhancePaymentRequirements(structuredClone(QUOTE_INPUT), signer);
  }

  it('produces the fixture requirements, except for the quote signature', async () => {
    const enhanced = await enhanceFixture();
    const { quoteToken, ...extra } = enhanced.extra;
    const { quoteToken: _expected, ...expectedExtra } = QUOTE_OUTPUT.extra;

    expect({ ...enhanced, extra }).toEqual({ ...QUOTE_OUTPUT, extra: expectedExtra });
    expect(Object.keys(enhanced)).toEqual(Object.keys(QUOTE_OUTPUT));
    expect(typeof quoteToken).toBe('string');
  });

  it('signs a quote payload byte-identical to the fixture payload', async () => {
    const enhanced = await enhanceFixture();
    const [, payload] = (enhanced.extra as { quoteToken: string }).quoteToken.split('.');

    expect(Buffer.from(payload, 'base64url').toString('utf8')).toBe(MINTED_QUOTE_PAYLOAD_JSON);
    expect(payload).toBe(MINTED_QUOTE_TOKEN.split('.')[1]);
  });

  it('the fixture quote verifies with the fixture seller key', async () => {
    const key = await jose.importJWK(SELLER_PUBLIC_JWK);
    const { payload } = await jose.jwtVerify(QUOTE_TOKEN, key, {
      algorithms: ['ES256'],
      currentDate: new Date(FIXED_NOW * 1000),
    });
    expect(JSON.stringify(payload)).toBe(QUOTE_PAYLOAD_JSON);
  });
});

describe('enhancePaymentRequirements: quote claims', () => {
  it('signs the required claims in a fixed order', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW * 1000 + 999);
    const signer = recordingSigner();

    await enhancePaymentRequirements(requirements(), signer);

    const [claims] = signer.signed;
    expect(Object.keys(claims)).toEqual([
      'iss',
      'aud',
      'iat',
      'exp',
      'jti',
      'price',
      'scheme',
      'network',
      'payTo',
      'reference',
      'settlement',
    ]);
    expect(claims).toMatchObject({
      iss: SELLER_URL,
      aud: QUOTE_TOKEN_AUDIENCE,
      iat: FIXED_NOW,
      exp: FIXED_NOW + DEFAULT_QUOTE_VALIDITY_SECONDS,
      price: { amount: '0.10', currency: 'USD' },
      scheme: 'exact',
      network: 'aws:base',
      payTo: 'seller-1',
      reference: 'RESOURCE',
      settlement: { product_id: 'seller-1' },
    });
    expect(Object.keys(claims.price as object)).toEqual(['amount', 'currency']);
    expect(claims.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it("signs the requirements' own scheme and network, not fixed values", async () => {
    const signer = recordingSigner();

    await enhancePaymentRequirements(requirements({ network: 'aws:other' }), signer);

    expect(signer.signed[0]).toMatchObject({ scheme: 'exact', network: 'aws:other' });
  });

  it('gives each quote a fresh jti', async () => {
    const signer = recordingSigner();
    await enhancePaymentRequirements(requirements(), signer);
    await enhancePaymentRequirements(requirements(), signer);
    expect(signer.signed[0].jti).not.toBe(signer.signed[1].jti);
  });

  it('keeps the amount verbatim and strips the iso4217: prefix from the currency', async () => {
    const signer = recordingSigner();
    await enhancePaymentRequirements(
      requirements({ asset: 'iso4217:EUR', amount: '02.50' }),
      signer
    );
    expect(signer.signed[0].price).toEqual({ amount: '02.50', currency: 'EUR' });
  });

  // The same rules as parsePrice, for a caller that skips it.
  it.each([
    { amount: '0.123456789', asset: 'iso4217:USD' },
    { amount: '1e5', asset: 'iso4217:USD' },
    { amount: 5, asset: 'iso4217:USD' },
    { amount: '0.10', asset: 'USD' },
    { amount: '0.10', asset: 'iso4217:iso4217:GBP' },
    { amount: '0.10', asset: undefined },
  ])('signs no quote for the amount and asset %j', async (price) => {
    const signer = recordingSigner();
    const message =
      price.amount === '0.123456789'
        ? `Price may have at most 8 decimal places: ${JSON.stringify(price)}`
        : `Invalid price: ${JSON.stringify(price)}`;
    await expect(enhancePaymentRequirements(requirements(price), signer)).rejects.toThrow(
      new ValidationError(message)
    );
    expect(signer.signed).toHaveLength(0);
  });

  it('rejects a bigint amount with a ValidationError', async () => {
    const signer = recordingSigner();
    await expect(
      enhancePaymentRequirements(requirements({ amount: BigInt(1) }), signer)
    ).rejects.toThrow(new ValidationError('Invalid price: (not serializable)'));
    expect(signer.signed).toHaveLength(0);
  });

  it('signs and returns the amount and asset it checked', async () => {
    const signer = recordingSigner();
    const reads = { amount: 0, asset: 0 };
    const req = requirements();
    Object.defineProperty(req, 'amount', {
      enumerable: true,
      get: () => (reads.amount++ === 0 ? '0.10' : '0.123456789'),
    });
    Object.defineProperty(req, 'asset', {
      enumerable: true,
      get: () => (reads.asset++ === 0 ? 'iso4217:USD' : 'USD'),
    });
    const enhanced = await enhancePaymentRequirements(req, signer);
    expect(signer.signed[0].price).toEqual({ amount: '0.10', currency: 'USD' });
    expect(enhanced).toMatchObject({ amount: '0.10', asset: 'iso4217:USD' });
  });

  it('takes the reference from extra', async () => {
    const signer = recordingSigner();
    await enhancePaymentRequirements(requirements({ extra: { reference: 'ORDER-7' } }), signer);
    for (const reference of ['', null, 0, [], {}]) {
      await enhancePaymentRequirements(requirements({ extra: { reference } }), signer);
    }
    expect(signer.signed[0].reference).toBe('ORDER-7');
    // Each of these counts as empty, so it falls back to RESOURCE.
    expect(signer.signed.slice(1).map((claims) => claims.reference)).toEqual(
      Array(5).fill('RESOURCE')
    );
  });

  it('copies the optional claims from extra after the required ones, and nothing else', async () => {
    const signer = recordingSigner();
    const extra = {
      unrelated: 'not copied',
      terms: 'https://seller.example.com/terms',
      support: 'https://seller.example.com/support',
      settlement: { mode: 'immediate' },
      dimensions: [{ name: 'calls', quantity: 1 }],
      description: 'Weather',
    };
    await enhancePaymentRequirements(requirements({ extra }), signer);

    const [claims] = signer.signed;
    expect(Object.keys(claims).slice(-4)).toEqual([
      'description',
      'dimensions',
      'support',
      'terms',
    ]);
    for (const name of ['description', 'dimensions', 'support', 'terms'] as const) {
      expect(claims[name]).toEqual(extra[name]);
    }
    expect(claims.settlement).toEqual({ mode: 'immediate', product_id: 'seller-1' });
    expect(claims).not.toHaveProperty('unrelated');
    expect(claims).not.toHaveProperty('quoteToken');
  });

  it('omits optional claims that are absent, null or undefined', async () => {
    const signer = recordingSigner();
    await enhancePaymentRequirements(
      requirements({ extra: { description: null, dimensions: undefined } }),
      signer
    );
    for (const name of ['description', 'dimensions', 'support', 'terms']) {
      expect(signer.signed[0]).not.toHaveProperty(name);
    }
  });

  it('keeps falsy optional claims that are not null', async () => {
    const signer = recordingSigner();
    await enhancePaymentRequirements(requirements({ extra: { description: '' } }), signer);
    expect(signer.signed[0].description).toBe('');
  });
});

describe('enhancePaymentRequirements: product ID', () => {
  it('signs payTo into the quote payTo and settlement.product_id', async () => {
    const signer = recordingSigner();
    await enhancePaymentRequirements(requirements({ payTo: 'prod-abc123' }), signer);
    expect(signer.signed[0].payTo).toBe('prod-abc123');
    expect(signer.signed[0].settlement).toEqual({ product_id: 'prod-abc123' });
  });

  it('strips whitespace around payTo', async () => {
    const signer = recordingSigner();
    await enhancePaymentRequirements(requirements({ payTo: ' prod-abc123\n' }), signer);
    expect(signer.signed[0].payTo).toBe('prod-abc123');
  });

  it('accepts a matching explicit settlement.product_id', async () => {
    const signer = recordingSigner();
    const extra = { settlement: { product_id: 'prod-abc123' } };
    await enhancePaymentRequirements(requirements({ payTo: 'prod-abc123', extra }), signer);
    expect(signer.signed[0].settlement).toEqual({ product_id: 'prod-abc123' });
  });

  it.each([['prod-other'], [null], [''], [42]])(
    'rejects a settlement.product_id of %j that differs from payTo',
    async (productId) => {
      const extra = { settlement: { product_id: productId } };
      await expect(
        enhancePaymentRequirements(requirements({ payTo: 'prod-abc123', extra }), recordingSigner())
      ).rejects.toThrow(
        new ValidationError(
          'extra.settlement.product_id must match payTo (the AWS Marketplace product ID)'
        )
      );
    }
  );

  it.each(['', '   ', null, undefined])('rejects an empty payTo of %j', async (payTo) => {
    const signer = recordingSigner();
    await expect(enhancePaymentRequirements(requirements({ payTo }), signer)).rejects.toThrow(
      new ValidationError("payTo must be the seller's AWS Marketplace product ID")
    );
    expect(signer.signQuote).not.toHaveBeenCalled();
  });

  it('treats a settlement.product_id of undefined as absent, as JSON does', async () => {
    const signer = recordingSigner();
    const extra = { settlement: { product_id: undefined, mode: 'immediate' } };
    await enhancePaymentRequirements(requirements({ payTo: 'prod-abc123', extra }), signer);
    expect(signer.signed[0].settlement).toEqual({ product_id: 'prod-abc123', mode: 'immediate' });
  });

  it.each([['a string'], [['product_id', 'x']], [42]])(
    'rejects a settlement of %j that is not an object',
    async (settlement) => {
      await expect(
        enhancePaymentRequirements(requirements({ extra: { settlement } }), recordingSigner())
      ).rejects.toThrow(new ValidationError('extra.settlement must be an object'));
    }
  );

  it.each([[null], [''], [0], [[]], [{}]])(
    'treats a settlement of %j as empty',
    async (settlement) => {
      const signer = recordingSigner();
      await enhancePaymentRequirements(requirements({ extra: { settlement } }), signer);
      expect(signer.signed[0].settlement).toEqual({ product_id: 'seller-1' });
    }
  );

  it('leaves the route extra and the outgoing settlement unchanged', async () => {
    const extra = { settlement: { mode: 'immediate' } };
    const input = requirements({ extra });
    const enhanced = await enhancePaymentRequirements(input, recordingSigner());

    expect(extra).toEqual({ settlement: { mode: 'immediate' } });
    expect(enhanced.extra.settlement).toEqual({ mode: 'immediate' });
    expect(input.payTo).toBe('seller-1');
    expect(input.extra).not.toHaveProperty('quoteToken');
  });
});

describe('enhancePaymentRequirements: returned requirements', () => {
  it('replaces payTo with the sentinel', async () => {
    const enhanced = await enhancePaymentRequirements(requirements(), recordingSigner());
    expect(enhanced.payTo).toBe(SENTINEL_PAY_TO);
    expect(enhanced.payTo).toBe('urn:x402:agentic-commerce:see-quote');
  });

  it.each([
    [0, DEFAULT_QUOTE_VALIDITY_SECONDS],
    [undefined, DEFAULT_QUOTE_VALIDITY_SECONDS],
    [42, 42],
    [3600, 3600],
  ])('sets maxTimeoutSeconds %j to the quote validity %j (exp - iat)', async (max, validity) => {
    const signer = recordingSigner();
    const enhanced = await enhancePaymentRequirements(
      requirements({ maxTimeoutSeconds: max }),
      signer
    );
    expect(enhanced.maxTimeoutSeconds).toBe(validity);
    expect((signer.signed[0].exp as number) - (signer.signed[0].iat as number)).toBe(validity);
  });

  it('embeds the quote token in extra and keeps the other extra fields', async () => {
    const extra = { reference: 'ORDER-7', custom: { a: 1 } };
    const enhanced = await enhancePaymentRequirements(requirements({ extra }), recordingSigner());
    expect(enhanced.extra).toEqual({
      reference: 'ORDER-7',
      custom: { a: 1 },
      quoteToken: 'signed-quote',
    });
  });

  it('replaces a quoteToken already in extra', async () => {
    const enhanced = await enhancePaymentRequirements(
      requirements({ extra: { quoteToken: 'stale' } }),
      recordingSigner()
    );
    expect(enhanced.extra.quoteToken).toBe('signed-quote');
  });

  it('keeps scheme, network, asset and amount', async () => {
    const enhanced = await enhancePaymentRequirements(requirements(), recordingSigner());
    for (const name of ['scheme', 'network', 'asset', 'amount'] as const) {
      expect(enhanced[name]).toBe(requirements()[name]);
    }
  });
});

describe('enhancePaymentRequirements: issuer', () => {
  it.each(['', '   ', '\t\n', null, undefined])(
    'rejects an empty signer service URL %j before signing',
    async (serviceUrl) => {
      const signer = recordingSigner();
      signer.getServiceUrl = () => serviceUrl as string;
      await expect(enhancePaymentRequirements(requirements(), signer)).rejects.toThrow(
        ValidationError
      );
      await expect(enhancePaymentRequirements(requirements(), signer)).rejects.toThrow(
        /signer service URL \(issuer\) is empty/
      );
      expect(signer.signQuote).not.toHaveBeenCalled();
    }
  );

  it('checks the issuer before payTo', async () => {
    await expect(
      enhancePaymentRequirements(requirements({ payTo: '' }), recordingSigner(''))
    ).rejects.toThrow(/issuer/);
  });

  it('propagates a signing failure', async () => {
    const signer = recordingSigner();
    signer.signQuote.mockRejectedValueOnce(new Error('KMS unavailable'));
    await expect(enhancePaymentRequirements(requirements(), signer)).rejects.toThrow(
      'KMS unavailable'
    );
  });
});
