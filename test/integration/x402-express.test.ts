// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * A seller protected by the stock @x402/express middleware, end to end.
 *
 * The seller registers this package's exact schemes on x402 core objects and
 * uses x402's Express `paymentMiddleware` unchanged: the exact server scheme
 * signs quotes and checks DPoP, and an in-process x402 facilitator runs the
 * exact facilitator scheme with the seller's own key. Each app listens on an
 * ephemeral port on 127.0.0.1 and is called with the native fetch, except the
 * fixed-vector app, which needs a Host header and gets node:http. Payment
 * tokens are minted by a fake payment service whose JWKS is served by a
 * stubbed fetch, which only the seller's facilitator uses.
 *
 * Each refused payment is checked for its reason, that no route handler ran,
 * and whether the facilitator was asked to verify it. The fixed-vector cases
 * at the end replay the known-good token and DPoP proof of fixed-vectors.ts.
 */

import { once } from 'node:events';
import { request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import { paymentMiddleware } from '@x402/express';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { x402Facilitator } from '@x402/core/facilitator';
import { type RoutesConfig, x402ResourceServer } from '@x402/core/server';
import type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
} from '@x402/core/types';
import * as jose from 'jose';
import {
  AgenticCommerceVerifier,
  ExactAgenticCommerceFacilitatorScheme,
  InProcessFacilitatorClient,
  LocalQuoteSigner,
  registerExactAgenticCommerceServer,
  type DPoPNonceStore,
  type QuoteSigner,
} from '../../src';
import {
  DPOP_PROOF,
  FIXED_NOW,
  PAYMENT_ID,
  PAYMENT_PAYER,
  PAYMENT_TOKEN,
  QUOTE_OUTPUT,
  SELLER_PUBLIC_JWK,
  SERVICE_JWKS,
} from '../helpers/fixed-vectors';
import {
  BUYER,
  FakePaymentService,
  SELLER_URL,
  SERVICE_JWKS_BASE_URL,
  SERVICE_JWKS_URL,
  ecKey,
  jwksFetch,
  requestUrl,
} from '../helpers/fake-payment-service';

const route = (payTo: string, price: string) => ({
  scheme: 'exact',
  network: 'aws:base' as Network,
  payTo,
  price,
});

// Two priced routes for one product, and another product at the same price.
const ROUTES: RoutesConfig = {
  'GET /weather': { accepts: route('seller-1', '$0.10'), description: 'Weather' },
  'GET /ping': { accepts: route('seller-1', '$0.01'), description: 'Ping' },
  'GET /forecast': { accepts: route('seller-2', '$0.10'), description: 'Forecast' },
};

// The route the fixed-vector quote was signed for.
const FIXTURE_ROUTES: RoutesConfig = {
  'GET /weather': {
    accepts: {
      ...route('prod-fixture123', '$0.10'),
      extra: { description: 'Weather', settlement: { mode: 'immediate' } },
    },
  },
};

const BODIES: Record<string, unknown> = {
  '/weather': { temp: 72 },
  '/ping': { pong: 'ok' },
  '/forecast': { rain: false },
};

/** The test's own fetch; the global one is stubbed for the facilitator's JWKS fetches. */
const realFetch = globalThis.fetch;

/** Decodes and encodes the x402 headers, as a buyer does */
const httpClient = new x402HTTPClient(new x402Client());

/** A nonce store that remembers every jti until its expiry */
class MemoryNonceStore implements DPoPNonceStore {
  private readonly seen = new Map<string, number>();
  has(jti: string): boolean {
    const expiresAt = this.seen.get(jti);
    return expiresAt !== undefined && Date.now() / 1000 < expiresAt;
  }
  add(jti: string, expiresAt: number): void {
    this.seen.set(jti, expiresAt);
  }
}

/** A running seller app */
interface Seller {
  url: string;
  /** How many requests reached a route handler */
  served: number;
  /** How many payments x402 core sent to the facilitator's verify */
  verified: number;
  /** The facilitator's invalidMessage for the last payment it verified */
  lastInvalidMessage?: string;
  close(): Promise<void>;
}

interface SellerOptions {
  signer: QuoteSigner;
  /** The seller's public JWK, configured in the facilitator's verifier */
  publicJwk: jose.JWK;
  routes?: RoutesConfig;
  dpopNonceStore?: DPoPNonceStore;
  /** Take the protocol from X-Forwarded-Proto, as behind a TLS proxy */
  trustProxy?: boolean;
}

