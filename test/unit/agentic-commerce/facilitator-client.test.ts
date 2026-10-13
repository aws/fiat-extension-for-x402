// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import * as jose from 'jose';
import { AgenticCommerceFacilitatorClient } from '../../../src/agentic-commerce/facilitator-client';
import type { SellerKeyResolver } from '../../../src/agentic-commerce/keys';
import { enhancePaymentRequirements } from '../../../src/agentic-commerce/exact/quote';
import { DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL, WELL_KNOWN_JWKS_PATH } from '../../../src/constants';
import { ValidationError } from '../../../src/types';
import {
  BUYER,
  FakePaymentService,
  SERVICE_JWKS_BASE_URL,
  SERVICE_JWKS_URL,
  createSeller,
  fetchedHostnames,
  jwksFetch,
  requestUrl,
} from '../../helpers/fake-payment-service';

const SELLER_JWKS_BASE = 'https://keys.seller.example.com';
const SELLER_JWKS_URL = `${SELLER_JWKS_BASE}${WELL_KNOWN_JWKS_PATH}`;
const resolver: SellerKeyResolver = { type: 'jwks', jwksUrl: SELLER_JWKS_BASE };

describe('AgenticCommerceFacilitatorClient constructor', () => {
  it('requires a config with baseUrl', () => {
    expect(() => new AgenticCommerceFacilitatorClient(undefined as unknown as never)).toThrow(
      ValidationError
    );
    expect(
      () => new AgenticCommerceFacilitatorClient({ baseUrl: '', sellerKeyResolver: resolver })
    ).toThrow('requires { baseUrl, sellerKeyResolver }');
  });

  it('requires a seller key resolver (there is no fallback to the quote iss)', () => {
    expect(
      () =>
        new AgenticCommerceFacilitatorClient({
          baseUrl: 'https://facilitator.example.com',
        } as unknown as never)
    ).toThrow('sellerKeyResolver is required');
  });
});

describe('AgenticCommerceFacilitatorClient verify and settle', () => {
  let service: FakePaymentService;
  let seller: Awaited<ReturnType<typeof createSeller>>;
  let fetchStub: ReturnType<typeof jwksFetch>;

  beforeEach(async () => {
    service = await FakePaymentService.create();
    seller = await createSeller();
    fetchStub = jwksFetch({
      [SERVICE_JWKS_URL]: service.jwks,
      [SELLER_JWKS_URL]: { keys: [seller.publicJwk] },
    });
    vi.stubGlobal('fetch', fetchStub);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const route: PaymentRequirements = {
    scheme: 'exact',
    network: 'aws:base',
    asset: 'iso4217:USD',
    amount: '0.10',
    payTo: 'prod-weather',
    maxTimeoutSeconds: 300,
    extra: {},
  };

  function client(getAuthHeaders?: () => Promise<Record<string, string>>) {
    return new AgenticCommerceFacilitatorClient({
      baseUrl: 'https://facilitator.example.com',
      sellerKeyResolver: resolver,
      paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
      getAuthHeaders,
    });
  }

  it('verifies against the quote the buyer accepted, not the re-minted one', async () => {
    const accepted = await enhancePaymentRequirements(route, seller.signer);
    const server = await enhancePaymentRequirements(route, seller.signer);
    const token = await service.issue(accepted.extra.quoteToken as string);
    const payload = {
      x402Version: 2,
      accepted,
      payload: { paymentToken: token },
    } as PaymentPayload;

    expect(await client().verify(payload, server)).toEqual({ isValid: true, payer: BUYER });
  });

  it('sends getAuthHeaders only to the payment-token JWKS host', async () => {
    const accepted = await enhancePaymentRequirements(route, seller.signer);
    const token = await service.issue(accepted.extra.quoteToken as string);
    const payload = {
      x402Version: 2,
      accepted,
      payload: { paymentToken: token },
    } as PaymentPayload;

    await client(() => Promise.resolve({ 'x-access': 'secret' })).verify(payload, accepted);

    const byUrl = Object.fromEntries(
      fetchStub.mock.calls.map(([input, init]) => [requestUrl(input), init?.headers])
    );
    expect(byUrl).toEqual({ [SERVICE_JWKS_URL]: { 'x-access': 'secret' }, [SELLER_JWKS_URL]: {} });
  });

  it('never fetches the quote iss for a buyer-signed quote', async () => {
    const { privateKey } = await jose.generateKeyPair('ES256');
    const now = Math.floor(Date.now() / 1000);
    const quote = await new jose.SignJWT({
      iss: 'https://buyer.example.net',
      aud: 'aws:marketplace',
      iat: now,
      exp: now + 300,
      price: { amount: '0.10', currency: 'USD' },
      payTo: 'prod-weather',
      settlement: { product_id: 'prod-weather' },
    })
      .setProtectedHeader({ alg: 'ES256' })
      .sign(privateKey);
    const accepted = { ...route, extra: { quoteToken: quote } };
    const token = await service.issue(quote);
    const payload = {
      x402Version: 2,
      accepted,
      payload: { paymentToken: token },
    } as PaymentPayload;

    expect(await client().verify(payload, accepted)).toMatchObject({
      isValid: false,
      invalidReason: 'invalid_quote',
    });
    expect(fetchedHostnames(fetchStub)).not.toContain('buyer.example.net');
  });

  it('defaults the payment-token JWKS to the production host', async () => {
    const accepted = await enhancePaymentRequirements(route, seller.signer);
    const token = await service.issue(accepted.extra.quoteToken as string);
    await new AgenticCommerceFacilitatorClient({
      baseUrl: 'https://facilitator.example.com',
      sellerKeyResolver: resolver,
    }).verify({ x402Version: 2, accepted, payload: { paymentToken: token } }, accepted);
    expect(requestUrl(fetchStub.mock.calls[0][0])).toBe(
      `${DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL}${WELL_KNOWN_JWKS_PATH}`
    );
  });

  it("settles with the token's payment_id, not the buyer-supplied paymentId", async () => {
    const token = await service.issue('quote');
    const settled = await client().settle(
      { x402Version: 2, payload: { paymentToken: token, paymentId: 'buyer-chosen' } } as never,
      route
    );
    expect(settled).toEqual({
      success: true,
      transaction: jose.decodeJwt(token).payment_id,
      network: 'aws:base',
      payer: BUYER,
    });
  });
});
