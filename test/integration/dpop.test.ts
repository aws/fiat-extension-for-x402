// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * DPoP-bound payment tokens on x402 core's own HTTP server, end to end.
 *
 * The exact server scheme checks the DPoP proof in its onBeforeVerify hook,
 * before x402 core calls the facilitator. The request is driven through an HTTPAdapter, as the framework middlewares do,
 * so no socket is opened. The payment token and the valid proof are the fixed
 * test vectors, checked at FIXED_NOW+10; the other
 * proofs are signed here with the fixture buyer key.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { x402Facilitator } from '@x402/core/facilitator';
import {
  type FacilitatorClient,
  type HTTPAdapter,
  type HTTPResponseInstructions,
  x402HTTPResourceServer,
  x402ResourceServer,
} from '@x402/core/server';
import type { Network, PaymentPayload } from '@x402/core/types';
import { createHash } from 'node:crypto';
import * as jose from 'jose';
import { ExactAgenticCommerceScheme as APFacilitator } from '../../src/agentic-commerce/exact/facilitator';
import { registerExactAgenticCommerceServer } from '../../src/agentic-commerce/exact/register';
import { AgenticCommerceFacilitatorClient } from '../../src/agentic-commerce/facilitator-client';
import { AgenticCommerceVerifier } from '../../src/agentic-commerce/verifier';
import { InProcessFacilitatorClient } from '../../src/facilitator-client';
import { SCHEME_EXACT } from '../../src/constants';
import { computeJWKThumbprint } from '../../src/dpop';
import type { DPoPNonceStore } from '../../src/types';
import {
  BUYER_PUBLIC_JWK,
  buyerPrivateKey,
  DPOP_ATH,
  DPOP_HTU,
  DPOP_PROOF,
  FIXED_NOW,
  PAYMENT_ID,
  PAYMENT_PAYER,
  PAYMENT_TOKEN,
  QUOTE_OUTPUT,
  SELLER_PUBLIC_JWK,
  SELLER_URL,
  SERVICE_JWKS,
} from '../helpers/fixed-vectors';
import { createSeller, jwksFetch, requestUrl } from '../helpers/fake-payment-service';

const SERVICE_JWKS_BASE_URL = 'https://jwks.payments.test';
const SERVICE_JWKS_URL = `${SERVICE_JWKS_BASE_URL}/.well-known/jwks.json`;
const FACILITATOR_URL = 'https://facilitator.example.com';

// The route the fixture quote was signed for.
const ROUTES = {
  'GET /weather': {
    accepts: {
      scheme: SCHEME_EXACT,
      payTo: 'prod-fixture123',
      price: '$0.10',
      network: 'aws:base' as Network,
      extra: { description: 'Weather', settlement: { mode: 'immediate' } },
    },
    mimeType: 'application/json',
  },
};

type FacilitatorKind = 'in-process facilitator' | 'AgenticCommerceFacilitatorClient';

interface Request {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
}

function adapter({ method = 'GET', url = DPOP_HTU, headers = {} }: Request) {
  const path = new URL(url).pathname;
  const http: HTTPAdapter = {
    getHeader: (name: string) => headers[name],
    getMethod: () => method,
    getPath: () => path,
    getUrl: () => url,
    getAcceptHeader: () => 'application/json',
    getUserAgent: () => 'TestClient/1.0',
  };
  return { adapter: http, path, method };
}

/** A nonce store that remembers every `add`, and forgets an id at its expiry */
class RecordingNonceStore implements DPoPNonceStore {
  readonly added: [string, number][] = [];
  has(jti: string): boolean {
    const now = Date.now() / 1000;
    return this.added.some(([seen, expiresAt]) => seen === jti && now < expiresAt);
  }
  add(jti: string, expiresAt: number): void {
    this.added.push([jti, expiresAt]);
  }
}

const b64 = (value: unknown) => jose.base64url.encode(JSON.stringify(value));