/** An Express app with the stock paymentMiddleware, listening on an ephemeral port */
async function startSeller(options: SellerOptions): Promise<Seller> {
  const verifier = new AgenticCommerceVerifier({
    sellerKeyResolver: { type: 'static', publicJwk: options.publicJwk },
    paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
  });
  const facilitator = new x402Facilitator().register(
    'aws:base',
    new ExactAgenticCommerceFacilitatorScheme({ verifier })
  );
  const seller = { served: 0, verified: 0 } as Seller;
  const facilitatorClient = new InProcessFacilitatorClient(facilitator);
  const verify = facilitatorClient.verify.bind(facilitatorClient);
  facilitatorClient.verify = async (...args) => {
    seller.verified += 1;
    const result = await verify(...args);
    seller.lastInvalidMessage = result.invalidMessage;
    return result;
  };
  const resourceServer = new x402ResourceServer(facilitatorClient);
  registerExactAgenticCommerceServer(resourceServer, {
    signer: options.signer,
    dpopNonceStore: options.dpopNonceStore,
  });

  const app = express();
  if (options.trustProxy) app.set('trust proxy', 'loopback');
  // Express 4 ignores the promise a handler returns; the middleware answers
  // its own errors.
  const middleware = paymentMiddleware(options.routes ?? ROUTES, resourceServer);
  app.use((req, res, next) => void middleware(req, res, next));
  for (const [path, body] of Object.entries(BODIES)) {
    app.get(path, (_req, res) => {
      seller.served += 1;
      res.json(body);
    });
  }

  const server: Server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  seller.url = `http://127.0.0.1:${port}`;
  seller.close = () =>
    new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => (error ? reject(error) : resolve()));
    });
  return seller;
}

/** A seller key pair and its LocalQuoteSigner */
async function sellerSigner(serviceUrl: string = SELLER_URL) {
  const { privateKey, jwk } = await ecKey('seller-key');
  return { signer: new LocalQuoteSigner(privateKey, jwk, serviceUrl), publicJwk: jwk };
}

/** The 402 for an unpaid request, as a buyer reads it */
async function offer(seller: Seller, path: string): Promise<PaymentRequired> {
  const response = await realFetch(`${seller.url}${path}`);
  expect(response.status).toBe(402);
  return httpClient.getPaymentRequiredResponse(
    (name) => response.headers.get(name),
    await response.json()
  );
}

const quoteOf = (accepted: PaymentRequirements) => accepted.extra.quoteToken as string;

/** A paid retry with `accepted` and `token` in PAYMENT-SIGNATURE */
function pay(
  seller: Seller,
  path: string,
  accepted: PaymentRequirements,
  token: string,
  headers: Record<string, string> = {}
): Promise<Response> {
  const payload: PaymentPayload = { x402Version: 2, accepted, payload: { paymentToken: token } };
  return realFetch(`${seller.url}${path}`, {
    headers: { ...httpClient.encodePaymentSignatureHeader(payload), ...headers },
  });
}

/**
 * The paid retry is refused with a 402 and this reason, and no handler runs.
 * When the facilitator refuses it, `message` is the start of its
 * invalidMessage, which names the check that failed (several share a reason).
 * When x402 core or the server scheme refuses it, the facilitator is not
 * asked (`message` undefined).
 */
async function expectRejected(
  seller: Seller,
  response: Response,
  reason: string,
  message?: string
) {
  expect(response.status).toBe(402);
  const required = httpClient.getPaymentRequiredResponse(
    (name) => response.headers.get(name),
    await response.json()
  );
  expect(required.error).toBe(reason);
  expect(seller.served).toBe(0);
  if (message === undefined) {
    expect(seller.verified).toBe(0);
  } else {
    expect(seller.verified).toBe(1);
    expect(seller.lastInvalidMessage?.slice(0, message.length)).toBe(message);
  }
}

/** The resource is served and the payment settled */
async function expectServed(seller: Seller, response: Response, path: string) {
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(BODIES[path]);
  expect(seller.served).toBe(1);
  expect(seller.verified).toBe(1);
  return httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
}

