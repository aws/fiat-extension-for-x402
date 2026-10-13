// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { x402Client } from '@x402/core/client';
import { x402Facilitator } from '@x402/core/facilitator';
import { x402ResourceServer } from '@x402/core/server';
import * as jose from 'jose';
import { FakeBuyerScheme } from '../helpers/fake-buyer-scheme';
import { ExactAgenticCommerceScheme as APServer } from '../../src/agentic-commerce/exact/server';
import { ExactAgenticCommerceScheme as APFacilitator } from '../../src/agentic-commerce/exact/facilitator';
import { AgenticCommerceVerifier } from '../../src/agentic-commerce/verifier';
import { InProcessFacilitatorClient } from '../../src/facilitator-client';
import { SCHEME_EXACT, SENTINEL_PAY_TO } from '../../src/constants';
import {
  FakePaymentService,
  SERVICE_JWKS_BASE_URL,
  SERVICE_JWKS_URL,
  createSeller,
  jwksFetch,
} from '../helpers/fake-payment-service';

/**
 * Multi-network integration: one exact facilitator scheme serves several
 * networks, and the stock resource server routes each payment to it.
 */
describe('Multi-Facilitator Integration Tests', () => {
  let client: x402Client;
  let server: x402ResourceServer;
  let seller: Awaited<ReturnType<typeof createSeller>>;

  beforeEach(async () => {
    const service = await FakePaymentService.create();
    seller = await createSeller();
    vi.stubGlobal('fetch', jwksFetch({ [SERVICE_JWKS_URL]: service.jwks }));

    // The fake buyer is test-only. x402 core's buyer spend controls (core >= 2.23)
    // accept only default assets with atomic amounts, which fiat prices are not.
    client = new x402Client().setSpendControls(false);
    const buyer = new FakeBuyerScheme({ agenticCommerceClient: service });
    client.register('fab:aws', buyer);
    client.register('eip155:8453', buyer);

    const verifier = new AgenticCommerceVerifier({
      sellerKeyResolver: { type: 'static', publicJwk: seller.publicJwk },
      paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
    });
    const facilitator = new x402Facilitator().register(
      ['fab:aws', 'eip155:8453'],
      new APFacilitator({ verifier })
    );
    server = new x402ResourceServer(new InProcessFacilitatorClient(facilitator));
    server.register('fab:aws', new APServer({ signer: seller.signer }));
    server.register('eip155:8453', new APServer({ signer: seller.signer }));
    await server.initialize();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['fab:aws', 'eip155:8453'] as const)(
    'completes the full payment flow on %s',
    async (network) => {
      const accepts = await server.buildPaymentRequirements({
        scheme: SCHEME_EXACT,
        network,
        payTo: 'service-pay',
        price: 0.15,
      });
      expect(accepts).toHaveLength(1);
      expect(accepts[0].payTo).toBe(SENTINEL_PAY_TO);

      const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
        url: 'https://example.com/resource',
        description: 'Test resource',
        mimeType: 'application/json',
      });
      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.accepted.network).toBe(network);

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      expect(accepted).toBeDefined();
      expect(await server.verifyPayment(paymentPayload, accepted!)).toMatchObject({
        isValid: true,
      });
      const settled = await server.settlePayment(paymentPayload, accepted!);
      expect(settled).toMatchObject({ success: true, network });
    }
  );

  it('signs quotes that verify against the seller key', async () => {
    const [accept] = await server.buildPaymentRequirements({
      scheme: SCHEME_EXACT,
      network: 'fab:aws',
      payTo: 'service-pay',
      price: 0.15,
    });
    const quoteToken = (accept.extra as { quoteToken: string }).quoteToken;
    const { payload } = await jose.jwtVerify(quoteToken, await jose.importJWK(seller.publicJwk));
    expect(payload.iss).toBe('https://seller.example.com');
  });
});