/** A DPoP proof signed with the fixture buyer key, overriding the fixture's claims */
async function proof(
  options: {
    claims?: Record<string, unknown>;
    header?: Record<string, unknown>;
    key?: jose.KeyLike | Uint8Array;
  } = {}
): Promise<string> {
  const claims = {
    jti: `dpop-${crypto.randomUUID()}`,
    htm: 'GET',
    htu: DPOP_HTU,
    iat: FIXED_NOW,
    ath: DPOP_ATH,
    ...options.claims,
  };
  const header = { alg: 'ES256', typ: 'dpop+jwt', jwk: BUYER_PUBLIC_JWK, ...options.header };
  const key = options.key ?? buyerPrivateKey();
  return new jose.SignJWT(claims).setProtectedHeader(header).sign(key);
}

describe.each<FacilitatorKind>(['in-process facilitator', 'AgenticCommerceFacilitatorClient'])(
  'DPoP on the stock x402HTTPResourceServer with the %s',
  (kind) => {
    let fetchStub: ReturnType<typeof jwksFetch>;
    const httpClient = new x402HTTPClient(new x402Client());

    async function sellerApp(
      dpop: { dpopNonceStore?: DPoPNonceStore; dpopMaxAgeSeconds?: number } = {}
    ) {
      const sellerKeyResolver = { type: 'static' as const, publicJwk: SELLER_PUBLIC_JWK };
      let facilitatorClient: FacilitatorClient;
      if (kind === 'in-process facilitator') {
        const verifier = new AgenticCommerceVerifier({
          sellerKeyResolver,
          paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
        });
        facilitatorClient = new InProcessFacilitatorClient(
          new x402Facilitator().register('aws:base', new APFacilitator({ verifier }))
        );
      } else {
        facilitatorClient = new AgenticCommerceFacilitatorClient({
          baseUrl: FACILITATOR_URL,
          sellerKeyResolver,
          paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
        });
      }
      const resourceServer = new x402ResourceServer(facilitatorClient);
      // Any key signs the server's own quotes; the buyer pays the fixture quote.
      const { signer } = await createSeller(SELLER_URL);
      registerExactAgenticCommerceServer(resourceServer, { ...dpop, signer });
      await resourceServer.initialize();
      return new x402HTTPResourceServer(resourceServer, ROUTES);
    }

    /** How often the facilitator fetched the payment service's JWKS */
    const jwksFetches = () =>
      fetchStub.mock.calls.filter(([input]) => requestUrl(input) === SERVICE_JWKS_URL).length;

    beforeEach(() => {
      fetchStub = jwksFetch({
        [SERVICE_JWKS_URL]: SERVICE_JWKS,
        [`${FACILITATOR_URL}/.well-known/x402-supported`]: {
          kinds: [{ x402Version: 2, scheme: SCHEME_EXACT, network: 'aws:base' }],
          extensions: [],
          signers: {},
        },
      });
      vi.stubGlobal('fetch', fetchStub);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime((FIXED_NOW + 10) * 1000);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    /** The fixture payment, retried with `dpopHeaders` */
    async function pay(
      app: x402HTTPResourceServer,
      request: Request = {},
      paymentToken = PAYMENT_TOKEN
    ) {
      const payload: PaymentPayload = {
        x402Version: 2,
        accepted: QUOTE_OUTPUT,
        payload: { paymentToken },
      };
      const context = adapter({
        ...request,
        headers: { ...request.headers, ...httpClient.encodePaymentSignatureHeader(payload) },
      });
      return { result: await app.processHTTPRequest(context), context };
    }

    async function expectVerified(app: x402HTTPResourceServer, request: Request) {
      const { result } = await pay(app, request);
      expect(result.type).toBe('payment-verified');
      expect(jwksFetches()).toBe(1);
    }

    /** Refused with a 402 and this reason, by default before the facilitator is called */
    async function expectRejected(
      app: x402HTTPResourceServer,
      request: Request,
      reason: string,
      { afterFacilitator = false } = {}
    ) {
      const { result } = await pay(app, request);
      expect(result.type).toBe('payment-error');
      const { response } = result as { response: HTTPResponseInstructions };
      expect(response.status).toBe(402);
      const required = httpClient.getPaymentRequiredResponse(
        (n) => response.headers[n],
        response.body
      );
      expect(required.error).toBe(reason);
      if (!afterFacilitator) {
        expect(jwksFetches()).toBe(0);
      }
    }

    const withProof = (dpop: string, request: Request = {}): Request => ({
      ...request,
      headers: { DPoP: dpop },
    });

    describe('accepted', () => {
      it('verifies and settles the fixture token with the fixture proof', async () => {
        const app = await sellerApp();
        const { result, context } = await pay(app, withProof(DPOP_PROOF));
        expect(result.type).toBe('payment-verified');
        const verified = result as Extract<typeof result, { type: 'payment-verified' }>;

        const settlement = await app.processSettlement(
          verified.paymentPayload,
          verified.paymentRequirements,
          verified.declaredExtensions,
          { request: context, responseBody: Buffer.from('{}'), responseHeaders: {} },
          undefined,
          verified.beforeHandlerSettlement
        );
        expect(settlement.success).toBe(true);
        if (settlement.success) {
          expect(httpClient.getPaymentSettleResponse((n) => settlement.headers[n])).toMatchObject({
            success: true,
            transaction: PAYMENT_ID,
            network: 'aws:base',
            payer: PAYMENT_PAYER,
          });
        }
      });

      it('compares htu without the query and fragment', async () => {
        const app = await sellerApp();
        await expectVerified(app, withProof(DPOP_PROOF, { url: `${DPOP_HTU}?city=Seattle#now` }));
      });

      it('reads the proof from a lowercase dpop header', async () => {
        const app = await sellerApp();
        await expectVerified(app, { headers: { dpop: DPOP_PROOF } });
      });

      it('compares typ case-insensitively and the method upper-cased', async () => {
        const app = await sellerApp();
        const upper = await proof({ header: { typ: 'DPoP+JWT' } });
        await expectVerified(app, withProof(upper, { method: 'get' }));
      });

      it('accepts a proof 65 seconds old, the default maximum age plus the skew', async () => {
        vi.setSystemTime((FIXED_NOW + 65) * 1000);
        const app = await sellerApp();
        await expectVerified(app, withProof(DPOP_PROOF));
      });

      it('accepts a proof issued 5 seconds in the future', async () => {
        const app = await sellerApp();
        await expectVerified(app, withProof(await proof({ claims: { iat: FIXED_NOW + 15 } })));
      });

      it('records the proof in the nonce store until the second after it stops being fresh', async () => {
        const store = new RecordingNonceStore();
        const app = await sellerApp({ dpopNonceStore: store });
        await expectVerified(app, withProof(DPOP_PROOF));
        // Fresh up to iat + 60 + 5 seconds of skew.
        expect(store.added).toEqual([['dpop-fixture-0001', FIXED_NOW + 66]]);
      });
    });

    describe('rejected before the facilitator is called', () => {
      it('dpop_required: no DPoP header', async () => {
        await expectRejected(await sellerApp(), {}, 'dpop_required');
      });

      it('dpop_required: an empty DPoP header', async () => {
        await expectRejected(await sellerApp(), withProof(''), 'dpop_required');
      });

      it('dpop_invalid: a proof signed by another key (thumbprint mismatch)', async () => {
        const other = await jose.generateKeyPair('ES256');
        const otherProof = await proof({
          header: { jwk: await jose.exportJWK(other.publicKey) },
          key: other.privateKey,
        });
        await expectRejected(await sellerApp(), withProof(otherProof), 'dpop_invalid');
      });

      it('dpop_invalid: a wrong typ', async () => {
        const typ = await proof({ header: { typ: 'JWT' } });
        await expectRejected(await sellerApp(), withProof(typ), 'dpop_invalid');
      });

      it('dpop_invalid: an HS256 proof', async () => {
        const hs256 = await proof({
          header: { alg: 'HS256' },
          key: new TextEncoder().encode('a-shared-secret-that-is-at-least-32-bytes'),
        });
        await expectRejected(await sellerApp(), withProof(hs256), 'dpop_invalid');
      });

      it('dpop_invalid: an unsigned (alg none) proof', async () => {
        const [, body] = DPOP_PROOF.split('.');
        const none = `${b64({ alg: 'none', typ: 'dpop+jwt', jwk: BUYER_PUBLIC_JWK })}.${body}.`;
        await expectRejected(await sellerApp(), withProof(none), 'dpop_invalid');
      });

      it('dpop_invalid: a proof for another method (htm)', async () => {
        const post = await proof({ claims: { htm: 'POST' } });
        await expectRejected(await sellerApp(), withProof(post), 'dpop_invalid');
      });

      it('dpop_invalid: a proof for another URL (htu)', async () => {
        const other = await proof({ claims: { htu: `${SELLER_URL}/other` } });
        await expectRejected(await sellerApp(), withProof(other), 'dpop_invalid');
      });

      it('dpop_invalid: htu is not normalised (host case, port, trailing slash)', async () => {
        const app = await sellerApp();
        for (const url of [
          'https://SELLER.example.com/weather',
          'https://seller.example.com:443/weather',
        ]) {
          await expectRejected(app, withProof(DPOP_PROOF, { url }), 'dpop_invalid');
        }
        const slash = await proof({ claims: { htu: `${DPOP_HTU}/` } });
        await expectRejected(app, withProof(slash), 'dpop_invalid');
      });

      it('dpop_invalid: a stale proof (iat 66 seconds ago)', async () => {
        vi.setSystemTime((FIXED_NOW + 66) * 1000);
        await expectRejected(await sellerApp(), withProof(DPOP_PROOF), 'dpop_invalid');
      });

      it('dpop_invalid: a stale proof under dpopMaxAgeSeconds', async () => {
        const app = await sellerApp({ dpopMaxAgeSeconds: 4 });
        await expectRejected(app, withProof(DPOP_PROOF), 'dpop_invalid');
      });

      it('dpop_invalid: a proof issued in the future (iat 6 seconds ahead)', async () => {
        const future = await proof({ claims: { iat: FIXED_NOW + 16 } });
        await expectRejected(await sellerApp(), withProof(future), 'dpop_invalid');
      });

      it('dpop_invalid: a proof over another token (ath)', async () => {
        const otherAth = await proof({ claims: { ath: jose.base64url.encode('x'.repeat(32)) } });
        await expectRejected(await sellerApp(), withProof(otherAth), 'dpop_invalid');
      });

      it('dpop_invalid: a proof without ath', async () => {
        const noAth = await proof({ claims: { ath: undefined } });
        await expectRejected(await sellerApp(), withProof(noAth), 'dpop_invalid');
      });
    });

    describe('rejected after the facilitator accepts the token', () => {
      // The proof id is checked and recorded only for a token the facilitator
      // accepted, so a forged token cannot add ids to the store.
      it('dpop_invalid: a replayed proof, with a nonce store', async () => {
        const store = new RecordingNonceStore();
        const app = await sellerApp({ dpopNonceStore: store });
        await expectVerified(app, withProof(DPOP_PROOF));
        await expectRejected(app, withProof(DPOP_PROOF), 'dpop_invalid', {
          afterFacilitator: true,
        });
        expect(store.added).toHaveLength(1);
      });
    });

    describe('a forged payment token', () => {
      it('is rejected by the facilitator and adds nothing to the nonce store', async () => {
        // The fixture token's claims and header, bound to the attacker's DPoP
        // key and signed with a key the payment service never published.
        const attacker = await jose.generateKeyPair('ES256');
        const attackerJwk = await jose.exportJWK(attacker.publicKey);
        const header = jose.decodeProtectedHeader(PAYMENT_TOKEN) as jose.JWTHeaderParameters;
        const untrusted = await jose.generateKeyPair(header.alg);
        const forged = await new jose.SignJWT({
          ...jose.decodeJwt(PAYMENT_TOKEN),
          cnf: { jkt: await computeJWKThumbprint(attackerJwk) },
        })
          .setProtectedHeader(header)
          .sign(untrusted.privateKey);
        const forgedProof = await proof({
          claims: {
            ath: createHash('sha256').update(forged).digest('base64url'),
          },
          header: { jwk: attackerJwk },
          key: attacker.privateKey,
        });
        const store = new RecordingNonceStore();
        const app = await sellerApp({ dpopNonceStore: store });
        const { result } = await pay(app, withProof(forgedProof), forged);
        expect(result.type).toBe('payment-error');
        expect(store.added).toEqual([]);
      });
    });
  }
);
