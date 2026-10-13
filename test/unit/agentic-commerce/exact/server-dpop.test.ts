// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The exact server scheme's onBeforeVerify hook: the DPoP checks it runs before
 * x402 core calls the facilitator, and the abort result it returns on failure.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { x402ResourceServer, type HTTPAdapter, type VerifyContext } from '@x402/core/server';
import type { FacilitatorClient } from '@x402/core/http';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { ExactAgenticCommerceScheme } from '../../../../src/agentic-commerce/exact/server';
import type { DPoPNonceStore } from '../../../../src/types';
import { createDPoPProof, generateDPoPKeyPair, type DPoPKeyPair } from '../../../helpers/dpop';
import { FakePaymentService, SELLER_URL } from '../../../helpers/fake-payment-service';

const URL = `${SELLER_URL}/weather`;

const signer = {
  signQuote: async () => 'signed-quote',
  getPublicKey: () => ({}),
  getServiceUrl: () => SELLER_URL,
};

function scheme(options: { dpopNonceStore?: DPoPNonceStore; dpopMaxAgeSeconds?: number } = {}) {
  return new ExactAgenticCommerceScheme({ signer, ...options });
}

const beforeVerify = (s: ExactAgenticCommerceScheme, context: unknown) =>
  s.schemeHooks.onBeforeVerify(context as VerifyContext);

function context(payload: unknown, transportContext?: unknown): unknown {
  return {
    paymentPayload: { x402Version: 2, accepted: {}, payload },
    requirements: {},
    declaredExtensions: {},
    transportContext,
  };
}

function httpAdapter(headers: Record<string, string>, method = 'GET', url = URL): HTTPAdapter {
  return {
    getHeader: (name) => headers[name],
    getMethod: () => method,
    getPath: () => '/weather',
    getUrl: () => url,
    getAcceptHeader: () => 'application/json',
    getUserAgent: () => 'TestClient/1.0',
  };
}

/** A buyer with a DPoP key and a payment token bound to it */
class Buyer {
  private constructor(
    readonly key: DPoPKeyPair,
    readonly token: string
  ) {}

  static async create(): Promise<Buyer> {
    const key = await generateDPoPKeyPair('ES256');
    const service = await FakePaymentService.create();
    return new Buyer(key, await service.issue('quote', { dpopJwk: key.publicKey }));
  }

  proof(options: { method?: string; url?: string; accessToken?: string } = {}) {
    return createDPoPProof(this.key, {
      method: options.method ?? 'GET',
      url: options.url ?? URL,
      accessToken: options.accessToken ?? this.token,
    });
  }

  context(headers: Record<string, string>, method?: string, url?: string) {
    return context(
      { paymentToken: this.token },
      { request: { adapter: httpAdapter(headers, method, url) } }
    );
  }
}

const required = { abort: true, reason: 'dpop_required' };
const invalid = { abort: true, reason: 'dpop_invalid' };

let buyer: Buyer;

beforeEach(async () => {
  buyer = await Buyer.create();
});

describe('onBeforeVerify: tokens that are not DPoP-bound pass', () => {
  it.each([
    ['no payment token', {}],
    ['a non-string payment token', { paymentToken: 123 }],
    ['an empty payment token', { paymentToken: '' }],
    ['a malformed payment token', { paymentToken: 'not-a-jwt' }],
  ])('%s', async (_name, payload) => {
    expect(await beforeVerify(scheme(), context(payload))).toBeUndefined();
  });

  it('a token without cnf', async () => {
    const token = await (await FakePaymentService.create()).issue('quote');
    expect(await beforeVerify(scheme(), context({ paymentToken: token }))).toBeUndefined();
  });

  it.each([['jkt'], [{ 'x5t#S256': 'abc' }]])('a token with an unusable cnf: %j', async (cnf) => {
    const token = await new jose.SignJWT({ cnf })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('a-shared-secret-that-is-at-least-32-bytes'));
    expect(await beforeVerify(scheme(), context({ paymentToken: token }))).toBeUndefined();
  });
});

describe('onBeforeVerify: dpop_required', () => {
  it('no transport context', async () => {
    expect(await beforeVerify(scheme(), context({ paymentToken: buyer.token }))).toEqual(required);
  });

  it('no adapter', async () => {
    const noAdapter = context({ paymentToken: buyer.token }, { request: {} });
    expect(await beforeVerify(scheme(), noAdapter)).toEqual(required);
  });

  it('no DPoP header', async () => {
    expect(await beforeVerify(scheme(), buyer.context({}))).toEqual(required);
  });

  it('an empty DPoP header', async () => {
    expect(await beforeVerify(scheme(), buyer.context({ DPoP: '' }))).toEqual(required);
  });
});

