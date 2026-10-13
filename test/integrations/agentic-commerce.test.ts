// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * A seller protected by x402 core's own HTTP server, end to end.
 *
 * x402HTTPResourceServer is what @x402/express and the other framework
 * middlewares wrap. It is driven here through an HTTPAdapter, as those
 * middlewares do, so no socket is opened. Payment tokens are minted by a fake
 * payment service whose JWKS is served by a stubbed fetch. The cases run
 * against both facilitators this package offers: the exact facilitator
 * scheme on an in-process x402 facilitator, and AgenticCommerceFacilitatorClient.
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
import type { Network, PaymentPayload, PaymentRequirements } from '@x402/core/types';
import * as jose from 'jose';
import { FakeBuyerScheme } from '../helpers/fake-buyer-scheme';
import { ExactAgenticCommerceScheme as APServer } from '../../src/agentic-commerce/exact/server';
import { ExactAgenticCommerceScheme as APFacilitator } from '../../src/agentic-commerce/exact/facilitator';
import { registerExactAgenticCommerceServer } from '../../src/agentic-commerce/exact/register';
import { AgenticCommerceFacilitatorClient } from '../../src/agentic-commerce/facilitator-client';
import { AgenticCommerceVerifier } from '../../src/agentic-commerce/verifier';
import { InProcessFacilitatorClient } from '../../src/facilitator-client';
import { SCHEME_EXACT, SENTINEL_PAY_TO } from '../../src/constants';
import {
  BUYER,
  FakePaymentService,
  SELLER_URL,
  SERVICE_JWKS_BASE_URL,
  SERVICE_JWKS_URL,
  createSeller,
  ecKey,
  fetchedHostnames,
  jwksFetch,
} from '../helpers/fake-payment-service';

const FACILITATOR_URL = 'https://facilitator.example.com';

const route = (payTo: string, price: string) => ({
  accepts: { scheme: SCHEME_EXACT, payTo, price, network: 'aws:base' as Network },
  mimeType: 'application/json',
});

const ROUTES = {
  'GET /weather': { ...route('prod-weather', '$0.10'), description: 'Weather' },
  'GET /ping': { ...route('prod-weather', '$0.01'), description: 'Ping' },
  'GET /forecast': { ...route('prod-forecast', '$0.10'), description: 'Forecast' },
};

type FacilitatorKind = 'in-process facilitator' | 'AgenticCommerceFacilitatorClient';

function adapter(path: string, headers: Record<string, string> = {}) {
  const http: HTTPAdapter = {
    getHeader: (name: string) => headers[name],
    getMethod: () => 'GET',
    getPath: () => path,
    getUrl: () => `${SELLER_URL}${path}`,
    getAcceptHeader: () => 'application/json',
    getUserAgent: () => 'TestClient/1.0',
  };
  return { adapter: http, path, method: 'GET' };
}