describe('a seller on the stock @x402/express paymentMiddleware', () => {
  let service: FakePaymentService;
  let fetchStub: ReturnType<typeof jwksFetch>;
  let seller: Seller;
  let otherSeller: Seller;
  let replaySafeSeller: Seller;
  const sellers: Seller[] = [];

  /** How often the facilitator fetched the payment service's JWKS */
  const jwksFetches = () =>
    fetchStub.mock.calls.filter(([input]) => requestUrl(input) === SERVICE_JWKS_URL).length;

  beforeAll(async () => {
    service = await FakePaymentService.create();
    fetchStub = jwksFetch({ [SERVICE_JWKS_URL]: service.jwks });
    vi.stubGlobal('fetch', fetchStub);
    // Each app is tracked as soon as it listens, so afterAll closes it even
    // when a later one fails to start.
    const start = async (options: SellerOptions) => {
      const started = await startSeller(options);
      sellers.push(started);
      return started;
    };
    const own = await sellerSigner();
    seller = await start(own);
    otherSeller = await start(await sellerSigner('https://other.example.com'));
    replaySafeSeller = await start({ ...own, dpopNonceStore: new MemoryNonceStore() });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await Promise.all(sellers.map((s) => s.close()));
  });

  beforeEach(() => {
    for (const s of sellers) {
      s.served = 0;
      s.verified = 0;
      s.lastInvalidMessage = undefined;
    }
    fetchStub.mockClear();
  });

  describe('payment required', () => {
    it('answers an unpaid request with exact requirements and a quote', async () => {
      const { accepts } = await offer(seller, '/weather');
      expect(accepts).toHaveLength(1);
      expect(accepts[0]).toMatchObject({
        scheme: 'exact',
        network: 'aws:base',
        amount: '0.10',
        asset: 'iso4217:USD',
        payTo: 'urn:x402:agentic-commerce:see-quote',
      });
      expect(quoteOf(accepts[0]).split('.')).toHaveLength(3);
      expect(seller.served).toBe(0);
    });

    it('carries a new quote on each 402', async () => {
      const first = (await offer(seller, '/weather')).accepts[0];
      const second = (await offer(seller, '/weather')).accepts[0];
      expect(quoteOf(first)).not.toBe(quoteOf(second));
    });
  });

  describe('paid requests', () => {
    it('serves and settles a valid payment', async () => {
      const accepted = (await offer(seller, '/weather')).accepts[0];
      const token = await service.issue(quoteOf(accepted));
      const settlement = await expectServed(
        seller,
        await pay(seller, '/weather', accepted, token),
        '/weather'
      );
      expect(settlement).toMatchObject({
        success: true,
        transaction: jose.decodeJwt(token).payment_id,
        network: 'aws:base',
        payer: BUYER,
      });
      expect(settlement.transaction.startsWith('awsmp-')).toBe(true);
      expect(jwksFetches()).toBe(1);
    });

    it('rejects a payment for a cheaper route', async () => {
      const cheap = (await offer(seller, '/ping')).accepts[0];
      const token = await service.issue(quoteOf(cheap));
      // Refused by x402 core's requirement matching, before verify.
      await expectRejected(
        seller,
        await pay(seller, '/weather', cheap, token),
        'No matching payment requirements'
      );
      expect(jwksFetches()).toBe(0);
    });

    it('rejects a payment for another route with the price relabelled', async () => {
      const cheap = (await offer(seller, '/ping')).accepts[0];
      const token = await service.issue(quoteOf(cheap));
      const relabelled = { ...cheap, amount: '0.10' };
      await expectRejected(
        seller,
        await pay(seller, '/weather', relabelled, token),
        'invalid_payment',
        'Amount or currency mismatch'
      );
    });

    it('rejects a quote for another product at the same price', async () => {
      const forecast = (await offer(seller, '/forecast')).accepts[0];
      const token = await service.issue(quoteOf(forecast));
      await expectRejected(
        seller,
        await pay(seller, '/weather', forecast, token),
        'invalid_payment',
        'Quote is for a different product'
      );
    });

    it('rejects a quote signed by another seller', async () => {
      const foreign = (await offer(otherSeller, '/weather')).accepts[0];
      const token = await service.issue(quoteOf(foreign), {
        audience: 'https://other.example.com',
      });
      await expectRejected(
        seller,
        await pay(seller, '/weather', foreign, token),
        'invalid_quote',
        'Quote token signature invalid'
      );
    });

    it('rejects a token whose audience is not the quote issuer', async () => {
      const accepted = (await offer(seller, '/weather')).accepts[0];
      const token = await service.issue(quoteOf(accepted), {
        audience: 'https://other.example.com',
      });
      await expectRejected(
        seller,
        await pay(seller, '/weather', accepted, token),
        'invalid_payment',
        'Payment token audience is not the quote issuer'
      );
    });

    it('rejects a token not issued by the payment service', async () => {
      const accepted = (await offer(seller, '/weather')).accepts[0];
      const forger = await FakePaymentService.create();
      const forged = await forger.issue(quoteOf(accepted));
      await expectRejected(
        seller,
        await pay(seller, '/weather', accepted, forged),
        'invalid_payment',
        'Payment token signature invalid'
      );
    });

    it('rejects a token with another issuer claim', async () => {
      const accepted = (await offer(seller, '/weather')).accepts[0];
      const token = await service.issue(quoteOf(accepted), { issuer: 'someone-else' });
      await expectRejected(
        seller,
        await pay(seller, '/weather', accepted, token),
        'invalid_payment',
        'Payment token issuer is not the payment service'
      );
    });

    it('rejects an expired token', async () => {
      const accepted = (await offer(seller, '/weather')).accepts[0];
      const token = await service.issue(quoteOf(accepted), { expiresIn: -1 });
      await expectRejected(
        seller,
        await pay(seller, '/weather', accepted, token),
        'payment_expired',
        'Payment token expired'
      );
    });

    it('rejects a token issued for a different quote', async () => {
      const accepted = (await offer(seller, '/weather')).accepts[0];
      const other = (await offer(seller, '/weather')).accepts[0];
      const token = await service.issue(quoteOf(other));
      await expectRejected(
        seller,
        await pay(seller, '/weather', accepted, token),
        'invalid_quote',
        'Payment token was issued for a different quote'
      );
    });
  });

  describe('DPoP-bound payment tokens', () => {
    let buyerKey: jose.KeyLike;
    let buyerJwk: jose.JWK;

    beforeAll(async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
      buyerKey = privateKey;
      buyerJwk = await jose.exportJWK(publicKey);
    });

    /** A bound token for a fresh /weather quote, and the URL the proof must name */
    async function boundPayment(app = seller) {
      const required = await offer(app, '/weather');
      const accepted = required.accepts[0];
      const token = await service.issue(quoteOf(accepted), { dpopJwk: buyerJwk });
      return { accepted, token, htu: required.resource.url };
    }

    /** A buyer's DPoP proof (RFC 9449) for `htu` over `accessToken`, with overrides */
    async function dpopProof(
      htu: string,
      accessToken: string,
      options: {
        claims?: Record<string, unknown>;
        header?: Record<string, unknown>;
        key?: jose.KeyLike | Uint8Array;
      } = {}
    ): Promise<string> {
      const claims = {
        jti: crypto.randomUUID(),
        htm: 'GET',
        htu,
        iat: Math.floor(Date.now() / 1000),
        ath: jose.base64url.encode(await sha256(accessToken)),
        ...options.claims,
      };
      const header = { alg: 'ES256', typ: 'dpop+jwt', jwk: buyerJwk, ...options.header };
      return new jose.SignJWT(claims).setProtectedHeader(header).sign(options.key ?? buyerKey);
    }

    /** Refused by the server scheme's DPoP check: the facilitator is never called */
    async function expectRefusedBeforeVerify(response: Response, reason: string, app = seller) {
      await expectRejected(app, response, reason);
      expect(jwksFetches()).toBe(0);
    }

    it('serves a bound token with a valid proof', async () => {
      const { accepted, token, htu } = await boundPayment();
      const proof = await dpopProof(htu, token);
      const settlement = await expectServed(
        seller,
        await pay(seller, '/weather', accepted, token, { DPoP: proof }),
        '/weather'
      );
      expect(settlement.success).toBe(true);
    });

    it('dpop_required: a bound token without a proof', async () => {
      const { accepted, token } = await boundPayment();
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather', accepted, token),
        'dpop_required'
      );
    });

    it('dpop_invalid: a proof from another key (thumbprint mismatch)', async () => {
      const { accepted, token, htu } = await boundPayment();
      const other = await jose.generateKeyPair('ES256');
      const proof = await dpopProof(htu, token, {
        header: { jwk: await jose.exportJWK(other.publicKey) },
        key: other.privateKey,
      });
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather', accepted, token, { DPoP: proof }),
        'dpop_invalid'
      );
    });

    it('dpop_invalid: a proof naming the buyer key but signed by another key', async () => {
      const { accepted, token, htu } = await boundPayment();
      const other = await jose.generateKeyPair('ES256');
      const proof = await dpopProof(htu, token, { key: other.privateKey });
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather', accepted, token, { DPoP: proof }),
        'dpop_invalid'
      );
    });

    it('dpop_invalid: a proof for another URL (htu)', async () => {
      const { accepted, token, htu } = await boundPayment();
      const proof = await dpopProof(htu.replace('/weather', '/ping'), token);
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather', accepted, token, { DPoP: proof }),
        'dpop_invalid'
      );
    });

    it('serves a proof whose htu is the URL without the query', async () => {
      const required = await offer(seller, '/weather?city=Seattle');
      const accepted = required.accepts[0];
      expect(new URL(required.resource.url).search).toBe('?city=Seattle');
      const token = await service.issue(quoteOf(accepted), { dpopJwk: buyerJwk });
      const htu = required.resource.url.split('?', 1)[0];
      await expectServed(
        seller,
        await pay(seller, '/weather?city=Seattle', accepted, token, {
          DPoP: await dpopProof(htu, token),
        }),
        '/weather'
      );
    });

    it('dpop_invalid: a proof whose htu keeps the query', async () => {
      const required = await offer(seller, '/weather?city=Seattle');
      const accepted = required.accepts[0];
      const token = await service.issue(quoteOf(accepted), { dpopJwk: buyerJwk });
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather?city=Seattle', accepted, token, {
          DPoP: await dpopProof(required.resource.url, token),
        }),
        'dpop_invalid'
      );
    });

    it('dpop_invalid: a proof over another token (ath)', async () => {
      const { accepted, token, htu } = await boundPayment();
      const proof = await dpopProof(htu, 'other');
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather', accepted, token, { DPoP: proof }),
        'dpop_invalid'
      );
    });

    it('dpop_invalid: a proof for another method (htm)', async () => {
      const { accepted, token, htu } = await boundPayment();
      const proof = await dpopProof(htu, token, { claims: { htm: 'POST' } });
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather', accepted, token, { DPoP: proof }),
        'dpop_invalid'
      );
    });

    // Far past the 60 s maximum age and the 5 s skew, so the real clock cannot
    // make these flaky; the exact bounds are pinned in dpop.test.ts.
    it('dpop_invalid: a stale proof (iat 300 seconds ago)', async () => {
      const { accepted, token, htu } = await boundPayment();
      const iat = Math.floor(Date.now() / 1000) - 300;
      const proof = await dpopProof(htu, token, { claims: { iat } });
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather', accepted, token, { DPoP: proof }),
        'dpop_invalid'
      );
    });

    it('dpop_invalid: a proof issued in the future (iat 30 seconds ahead)', async () => {
      const { accepted, token, htu } = await boundPayment();
      const iat = Math.floor(Date.now() / 1000) + 30;
      const proof = await dpopProof(htu, token, { claims: { iat } });
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather', accepted, token, { DPoP: proof }),
        'dpop_invalid'
      );
    });

    it('dpop_invalid: an HS256 proof', async () => {
      const { accepted, token, htu } = await boundPayment();
      const proof = await dpopProof(htu, token, {
        header: { alg: 'HS256' },
        key: new TextEncoder().encode('a-shared-secret-that-is-at-least-32-bytes'),
      });
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather', accepted, token, { DPoP: proof }),
        'dpop_invalid'
      );
    });

    it('dpop_invalid: an unsigned (alg none) proof', async () => {
      const { accepted, token, htu } = await boundPayment();
      const [, body] = (await dpopProof(htu, token)).split('.');
      const header = jose.base64url.encode(
        JSON.stringify({ alg: 'none', typ: 'dpop+jwt', jwk: buyerJwk })
      );
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather', accepted, token, { DPoP: `${header}.${body}.` }),
        'dpop_invalid'
      );
    });

    it('dpop_invalid: a proof with the wrong typ', async () => {
      const { accepted, token, htu } = await boundPayment();
      const proof = await dpopProof(htu, token, { header: { typ: 'JWT' } });
      await expectRefusedBeforeVerify(
        await pay(seller, '/weather', accepted, token, { DPoP: proof }),
        'dpop_invalid'
      );
    });

    it('dpop_invalid: a replayed proof (jti), with a nonce store', async () => {
      const { accepted, token, htu } = await boundPayment(replaySafeSeller);
      const proof = await dpopProof(htu, token);
      await expectServed(
        replaySafeSeller,
        await pay(replaySafeSeller, '/weather', accepted, token, { DPoP: proof }),
        '/weather'
      );
      replaySafeSeller.served = 0;
      replaySafeSeller.verified = 0;
      fetchStub.mockClear();
      await expectRefusedBeforeVerify(
        await pay(replaySafeSeller, '/weather', accepted, token, { DPoP: proof }),
        'dpop_invalid',
        replaySafeSeller
      );
    });

    it('serves a replayed proof when no nonce store is configured', async () => {
      const { accepted, token, htu } = await boundPayment();
      const proof = await dpopProof(htu, token);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        seller.served = 0;
        seller.verified = 0;
        await expectServed(
          seller,
          await pay(seller, '/weather', accepted, token, { DPoP: proof }),
          '/weather'
        );
      }
    });
  });
});