describe('onBeforeVerify: the proof', () => {
  it('a valid proof', async () => {
    expect(
      await beforeVerify(scheme(), buyer.context({ DPoP: await buyer.proof() }))
    ).toBeUndefined();
  });

  it('a lowercase header name', async () => {
    expect(
      await beforeVerify(scheme(), buyer.context({ dpop: await buyer.proof() }))
    ).toBeUndefined();
  });

  it('the method is compared upper-cased', async () => {
    const proof = await buyer.proof({ method: 'POST' });
    expect(await beforeVerify(scheme(), buyer.context({ DPoP: proof }, 'post'))).toBeUndefined();
  });

  it('the query and fragment are stripped from htu', async () => {
    const ctx = buyer.context({ DPoP: await buyer.proof() }, 'GET', `${URL}?city=Seattle#today`);
    expect(await beforeVerify(scheme(), ctx)).toBeUndefined();
  });

  it('a thumbprint mismatch', async () => {
    const other = await generateDPoPKeyPair('ES256');
    const proof = await createDPoPProof(other, {
      method: 'GET',
      url: URL,
      accessToken: buyer.token,
    });
    expect(await beforeVerify(scheme(), buyer.context({ DPoP: proof }))).toEqual(invalid);
  });

  it('a malformed proof', async () => {
    expect(await beforeVerify(scheme(), buyer.context({ DPoP: 'not-a-jwt' }))).toEqual(invalid);
  });

  it('an htm mismatch', async () => {
    const proof = await buyer.proof({ method: 'POST' });
    expect(await beforeVerify(scheme(), buyer.context({ DPoP: proof }, 'GET'))).toEqual(invalid);
  });

  it('an htu mismatch', async () => {
    const proof = await buyer.proof({ url: `${SELLER_URL}/other` });
    expect(await beforeVerify(scheme(), buyer.context({ DPoP: proof }))).toEqual(invalid);
  });

  it('a proof for another token', async () => {
    const proof = await buyer.proof({ accessToken: 'another-token' });
    expect(await beforeVerify(scheme(), buyer.context({ DPoP: proof }))).toEqual(invalid);
  });

  it('a proof older than dpopMaxAgeSeconds', async () => {
    const proof = await buyer.proof();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 30_000);
      expect(await beforeVerify(scheme(), buyer.context({ DPoP: proof }))).toBeUndefined();
      expect(
        await beforeVerify(scheme({ dpopMaxAgeSeconds: 10 }), buyer.context({ DPoP: proof }))
      ).toEqual(invalid);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a replay, with a nonce store', async () => {
    const seen = new Set<string>();
    const s = scheme({
      dpopNonceStore: { has: (jti) => seen.has(jti), add: (jti) => void seen.add(jti) },
    });
    const proof = await buyer.proof();
    expect(await beforeVerify(s, buyer.context({ DPoP: proof }))).toBeUndefined();
    expect(await beforeVerify(s, buyer.context({ DPoP: proof }))).toEqual(invalid);
  });

  it('concurrent requests with one proof: only one passes a synchronous store', async () => {
    const seen = new Set<string>();
    const s = scheme({
      dpopNonceStore: { has: (jti) => seen.has(jti), add: (jti) => void seen.add(jti) },
    });
    const proof = await buyer.proof();
    const results = await Promise.all(
      [1, 2, 3].map(() => beforeVerify(s, buyer.context({ DPoP: proof })))
    );
    expect(results.filter((result) => result === undefined)).toHaveLength(1);
    expect(results.filter((result) => result !== undefined)).toEqual([invalid, invalid]);
  });

  it('a replay is allowed without a nonce store', async () => {
    const s = scheme();
    const proof = await buyer.proof();
    expect(await beforeVerify(s, buyer.context({ DPoP: proof }))).toBeUndefined();
    expect(await beforeVerify(s, buyer.context({ DPoP: proof }))).toBeUndefined();
  });
});