describe.each<FacilitatorKind>(['in-process facilitator', 'AgenticCommerceFacilitatorClient'])(
  'stock x402HTTPResourceServer with the %s',
  (kind) => {
    let service: FakePaymentService;
    let seller: Awaited<ReturnType<typeof createSeller>>;
    let fetchStub: ReturnType<typeof jwksFetch>;
    let httpClient: x402HTTPClient;

    /** A seller app: the exact server scheme and this test's facilitator */
    async function sellerApp(sellerSigner = seller) {
      const sellerKeyResolver = { type: 'static' as const, publicJwk: sellerSigner.publicJwk };
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
      registerExactAgenticCommerceServer(resourceServer, { signer: sellerSigner.signer });
      await resourceServer.initialize();
      return new x402HTTPResourceServer(resourceServer, ROUTES);
    }

    let app: x402HTTPResourceServer;

    beforeEach(async () => {
      service = await FakePaymentService.create();
      seller = await createSeller();
      fetchStub = jwksFetch({
        [SERVICE_JWKS_URL]: service.jwks,
        [`${FACILITATOR_URL}/.well-known/x402-supported`]: {
          kinds: [{ x402Version: 2, scheme: SCHEME_EXACT, network: 'aws:base' }],
          extensions: [],
          signers: {},
        },
      });
      vi.stubGlobal('fetch', fetchStub);
      // The fake buyer is test-only. x402 core's buyer spend controls (core >= 2.23)
      // accept only default assets with atomic amounts, which fiat prices are not.
      httpClient = new x402HTTPClient(
        new x402Client()
          .setSpendControls(false)
          .register('aws:base', new FakeBuyerScheme({ agenticCommerceClient: service }))
      );
      app = await sellerApp();
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    /** The 402 for an unpaid request, as the buyer receives it */
    async function offer(path: string, server = app) {
      const result = await server.processHTTPRequest(adapter(path));
      expect(result.type).toBe('payment-error');
      const { response } = result as { response: HTTPResponseInstructions };
      expect(response.status).toBe(402);
      return httpClient.getPaymentRequiredResponse((n) => response.headers[n], response.body);
    }

    async function firstAccept(path: string, server = app): Promise<PaymentRequirements> {
      return (await offer(path, server)).accepts[0];
    }

    /** A paid retry carrying `accepted` and `token`, as a buyer sends it */
    async function pay(path: string, accepted: PaymentRequirements, token: string) {
      const payload: PaymentPayload = {
        x402Version: 2,
        accepted,
        payload: { paymentToken: token },
      };
      const headers = await httpClient.encodePaymentSignatureHeader(payload);
      const context = adapter(path, headers);
      return { result: await app.processHTTPRequest(context), context };
    }

    /** The paid retry is refused with a 402 and this error */
    async function expectRejected(
      path: string,
      accepted: PaymentRequirements,
      token: string,
      error: string
    ) {
      const { result } = await pay(path, accepted, token);
      expect(result.type).toBe('payment-error');
      const { response } = result as { response: HTTPResponseInstructions };
      expect(response.status).toBe(402);
      const required = httpClient.getPaymentRequiredResponse(
        (n) => response.headers[n],
        response.body
      );
      expect(required.error).toBe(error);
    }

    const quoteOf = (accepted: PaymentRequirements) => accepted.extra.quoteToken as string;

    it('gets exact requirements with a new quote on each 402', async () => {
      const first = await offer('/weather');
      expect(first.accepts).toHaveLength(1);
      expect(first.accepts[0]).toMatchObject({
        scheme: 'exact',
        network: 'aws:base',
        amount: '0.10',
        asset: 'iso4217:USD',
        payTo: SENTINEL_PAY_TO,
      });
      expect(quoteOf(first.accepts[0])).not.toBe(quoteOf(await firstAccept('/weather')));
    });

    it('serves and settles a valid payment, through the stock buyer client', async () => {
      const paymentPayload = await httpClient.createPaymentPayload(await offer('/weather'));
      const context = adapter(
        '/weather',
        await httpClient.encodePaymentSignatureHeader(paymentPayload)
      );
      const paid = await app.processHTTPRequest(context);

      expect(paid.type).toBe('payment-verified');
      const verified = paid as Extract<typeof paid, { type: 'payment-verified' }>;
      // The server's requirements carry a re-minted quote; the buyer paid the first one.
      expect(quoteOf(verified.paymentRequirements)).not.toBe(quoteOf(paymentPayload.accepted));

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
        const receipt = httpClient.getPaymentSettleResponse((n) => settlement.headers[n]);
        const token = (paymentPayload.payload as { paymentToken: string }).paymentToken;
        expect(receipt).toMatchObject({
          success: true,
          transaction: jose.decodeJwt(token).payment_id,
          network: 'aws:base',
          payer: BUYER,
        });
      }
    });

    it('fetches only the service JWKS (and the facilitator kinds), never a token iss', async () => {
      const accepted = await firstAccept('/weather');
      const { result } = await pay('/weather', accepted, await service.issue(quoteOf(accepted)));
      expect(result.type).toBe('payment-verified');
      const hosts = new Set(fetchedHostnames(fetchStub));
      hosts.delete(new URL(SERVICE_JWKS_URL).hostname);
      hosts.delete(new URL(FACILITATOR_URL).hostname);
      expect([...hosts]).toEqual([]);
    });

    describe('rejected payments (VERIFIER-GAP probes)', () => {
      it('a token issued for a different quote', async () => {
        const accepted = await firstAccept('/weather');
        const other = await firstAccept('/weather');
        await expectRejected(
          '/weather',
          accepted,
          await service.issue(quoteOf(other)),
          'invalid_quote'
        );
      });

      it('a payment for a cheaper route', async () => {
        const cheap = await firstAccept('/ping');
        const token = await service.issue(quoteOf(cheap));
        await expectRejected('/weather', cheap, token, 'No matching payment requirements');
      });

      it('a payment for a cheaper route with the price relabelled', async () => {
        const cheap = await firstAccept('/ping');
        const token = await service.issue(quoteOf(cheap));
        await expectRejected('/weather', { ...cheap, amount: '0.10' }, token, 'invalid_payment');
      });

      it('a quote for another product at the same price', async () => {
        const forecast = await firstAccept('/forecast');
        const token = await service.issue(quoteOf(forecast));
        await expectRejected('/weather', forecast, token, 'invalid_payment');
      });

      it('a quote signed by another seller', async () => {
        const otherSeller = await createSeller('https://other.example.com');
        const foreign = await firstAccept('/weather', await sellerApp(otherSeller));
        const token = await service.issue(quoteOf(foreign));
        await expectRejected('/weather', foreign, token, 'invalid_quote');
      });

      it('a quote the buyer signed with their own key', async () => {
        const accepted = await firstAccept('/weather');
        const buyerKey = await ecKey('buyer-key');
        const own = jose.decodeJwt(quoteOf(accepted));
        const forged = await new jose.SignJWT({ ...own, iss: 'https://buyer.example.net' })
          .setProtectedHeader({ alg: 'ES256' })
          .sign(buyerKey.privateKey);
        const token = await service.issue(forged);
        await expectRejected(
          '/weather',
          { ...accepted, extra: { ...accepted.extra, quoteToken: forged } },
          token,
          'invalid_quote'
        );
        expect(fetchedHostnames(fetchStub)).not.toContain('buyer.example.net');
      });

      it('a token whose audience is not the quote issuer', async () => {
        const accepted = await firstAccept('/weather');
        const token = await service.issue(quoteOf(accepted), {
          audience: 'https://other.example.com',
        });
        await expectRejected('/weather', accepted, token, 'invalid_payment');
      });

      it('an expired payment token', async () => {
        const accepted = await firstAccept('/weather');
        const token = await service.issue(quoteOf(accepted), { expiresIn: -1 });
        await expectRejected('/weather', accepted, token, 'payment_expired');
      });

      it('an expired quote', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(1_790_000_000_000);
        const accepted = await firstAccept('/weather');
        vi.setSystemTime(1_790_000_000_000 + 301_000);
        const token = await service.issue(quoteOf(accepted));
        await expectRejected('/weather', accepted, token, 'quote_expired');
      });

      it('a token with another issuer claim', async () => {
        const accepted = await firstAccept('/weather');
        const token = await service.issue(quoteOf(accepted), { issuer: 'someone-else' });
        await expectRejected('/weather', accepted, token, 'invalid_payment');
      });

      it('a token not issued by the service', async () => {
        const accepted = await firstAccept('/weather');
        const forger = await FakePaymentService.create();
        await expectRejected(
          '/weather',
          accepted,
          await forger.issue(quoteOf(accepted)),
          'invalid_payment'
        );
      });
    });
  }
);