/**
 * The fixed-vector payment (fixed-vectors.ts): its token and DPoP proof are
 * used byte for byte, checked at FIXED_NOW+10. The proof names
 * https://seller.example.com/weather, so the request arrives as a TLS proxy
 * forwards it: with that Host and X-Forwarded-Proto. node:http sends it, as
 * the native fetch does not let a caller set Host.
 */
describe('the fixed-vector payment through @x402/express', () => {
  let app: Seller;
  let fetchStub: ReturnType<typeof jwksFetch>;

  beforeAll(async () => {
    fetchStub = jwksFetch({ [SERVICE_JWKS_URL]: SERVICE_JWKS });
    vi.stubGlobal('fetch', fetchStub);
    // Any key signs the server's own quotes; the buyer pays the fixture quote.
    app = await startSeller({
      ...(await sellerSigner()),
      publicJwk: SELLER_PUBLIC_JWK,
      routes: FIXTURE_ROUTES,
      trustProxy: true,
    });
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    // Unset when beforeAll failed before the app listened.
    await app?.close();
  });

  beforeEach(() => {
    app.served = 0;
    app.verified = 0;
    fetchStub.mockClear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime((FIXED_NOW + 10) * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** GET /weather with the fixture payment, through node:http */
  function payFixture(headers: Record<string, string>) {
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: QUOTE_OUTPUT,
      payload: { paymentToken: PAYMENT_TOKEN },
    };
    return new Promise<{ status: number; headers: Record<string, string>; body: unknown }>(
      (resolve, reject) => {
        const request = httpRequest(
          `${app.url}/weather`,
          {
            headers: {
              ...httpClient.encodePaymentSignatureHeader(payload),
              DPoP: DPOP_PROOF,
              ...headers,
            },
          },
          (response) => {
            const chunks: Buffer[] = [];
            response.on('data', (chunk: Buffer) => chunks.push(chunk));
            response.on('error', reject);
            response.on('end', () => {
              const flat: Record<string, string> = {};
              for (const [name, value] of Object.entries(response.headers)) {
                if (typeof value === 'string') flat[name] = value;
              }
              const text = Buffer.concat(chunks).toString('utf8');
              let body: unknown = text;
              try {
                body = JSON.parse(text);
              } catch {
                // Not JSON (an HTML error page): the status assertion reports it.
              }
              resolve({ status: response.statusCode ?? 0, headers: flat, body });
            });
          }
        );
        request.on('error', reject);
        request.end();
      }
    );
  }

  it('serves and settles the fixture token with the fixture proof', async () => {
    const response = await payFixture({
      Host: new URL(SELLER_URL).host,
      'X-Forwarded-Proto': 'https',
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(BODIES['/weather']);
    expect(app.served).toBe(1);
    expect(app.verified).toBe(1);
    const settlement = httpClient.getPaymentSettleResponse(
      (name) => response.headers[name.toLowerCase()]
    );
    expect(settlement).toMatchObject({
      success: true,
      transaction: PAYMENT_ID,
      network: 'aws:base',
      payer: PAYMENT_PAYER,
    });
  });

  it('dpop_invalid: the same proof on the app own URL (htu is the public URL)', async () => {
    const response = await payFixture({});
    expect(response.status).toBe(402);
    const required = httpClient.getPaymentRequiredResponse(
      (name) => response.headers[name.toLowerCase()],
      response.body
    );
    expect(required.error).toBe('dpop_invalid');
    expect(app.served).toBe(0);
    expect(app.verified).toBe(0);
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

/** SHA-256 of an ASCII string, for a DPoP `ath` */
async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