describe('onBeforeVerify never throws', () => {
  // x402 core logs an error thrown by a hook and calls the facilitator anyway
  // (server/index.js:1562-1564), so a thrown error would let an unchecked
  // payment through. Every error must therefore abort.
  it('aborts with dpop_invalid when the nonce store fails', async () => {
    const s = scheme({
      dpopNonceStore: { has: () => Promise.reject(new Error('down')), add: () => {} },
    });
    expect(await beforeVerify(s, buyer.context({ DPoP: await buyer.proof() }))).toEqual(invalid);
  });

  it('aborts with dpop_invalid when the adapter fails', async () => {
    const adapter = httpAdapter({ DPoP: await buyer.proof() });
    adapter.getUrl = () => {
      throw new Error('no URL');
    };
    const ctx = context({ paymentToken: buyer.token }, { request: { adapter } });
    expect(await beforeVerify(scheme(), ctx)).toEqual(invalid);
  });
});

describe('onBeforeVerify: an empty request method or URL', () => {
  // verifyDPoPProof skips the htm or htu check when nothing is expected; the
  // hook refuses instead.
  it.each([
    ['an empty URL', 'GET', ''],
    ['a URL that is only a query', 'GET', '?city=Seattle'],
    ['an empty method', '', URL],
  ])('%s', async (_name, method, url) => {
    const proof = await buyer.proof();
    expect(await beforeVerify(scheme(), buyer.context({ DPoP: proof }, method, url))).toEqual(
      invalid
    );
  });
});

describe('onBeforeVerify on a stock x402ResourceServer', () => {
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: 'aws:base',
    asset: 'iso4217:USD',
    amount: '0.10',
    payTo: 'prod-weather',
    maxTimeoutSeconds: 300,
    extra: {},
  };

  async function server(dpopNonceStore?: DPoPNonceStore) {
    const facilitator: FacilitatorClient = {
      verify: vi.fn(async () => ({ isValid: true })),
      settle: vi.fn(),
      getSupported: async () => ({
        kinds: [{ x402Version: 2, scheme: 'exact', network: 'aws:base' }],
        extensions: [],
        signers: {},
      }),
    };
    const resourceServer = new x402ResourceServer(facilitator).register(
      'aws:base',
      scheme({ dpopNonceStore })
    );
    await resourceServer.initialize();
    return { resourceServer, facilitator };
  }

  it('aborts before the facilitator is called', async () => {
    const { resourceServer, facilitator } = await server();
    const payload = {
      x402Version: 2,
      accepted: requirements,
      payload: { paymentToken: buyer.token },
    };
    const result = await resourceServer.verifyPayment(
      payload as PaymentPayload,
      requirements,
      {},
      {
        request: { adapter: httpAdapter({}), path: '/weather', method: 'GET' },
      }
    );
    expect(result).toMatchObject({ isValid: false, invalidReason: 'dpop_required' });
    expect(facilitator.verify).not.toHaveBeenCalled();
  });

  it('checks a valid proof, then calls the facilitator', async () => {
    const seen: string[] = [];
    const { resourceServer, facilitator } = await server({
      has: () => false,
      add: (jti) => void seen.push(jti),
    });
    const payload = {
      x402Version: 2,
      accepted: requirements,
      payload: { paymentToken: buyer.token },
    };
    const result = await resourceServer.verifyPayment(
      payload as PaymentPayload,
      requirements,
      {},
      {
        request: {
          adapter: httpAdapter({ DPoP: await buyer.proof() }),
          path: '/weather',
          method: 'GET',
        },
      }
    );
    expect(result).toMatchObject({ isValid: true });
    expect(seen).toHaveLength(1);
    expect(facilitator.verify).toHaveBeenCalledOnce();
  });
});

describe('ExactAgenticCommerceScheme DPoP options', () => {
  it.each([[Number.NaN], [Infinity], ['60']])(
    'rejects dpopMaxAgeSeconds %j, which would weaken the expiry check',
    (dpopMaxAgeSeconds) => {
      expect(() => scheme({ dpopMaxAgeSeconds: dpopMaxAgeSeconds as number })).toThrow(
        'dpopMaxAgeSeconds must be a finite number of seconds'
      );
    }
  );

  it('exposes onBeforeVerify in a frozen hooks object', () => {
    const { schemeHooks } = scheme();
    expect(Object.keys(schemeHooks)).toEqual(['onBeforeVerify']);
    expect(typeof schemeHooks.onBeforeVerify).toBe('function');
    expect(Object.isFrozen(schemeHooks)).toBe(true);
  });
});