describe('the facilitator without the HTTP layer', () => {
  it('verifies an enhanced requirement and lists the exact kind', async () => {
    const service = await FakePaymentService.create();
    const seller = await createSeller();
    vi.stubGlobal('fetch', jwksFetch({ [SERVICE_JWKS_URL]: service.jwks }));
    try {
      const verifier = new AgenticCommerceVerifier({
        sellerKeyResolver: { type: 'static', publicJwk: seller.publicJwk },
        paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
      });
      const facilitator = new x402Facilitator().register(
        'aws:base',
        new APFacilitator({ verifier })
      );
      const requirements = await new APServer({ signer: seller.signer }).enhancePaymentRequirements(
        {
          scheme: 'exact',
          network: 'aws:base',
          asset: 'iso4217:USD',
          amount: '1.00',
          payTo: 'seller-1',
          maxTimeoutSeconds: 300,
          extra: {},
        },
        { x402Version: 2, scheme: 'exact', network: 'aws:base' },
        []
      );
      const token = await service.issue(requirements.extra.quoteToken as string);
      const result = await facilitator.verify(
        { x402Version: 2, accepted: requirements, payload: { paymentToken: token } },
        requirements
      );
      expect(result.isValid).toBe(true);
      expect(facilitator.getSupported().kinds.map((k) => [k.scheme, k.network])).toEqual([
        ['exact', 'aws:base'],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
