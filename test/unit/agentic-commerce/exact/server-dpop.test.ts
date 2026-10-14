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
import type { PaymentRequirements } from '@x402/core/types';
import { ExactAgenticCommerceScheme } from '../../../../src/agentic-commerce/exact/server';
import type { DPoPNonceStore } from '../../../../src/types';
import { createDPoPProof, generateDPoPKeyPair, type DPoPKeyPair } from '../../../helpers/dpop';
import { FakePaymentService, SELLER_URL } from '../../../helpers/fake-payment-service';

const URL = `${SELLER_URL}/weather`;

const signer = {
  signQuote: () => Promise.resolve('signed-quote'),
  getPublicKey: () => ({}),
  getServiceUrl: () => SELLER_URL,
};

function scheme(options: { dpopNonceStore?: DPoPNonceStore; dpopMaxAgeSeconds?: number } = {}) {
  return new ExactAgenticCommerceScheme({ signer, ...options });
}

const beforeVerify = (s: ExactAgenticCommerceScheme, context: unknown) =>
  s.schemeHooks.onBeforeVerify(context as VerifyContext);

const afterVerify = (s: ExactAgenticCommerceScheme, context: unknown, isValid = true) =>
  s.schemeHooks.onAfterVerify({
    ...(context as VerifyContext),
    result: { isValid },
  });

/** Both hooks, in x402 core's order, for a payment the facilitator accepts */
async function verified(s: ExactAgenticCommerceScheme, context: unknown) {
  return (await beforeVerify(s, context)) ?? afterVerify(s, context);
}

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

  it('a replay, with a nonce store, is refused once the first payment is verified', async () => {
    const seen = new Set<string>();
    const s = scheme({
      dpopNonceStore: { has: (jti) => seen.has(jti), add: (jti) => void seen.add(jti) },
    });
    const proof = await buyer.proof();
    expect(await verified(s, buyer.context({ DPoP: proof }))).toBeUndefined();
    expect(await verified(s, buyer.context({ DPoP: proof }))).toEqual(invalid);
  });

  it('onBeforeVerify does not use the nonce store', async () => {
    const has = vi.fn(() => false);
    const add = vi.fn();
    const s = scheme({ dpopNonceStore: { has, add } });
    expect(await beforeVerify(s, buyer.context({ DPoP: await buyer.proof() }))).toBeUndefined();
    expect(has).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('onAfterVerify records nothing for a payment the facilitator rejected', async () => {
    const add = vi.fn();
    const s = scheme({ dpopNonceStore: { has: () => false, add } });
    const ctx = buyer.context({ DPoP: await buyer.proof() });
    expect(await beforeVerify(s, ctx)).toBeUndefined();
    expect(await afterVerify(s, ctx, false)).toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });

  it('onAfterVerify does nothing for a request onBeforeVerify did not check', async () => {
    const add = vi.fn();
    const s = scheme({ dpopNonceStore: { has: () => false, add } });
    expect(await afterVerify(s, buyer.context({ DPoP: await buyer.proof() }))).toBeUndefined();
    expect(await afterVerify(s, context({}))).toBeUndefined();
    expect(add).not.toHaveBeenCalled();
  });

  it('records the id until the second after the proof stops being fresh, with an integer iat', async () => {
    const add = vi.fn();
    const s = scheme({ dpopNonceStore: { has: () => false, add }, dpopMaxAgeSeconds: 30.5 });
    const proof = await buyer.proof();
    const { iat } = jose.decodeJwt(proof);
    expect(await verified(s, buyer.context({ DPoP: proof }))).toBeUndefined();
    expect(add).toHaveBeenCalledWith(expect.any(String), (iat as number) + 35 + 1);
  });

  it('concurrent requests with one proof: only one passes a synchronous store', async () => {
    const seen = new Set<string>();
    const s = scheme({
      dpopNonceStore: { has: (jti) => seen.has(jti), add: (jti) => void seen.add(jti) },
    });
    const proof = await buyer.proof();
    const contexts = [1, 2, 3].map(() => buyer.context({ DPoP: proof }));
    // Every request passes onBeforeVerify before any reaches onAfterVerify.
    const before = await Promise.all(contexts.map((ctx) => beforeVerify(s, ctx)));
    expect(before).toEqual([undefined, undefined, undefined]);
    const results = await Promise.all(contexts.map((ctx) => afterVerify(s, ctx)));
    expect(results.filter((result) => result === undefined)).toHaveLength(1);
    expect(results.filter((result) => result !== undefined)).toEqual([invalid, invalid]);
  });

  it('a replay is allowed without a nonce store', async () => {
    const s = scheme();
    const proof = await buyer.proof();
    expect(await verified(s, buyer.context({ DPoP: proof }))).toBeUndefined();
    expect(await verified(s, buyer.context({ DPoP: proof }))).toBeUndefined();
  });
});

describe('the DPoP hooks never throw', () => {
  // x402 core logs an error thrown by a hook and calls the facilitator anyway
  // (server/index.js:1562-1564), so a thrown error would let an unchecked
  // payment through. Every error must therefore abort.
  it('aborts with dpop_invalid when the nonce store fails', async () => {
    const s = scheme({
      dpopNonceStore: { has: () => Promise.reject(new Error('down')), add: () => {} },
    });
    expect(await verified(s, buyer.context({ DPoP: await buyer.proof() }))).toEqual(invalid);
  });

  it('onAfterVerify aborts with dpop_invalid when the nonce store add fails', async () => {
    const s = scheme({
      dpopNonceStore: {
        has: () => false,
        add: () => {
          throw new Error('down');
        },
      },
    });
    expect(await verified(s, buyer.context({ DPoP: await buyer.proof() }))).toEqual(invalid);
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
    const verify = vi.fn(() => Promise.resolve({ isValid: true }));
    const facilitator: FacilitatorClient = {
      verify,
      settle: vi.fn(),
      getSupported: () =>
        Promise.resolve({
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
    return { resourceServer, verify };
  }

  it('aborts before the facilitator is called', async () => {
    const { resourceServer, verify } = await server();
    const payload = {
      x402Version: 2,
      accepted: requirements,
      payload: { paymentToken: buyer.token },
    };
    const result = await resourceServer.verifyPayment(
      payload,
      requirements,
      {},
      {
        request: { adapter: httpAdapter({}), path: '/weather', method: 'GET' },
      }
    );
    expect(result).toMatchObject({ isValid: false, invalidReason: 'dpop_required' });
    expect(verify).not.toHaveBeenCalled();
  });

  it('checks a valid proof, then calls the facilitator', async () => {
    const seen: string[] = [];
    const { resourceServer, verify } = await server({
      has: () => false,
      add: (jti) => void seen.push(jti),
    });
    const payload = {
      x402Version: 2,
      accepted: requirements,
      payload: { paymentToken: buyer.token },
    };
    const result = await resourceServer.verifyPayment(
      payload,
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
    expect(verify).toHaveBeenCalledOnce();
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

  it('exposes onBeforeVerify and onAfterVerify in a frozen hooks object', () => {
    const { schemeHooks } = scheme();
    expect(Object.keys(schemeHooks)).toEqual(['onBeforeVerify', 'onAfterVerify']);
    expect(typeof schemeHooks.onBeforeVerify).toBe('function');
    expect(typeof schemeHooks.onAfterVerify).toBe('function');
    expect(Object.isFrozen(schemeHooks)).toBe(true);
  });
});
