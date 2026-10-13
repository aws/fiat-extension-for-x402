// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The exact facilitator scheme: verify and settle for agentic-commerce payments.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { ExactAgenticCommerceScheme } from '../../../../src/agentic-commerce/exact/facilitator';
import { enhancePaymentRequirements } from '../../../../src/agentic-commerce/exact/quote';
import { AgenticCommerceVerifier } from '../../../../src/agentic-commerce/verifier';
import { ValidationError } from '../../../../src/types';
import {
  BUYER,
  FakePaymentService,
  SERVICE_JWKS_BASE_URL,
  SERVICE_JWKS_URL,
  createSeller,
  jwksFetch,
} from '../../../helpers/fake-payment-service';
import { generateDPoPKeyPair } from '../../../helpers/dpop';

const ROUTE: PaymentRequirements = {
  scheme: 'exact',
  network: 'aws:base',
  asset: 'iso4217:USD',
  amount: '0.10',
  payTo: 'prod-weather',
  maxTimeoutSeconds: 300,
  extra: { description: 'Weather' },
};

let service: FakePaymentService;
let seller: Awaited<ReturnType<typeof createSeller>>;
let scheme: ExactAgenticCommerceScheme;

beforeEach(async () => {
  service = await FakePaymentService.create();
  seller = await createSeller();
  vi.stubGlobal('fetch', jwksFetch({ [SERVICE_JWKS_URL]: service.jwks }));
  scheme = new ExactAgenticCommerceScheme({
    verifier: new AgenticCommerceVerifier({
      sellerKeyResolver: { type: 'static', publicJwk: seller.publicJwk },
      paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The server's requirements for a route, with a freshly signed quote */
function offer(route: PaymentRequirements = ROUTE) {
  return enhancePaymentRequirements(route, seller.signer);
}

function quoteOf(requirements: PaymentRequirements): string {
  return requirements.extra.quoteToken as string;
}

function payload(accepted: PaymentRequirements, paymentToken: unknown): PaymentPayload {
  return { x402Version: 2, accepted, payload: { paymentToken } } as PaymentPayload;
}

describe('ExactAgenticCommerceFacilitatorScheme', () => {
  it('is the exact scheme on the aws:* family, with no extra and no signers', () => {
    expect(scheme.scheme).toBe('exact');
    expect(scheme.caipFamily).toBe('aws:*');
    expect(scheme.getExtra()).toBeUndefined();
    expect(scheme.getSigners()).toEqual([]);
    expect(scheme.verifier).toBeInstanceOf(AgenticCommerceVerifier);
  });

  it('requires a verifier', () => {
    expect(
      () => new ExactAgenticCommerceScheme({} as unknown as { verifier: AgenticCommerceVerifier })
    ).toThrow(ValidationError);
  });

  describe('verify', () => {
    it('verifies the quote the buyer accepted against the re-minted server requirements', async () => {
      const accepted = await offer();
      const server = await offer();
      expect(quoteOf(server)).not.toBe(quoteOf(accepted));
      const token = await service.issue(quoteOf(accepted));

      expect(await scheme.verify(payload(accepted, token), server)).toEqual({
        isValid: true,
        payer: BUYER,
      });
    });

    it.each([[undefined], [''], [42]])('rejects a paymentToken of %j', async (paymentToken) => {
      const accepted = await offer();
      expect(await scheme.verify(payload(accepted, paymentToken), accepted)).toEqual({
        isValid: false,
        invalidReason: 'invalid_payment',
        invalidMessage: 'Missing paymentToken in payment payload',
      });
    });

    it('takes the price from the server requirements, not from accepted', async () => {
      const cheap = await offer({ ...ROUTE, amount: '0.01' });
      const token = await service.issue(quoteOf(cheap));
      const relabelled = { ...cheap, amount: '0.10' };
      expect(await scheme.verify(payload(relabelled, token), await offer())).toMatchObject({
        isValid: false,
        invalidReason: 'invalid_payment',
        invalidMessage: 'Amount or currency mismatch',
      });
    });

    it('ignores the amount in accepted, even when it matches the quote', async () => {
      const cheap = await offer({ ...ROUTE, amount: '0.01' });
      const token = await service.issue(quoteOf(cheap));
      expect(await scheme.verify(payload(cheap, token), await offer())).toMatchObject({
        isValid: false,
        invalidMessage: 'Amount or currency mismatch',
      });
    });

    it('rejects a quote for another product on the route', async () => {
      const other = await offer({ ...ROUTE, payTo: 'prod-other' });
      const token = await service.issue(quoteOf(other));
      expect(await scheme.verify(payload(other, token), await offer())).toMatchObject({
        isValid: false,
        invalidReason: 'invalid_payment',
        invalidMessage: 'Quote is for a different product',
      });
    });

    it('fails closed when the server requirements carry no quote', async () => {
      const accepted = await offer();
      const token = await service.issue(quoteOf(accepted));
      const { quoteToken: _q, ...extra } = accepted.extra;
      expect(await scheme.verify(payload(accepted, token), { ...accepted, extra })).toMatchObject({
        isValid: false,
        invalidMessage: 'Quote is for a different product',
      });
    });

    it('uses the server requirements quote and maxAmountRequired for v1 payloads', async () => {
      const server = await offer();
      const token = await service.issue(quoteOf(server));
      const { amount: _a, ...rest } = server;
      const v1Requirements = {
        ...rest,
        maxAmountRequired: '0.10',
      } as unknown as PaymentRequirements;
      const v1Payload = {
        x402Version: 1,
        payload: { paymentToken: token },
      } as unknown as PaymentPayload;
      expect(await scheme.verify(v1Payload, v1Requirements)).toEqual({
        isValid: true,
        payer: BUYER,
      });
    });

    it('does not check DPoP: the server scheme does, before verify', async () => {
      const accepted = await offer();
      const dpop = await generateDPoPKeyPair('ES256');
      const token = await service.issue(quoteOf(accepted), { dpopJwk: dpop.publicKey });
      expect(await scheme.verify(payload(accepted, token), accepted)).toEqual({
        isValid: true,
        payer: BUYER,
      });
    });
  });

  describe('settle', () => {
    it("returns the token's payment_id and sub, without verifying", async () => {
      const accepted = await offer();
      const token = await service.issue('any-quote');
      const result = await scheme.settle(
        {
          ...payload(accepted, token),
          payload: { paymentToken: token, paymentId: 'buyer-chosen' },
        },
        accepted
      );
      expect(result).toEqual({
        success: true,
        transaction: jose.decodeJwt(token).payment_id,
        network: 'aws:base',
        payer: BUYER,
      });
    });

    it('settles an undecodable or id-less token with an empty transaction', async () => {
      const accepted = await offer();
      expect(await scheme.settle(payload(accepted, 'garbage'), accepted)).toEqual({
        success: true,
        transaction: '',
        network: 'aws:base',
      });
      const noId = await service.issue('q', { claims: { payment_id: undefined, sub: undefined } });
      expect(await scheme.settle(payload(accepted, noId), accepted)).toEqual({
        success: true,
        transaction: '',
        network: 'aws:base',
      });
    });
  });
});
