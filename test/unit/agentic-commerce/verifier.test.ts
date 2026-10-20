// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * AgenticCommerceVerifier: every check, in the order the verifier runs them,
 * with one passing and one failing case each.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicKey } from 'node:crypto';
import * as jose from 'jose';
import type { PaymentRequirements } from '@x402/core/types';
import {
  AgenticCommerceVerifier,
  type AgenticCommerceVerifierConfig,
  type VerificationRequirements,
} from '../../../src/agentic-commerce/verifier';
import type { SellerKeyResolver } from '../../../src/agentic-commerce/keys';
import { enhancePaymentRequirements } from '../../../src/agentic-commerce/exact/quote';
import { DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL } from '../../../src/constants';
import { ValidationError } from '../../../src/types';
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
  requestUrl,
} from '../../helpers/fake-payment-service';
import * as fixtures from '../../helpers/fixed-vectors';

const PRODUCT = 'prod-abc123';

let service: FakePaymentService;
let seller: Awaited<ReturnType<typeof createSeller>>;
let fetchStub: ReturnType<typeof jwksFetch>;

beforeEach(async () => {
  service = await FakePaymentService.create();
  seller = await createSeller();
  fetchStub = jwksFetch({ [SERVICE_JWKS_URL]: service.jwks });
  vi.stubGlobal('fetch', fetchStub);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function verifier(overrides: Partial<AgenticCommerceVerifierConfig> = {}) {
  return new AgenticCommerceVerifier({
    sellerKeyResolver: { type: 'static', publicJwk: seller.publicJwk },
    paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
    ...overrides,
  });
}

/** A quote signed by the seller with this SDK's own server code */
async function sellerQuote(amount = '0.10', productId = PRODUCT): Promise<string> {
  const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: 'aws:base',
    asset: 'iso4217:USD',
    amount,
    payTo: productId,
    maxTimeoutSeconds: 300,
    extra: {},
  };
  const enhanced = await enhancePaymentRequirements(requirements, seller.signer);
  return enhanced.extra.quoteToken as string;
}

/** A quote with chosen claims (`undefined` removes one), signed by `key` */
async function customQuote(
  claims: Record<string, unknown> = {},
  key: jose.KeyLike = seller.privateKey,
  header: jose.JWTHeaderParameters = { alg: 'ES256' }
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const all: Record<string, unknown> = {
    iss: SELLER_URL,
    aud: 'aws:marketplace',
    iat: now,
    exp: now + 300,
    jti: 'quote-1',
    price: { amount: '0.10', currency: 'USD' },
    payTo: PRODUCT,
    reference: 'RESOURCE',
    settlement: { product_id: PRODUCT },
  };
  for (const [name, value] of Object.entries(claims)) {
    if (value === undefined) delete all[name];
    else all[name] = value;
  }
  return new jose.SignJWT(all).setProtectedHeader(header).sign(key);
}

function wire(quoteToken: unknown, overrides: VerificationRequirements = {}) {
  return { amount: '0.10', asset: 'iso4217:USD', extra: { quoteToken }, ...overrides };
}

async function expectValid(token: string, requirements: VerificationRequirements, v = verifier()) {
  const result = await v.verify(token, requirements);
  expect(result).toMatchObject({ isValid: true });
  return result;
}

async function expectInvalid(
  token: string,
  requirements: VerificationRequirements,
  reason: string,
  message: string,
  v = verifier()
) {
  expect(await v.verify(token, requirements)).toEqual({
    isValid: false,
    invalidReason: reason,
    invalidMessage: message,
  });
}

describe('AgenticCommerceVerifier', () => {
  describe('configuration', () => {
    it('requires a seller key resolver', () => {
      expect(
        () => new AgenticCommerceVerifier({} as unknown as AgenticCommerceVerifierConfig)
      ).toThrow(ValidationError);
      expect(
        () =>
          new AgenticCommerceVerifier({
            sellerKeyResolver: { type: 'issuer' } as unknown as SellerKeyResolver,
          })
      ).toThrow('sellerKeyResolver is required');
    });

    it.each([
      ['kms without an ARN', { type: 'kms', region: 'us-east-1' }],
      ['kms without a region', { type: 'kms', kmsKeyArn: 'arn' }],
      ['jwks without a URL', { type: 'jwks' }],
      ['jwks with an empty URL', { type: 'jwks', jwksUrl: ' ' }],
      ['static without a JWK', { type: 'static' }],
    ])('rejects a resolver: %s', (_name, resolver) => {
      expect(
        () =>
          new AgenticCommerceVerifier({
            sellerKeyResolver: resolver as unknown as SellerKeyResolver,
          })
      ).toThrow('sellerKeyResolver is required');
    });

    it('does not follow redirects from a JWKS URL', async () => {
      const quote = await sellerQuote();
      const token = await service.issue(quote);
      const stub = vi.fn(() =>
        Promise.resolve(
          new Response(null, { status: 302, headers: { location: 'https://elsewhere.example' } })
        )
      );
      vi.stubGlobal('fetch', stub);
      await expectInvalid(
        token,
        wire(quote),
        'invalid_payment',
        `Payment token signature invalid: Failed to fetch JWKS from ${SERVICE_JWKS_URL}: HTTP 302`
      );
      expect((stub.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: 'manual' });
    });

    it('defaults the payment-token JWKS to the production endpoint', async () => {
      const quote = await sellerQuote();
      await verifier({ paymentTokenJwksUrl: undefined }).verify(
        await service.issue(quote),
        wire(quote)
      );
      expect(requestUrl(fetchStub.mock.calls[0][0])).toBe(
        `${DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL}/.well-known/jwks.json`
      );
    });

    it('strips trailing slashes from the payment-token JWKS URL', async () => {
      const quote = await sellerQuote();
      await expectValid(
        await service.issue(quote),
        wire(quote),
        verifier({ paymentTokenJwksUrl: `${SERVICE_JWKS_BASE_URL}//` })
      );
    });

    // Trailing slashes are stripped in linear time. A regex such as /\/+$/ is
    // quadratic on a long run of '/' that does not end the string (CodeQL
    // js/polynomial-redos): 50,000 slashes took 3.6 s with it, so 500 ms has a
    // wide margin on a slow runner.
    it('strips a long run of slashes in linear time', async () => {
      const slashes = '/'.repeat(50_000);
      const quote = await sellerQuote();
      const token = await service.issue(quote);
      let started = performance.now();
      await expectInvalid(
        token,
        wire(quote),
        'invalid_payment',
        `Payment token signature invalid: Failed to fetch JWKS from ${SERVICE_JWKS_BASE_URL}${slashes}x/.well-known/jwks.json: HTTP 404`,
        verifier({ paymentTokenJwksUrl: `${SERVICE_JWKS_BASE_URL}${slashes}x` })
      );
      expect(performance.now() - started).toBeLessThan(500);

      started = performance.now();
      await expectInvalid(
        token,
        wire(quote),
        'invalid_quote',
        `Quote token signature invalid: Failed to fetch JWKS from https://keys.seller.example.com${slashes}x/.well-known/jwks.json: HTTP 404`,
        verifier({
          sellerKeyResolver: {
            type: 'jwks',
            jwksUrl: `https://keys.seller.example.com${slashes}x`,
          },
        })
      );
      expect(performance.now() - started).toBeLessThan(500);
    });

    it('strips every trailing slash from both JWKS URLs, and nothing else', async () => {
      fetchStub = jwksFetch({
        [SERVICE_JWKS_URL]: service.jwks,
        'https://keys.seller.example.com/a//b/.well-known/jwks.json': { keys: [seller.publicJwk] },
      });
      vi.stubGlobal('fetch', fetchStub);
      const quote = await sellerQuote();
      await expectValid(
        await service.issue(quote),
        wire(quote),
        verifier({
          paymentTokenJwksUrl: `${SERVICE_JWKS_BASE_URL}////`,
          sellerKeyResolver: { type: 'jwks', jwksUrl: 'https://keys.seller.example.com/a//b///' },
        })
      );
    });
  });

  describe('1. quoteToken in the requirements', () => {
    it('passes when present', async () => {
      const quote = await sellerQuote();
      await expectValid(await service.issue(quote), wire(quote));
    });

    it.each([[undefined], [''], [{}]])('fails when it is %j', async (missing) => {
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote),
        wire(missing),
        'invalid_quote',
        'Missing quoteToken in payment requirements'
      );
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it('fails when extra is missing', async () => {
      await expectInvalid(
        'token',
        { amount: '0.10', asset: 'iso4217:USD' },
        'invalid_quote',
        'Missing quoteToken in payment requirements'
      );
    });
  });

  describe('2. payment token signature (service JWKS)', () => {
    it('fetches the service JWKS with the configured headers, and caches it', async () => {
      const quote = await sellerQuote();
      const token = await service.issue(quote);
      const v = verifier({ jwksRequestHeaders: { 'x-access': 'onboarding-key' } });
      await expectValid(token, wire(quote), v);
      await expectValid(token, wire(quote), v);
      expect(fetchStub).toHaveBeenCalledTimes(1);
      const [input, init] = fetchStub.mock.calls[0];
      expect(requestUrl(input)).toBe(SERVICE_JWKS_URL);
      expect(init?.headers).toEqual({ 'x-access': 'onboarding-key' });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    });

    it('refetches the service JWKS once the cached copy is a minute old', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const quote = await sellerQuote();
      const v = verifier();
      await expectValid(await service.issue(quote), wire(quote), v);
      vi.advanceTimersByTime(59_000);
      await expectValid(await service.issue(quote), wire(quote), v);
      expect(fetchStub).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(2_000);
      await expectValid(await service.issue(quote), wire(quote), v);
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    it('refetches for an unknown kid at most once every 30 seconds', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const quote = await sellerQuote();
      const v = verifier();
      await expectValid(await service.issue(quote), wire(quote), v);
      const unknown = await service.issue(quote, { header: { alg: 'ES384', kid: 'unknown' } });
      for (let i = 0; i < 5; i++) {
        await expectInvalid(
          unknown,
          wire(quote),
          'invalid_payment',
          'Payment token signature invalid: No matching key found in JWKS',
          v
        );
      }
      // The first fetch was just now, so the unknown kid fetched nothing.
      expect(fetchStub).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(31_000);
      await v.verify(unknown, wire(quote));
      await v.verify(unknown, wire(quote));
      expect(fetchStub).toHaveBeenCalledTimes(2);
    });

    it('shares one fetch between concurrent verifications', async () => {
      const quote = await sellerQuote();
      const v = verifier();
      const tokens = await Promise.all([1, 2, 3].map(() => service.issue(quote)));
      const results = await Promise.all(tokens.map((token) => v.verify(token, wire(quote))));
      expect(results.every((result) => result.isValid)).toBe(true);
      expect(fetchStub).toHaveBeenCalledTimes(1);
    });

    it('does not cache a failed fetch', async () => {
      const quote = await sellerQuote();
      const v = verifier();
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response('{}', { status: 503 })))
      );
      expect((await v.verify(await service.issue(quote), wire(quote))).isValid).toBe(false);
      vi.stubGlobal('fetch', fetchStub);
      await expectValid(await service.issue(quote), wire(quote), v);
    });

    it('refuses a JWKS larger than 64 KiB', async () => {
      const quote = await sellerQuote();
      const padded = { ...service.jwks, padding: 'x'.repeat(64 * 1024) };
      const headerSets: Record<string, string>[] = [{}, { 'content-length': '70000' }];
      for (const headers of headerSets) {
        vi.stubGlobal(
          'fetch',
          vi.fn(() =>
            Promise.resolve(new Response(JSON.stringify(padded), { status: 200, headers }))
          )
        );
        await expectInvalid(
          await service.issue(quote),
          wire(quote),
          'invalid_payment',
          `Payment token signature invalid: JWKS from ${SERVICE_JWKS_URL} exceeds 65536 bytes`
        );
      }
    });

    it.each([
      ['not a JWS', () => 'garbage'],
      ['a JWE-shaped token', () => 'a.b.c.d.e'],
      ['a token with no kid', (q: string) => service.issue(q, { header: { alg: 'ES384' } })],
      ['a token from another issuer', (q: string) => service.issue(q, { issuer: 'https://evil' })],
      ['an expired token', (q: string) => service.issue(q, { expiresIn: -10 })],
      [
        'a token without payment_id',
        (q: string) => service.issue(q, { claims: { payment_id: undefined } }),
      ],
      ['a token for another quote', () => service.issue('another-quote')],
    ])('rejects %s without fetching any key', async (_name, make) => {
      const quote = await sellerQuote();
      const result = await verifier().verify(await make(quote), wire(quote));
      expect(result.isValid).toBe(false);
      expect(fetchStub).not.toHaveBeenCalled();
    });

    it('accepts headers from a function, called per fetch', async () => {
      const quote = await sellerQuote();
      const headers = vi.fn(() => Promise.resolve({ authorization: 'Bearer x' }));
      await expectValid(
        await service.issue(quote),
        wire(quote),
        verifier({ jwksRequestHeaders: headers })
      );
      expect(headers).toHaveBeenCalledTimes(1);
      expect(fetchStub.mock.calls[0][1]?.headers).toEqual({ authorization: 'Bearer x' });
    });

    it('fails when the JWKS request is not HTTP 200', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() => Promise.resolve(new Response('{}', { status: 503 })))
      );
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote),
        wire(quote),
        'invalid_payment',
        `Payment token signature invalid: Failed to fetch JWKS from ${SERVICE_JWKS_URL}: HTTP 503`
      );
    });

    it('fails when the JWKS request fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Promise.reject(new Error('timeout')))
      );
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote),
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: timeout'
      );
    });

    it('fails when the token is signed by another key (forged)', async () => {
      const forger = await FakePaymentService.create();
      const quote = await sellerQuote();
      await expectInvalid(
        await forger.issue(quote),
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: Signature verification failed'
      );
    });

    it('fails when no key has the header kid', async () => {
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote, { header: { alg: 'ES384', kid: 'unknown' } }),
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: No matching key found in JWKS'
      );
    });

    it('rejects a token whose header has no kid', async () => {
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote, { header: { alg: 'ES384' } }),
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: Payment token has no kid'
      );
    });

    it('fails when the header alg is not allowed', async () => {
      const quote = await sellerQuote();
      const { privateKey, publicKey } = await jose.generateKeyPair('PS256');
      const rsaJwk = { ...(await jose.exportJWK(publicKey)), kid: 'rsa' };
      vi.stubGlobal('fetch', jwksFetch({ [SERVICE_JWKS_URL]: { keys: [rsaJwk] } }));
      await expectInvalid(
        await service.issue(quote, {
          header: { alg: 'PS256', kid: 'rsa' },
          signingKey: privateKey,
        }),
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: Algorithm not allowed: PS256'
      );
    });

    it('fails for an unsigned (alg none) token', async () => {
      const quote = await sellerQuote();
      const unsigned = new jose.UnsecuredJWT({ quote_token: quote }).encode();
      await expectInvalid(
        unsigned,
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: Algorithm not allowed: none'
      );
    });

    it('fails for a malformed token', async () => {
      const quote = await sellerQuote();
      await expectInvalid(
        'not-a-jwt',
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: Not enough segments'
      );
    });

    it('fails when iat is in the future (no leeway)', async () => {
      const quote = await sellerQuote();
      const future = Math.floor(Date.now() / 1000) + 3600;
      await expectInvalid(
        await service.issue(quote, { claims: { iat: future } }),
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: The token is not yet valid (iat)'
      );
    });

    it('fails when iat is not an integer', async () => {
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote, { claims: { iat: 'yesterday' } }),
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: Issued At claim (iat) must be an integer.'
      );
    });

    it('accepts iat as a string of decimal digits', async () => {
      const quote = await sellerQuote();
      const iat = String(Math.floor(Date.now() / 1000));
      await expectValid(await service.issue(quote, { claims: { iat } }), wire(quote));
    });

    it('fails when nbf is in the future, or not an integer', async () => {
      const quote = await sellerQuote();
      const future = Math.floor(Date.now() / 1000) + 3600;
      await expectInvalid(
        await service.issue(quote, { claims: { nbf: future } }),
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: The token is not yet valid (nbf)'
      );
      await expectInvalid(
        await service.issue(quote, { claims: { nbf: null } }),
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: Not Before claim (nbf) must be an integer.'
      );
    });

    it('fails when sub or jti is not a string', async () => {
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote, { claims: { sub: 123 } }),
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: Subject must be a string'
      );
      await expectInvalid(
        await service.issue(quote, { claims: { jti: 1 } }),
        wire(quote),
        'invalid_payment',
        'Payment token signature invalid: JWT ID must be a string'
      );
    });
  });

  describe('3. payment token issuer', () => {
    it('fails when iss is not the payment service', async () => {
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote, { issuer: 'someone-else' }),
        wire(quote),
        'invalid_payment',
        'Payment token issuer is not the payment service'
      );
    });

    it('accepts the configured paymentTokenIssuer, and only it', async () => {
      const quote = await sellerQuote();
      const token = await service.issue(quote, { issuer: 'beta-issuer' });
      await expectValid(token, wire(quote), verifier({ paymentTokenIssuer: 'beta-issuer' }));
      await expectInvalid(
        await service.issue(quote),
        wire(quote),
        'invalid_payment',
        'Payment token issuer is not the payment service',
        verifier({ paymentTokenIssuer: 'beta-issuer' })
      );
    });
  });

  describe('4. payment token expiry', () => {
    it('passes when exp equals now', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(1_790_000_000_000);
      const quote = await sellerQuote();
      await expectValid(await service.issue(quote, { expiresIn: 0 }), wire(quote));
    });

    it.each([
      ['expired', { exp: 1 }],
      ['a float', { exp: Math.floor(Date.now() / 1000) + 300.5 }],
      ['missing', { exp: undefined }],
      ['a string', { exp: '9999999999' }],
    ])('fails when exp is %s', async (_name, claims) => {
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote, { claims }),
        wire(quote),
        'payment_expired',
        'Payment token expired'
      );
    });
  });

  describe('5. quote token in the payment token', () => {
    it.each([
      ['missing', { quote_token: undefined }],
      ['empty', { quote_token: '' }],
      ['not a string', { quote_token: 7 }],
    ])('fails when quote_token is %s', async (_name, claims) => {
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote, { claims }),
        wire(quote),
        'invalid_quote',
        'Missing quote token in payment token'
      );
    });

    it('does not read the legacy payment_context.quote_token', async () => {
      const quote = await sellerQuote();
      const token = await service.issue(quote, {
        claims: { quote_token: undefined, payment_context: { quote_token: quote } },
      });
      await expectInvalid(
        token,
        wire(quote),
        'invalid_quote',
        'Missing quote token in payment token'
      );
    });
  });

  describe('6. payment token bound to the accepted quote', () => {
    it('fails when the token was issued for a different quote', async () => {
      const paid = await sellerQuote();
      const accepted = await sellerQuote();
      await expectInvalid(
        await service.issue(paid),
        wire(accepted),
        'invalid_quote',
        'Payment token was issued for a different quote'
      );
    });

    it('fails for a quote that differs only in length', async () => {
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote),
        wire(`${quote}x`),
        'invalid_quote',
        'Payment token was issued for a different quote'
      );
    });
  });

  describe('7. quote signature with the seller-configured key', () => {
    it('fails for a quote the buyer signed with their own key, and never fetches its iss', async () => {
      const buyer = await ecKey('buyer-key');
      const quote = await customQuote({ iss: 'https://buyer.example.net' }, buyer.privateKey);
      const token = await service.issue(quote);
      await expectInvalid(
        token,
        wire(quote),
        'invalid_quote',
        'Quote token signature invalid: Signature verification failed'
      );
      expect(fetchedHostnames(fetchStub)).toEqual([new URL(SERVICE_JWKS_URL).hostname]);
    });

    it('fails for a quote signed by another seller', async () => {
      const other = await createSeller('https://other.example.com');
      const enhanced = await enhancePaymentRequirements(
        {
          scheme: 'exact',
          network: 'aws:base',
          asset: 'iso4217:USD',
          amount: '0.10',
          payTo: PRODUCT,
          maxTimeoutSeconds: 300,
          extra: {},
        },
        other.signer
      );
      const quote = enhanced.extra.quoteToken as string;
      await expectInvalid(
        await service.issue(quote),
        wire(quote),
        'invalid_quote',
        'Quote token signature invalid: Signature verification failed'
      );
    });

    it('fails when the quote alg is not allowed', async () => {
      const quote = await customQuote(
        {},
        new TextEncoder().encode('k'.repeat(32)) as unknown as jose.KeyLike,
        {
          alg: 'HS256',
        }
      );
      await expectInvalid(
        await service.issue(quote),
        wire(quote),
        'invalid_quote',
        'Quote token signature invalid: Algorithm not allowed: HS256'
      );
    });

    it('fails when the quote iat is in the future', async () => {
      const quote = await customQuote({ iat: Math.floor(Date.now() / 1000) + 3600 });
      await expectInvalid(
        await service.issue(quote),
        wire(quote),
        'invalid_quote',
        'Quote token signature invalid: The token is not yet valid (iat)'
      );
    });

    describe('static resolver', () => {
      it('verifies with the configured JWK', async () => {
        const quote = await customQuote();
        await expectValid(await service.issue(quote), wire(quote));
      });

      it('picks the key by kid', async () => {
        const quote = await customQuote({}, seller.privateKey, { alg: 'ES256', kid: 'other' });
        await expectInvalid(
          await service.issue(quote),
          wire(quote),
          'invalid_quote',
          'Quote token signature invalid: No matching key found in JWKS'
        );
      });
    });

    describe('JWKS resolver', () => {
      const sellerJwksBase = 'https://keys.seller.example.com/';
      const sellerJwksUrl = 'https://keys.seller.example.com/.well-known/jwks.json';

      it('fetches the seller JWKS without the payment-token headers, and caches it', async () => {
        fetchStub = jwksFetch({
          [SERVICE_JWKS_URL]: service.jwks,
          [sellerJwksUrl]: { keys: [seller.publicJwk] },
        });
        vi.stubGlobal('fetch', fetchStub);
        const v = verifier({
          sellerKeyResolver: { type: 'jwks', jwksUrl: sellerJwksBase },
          jwksRequestHeaders: { 'x-access': 'onboarding-key' },
        });
        const quote = await sellerQuote();
        const token = await service.issue(quote);
        await expectValid(token, wire(quote), v);
        await expectValid(token, wire(quote), v);
        const sellerCalls = fetchStub.mock.calls.filter(
          ([input]) => requestUrl(input) === sellerJwksUrl
        );
        expect(sellerCalls).toHaveLength(1);
        expect(sellerCalls[0][1]?.headers).toEqual({});
        expect(fetchStub).toHaveBeenCalledTimes(2);
      });

      it('fails when the seller JWKS cannot be fetched, and does not cache the failure', async () => {
        const v = verifier({ sellerKeyResolver: { type: 'jwks', jwksUrl: sellerJwksBase } });
        const quote = await sellerQuote();
        const token = await service.issue(quote);
        await expectInvalid(
          token,
          wire(quote),
          'invalid_quote',
          `Quote token signature invalid: Failed to fetch JWKS from ${sellerJwksUrl}: HTTP 404`,
          v
        );
        vi.stubGlobal(
          'fetch',
          jwksFetch({
            [SERVICE_JWKS_URL]: service.jwks,
            [sellerJwksUrl]: { keys: [seller.publicJwk] },
          })
        );
        await expectValid(token, wire(quote), v);
      });

      it('refetches after an hour', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(1_790_000_000_000);
        fetchStub = jwksFetch({
          [SERVICE_JWKS_URL]: service.jwks,
          [sellerJwksUrl]: { keys: [seller.publicJwk] },
        });
        vi.stubGlobal('fetch', fetchStub);
        const v = verifier({ sellerKeyResolver: { type: 'jwks', jwksUrl: sellerJwksBase } });
        const quote = await sellerQuote();
        await expectValid(await service.issue(quote), wire(quote), v);
        vi.setSystemTime(1_790_000_000_000 + 3_600_000);
        const later = await sellerQuote();
        await expectValid(await service.issue(later), wire(later), v);
        expect(fetchStub.mock.calls.filter(([i]) => requestUrl(i) === sellerJwksUrl)).toHaveLength(
          2
        );
      });
    });

    describe('KMS resolver', () => {
      async function kmsKey() {
        const { privateKey, publicKey } = await jose.generateKeyPair('ES384', {
          extractable: true,
        });
        const der = createPublicKey(await jose.exportSPKI(publicKey)).export({
          type: 'spki',
          format: 'der',
        });
        return { privateKey, der: new Uint8Array(der) };
      }

      it('verifies with the key from GetPublicKey, cached per ARN', async () => {
        const key = await kmsKey();
        const send = vi.fn(() => Promise.resolve({ PublicKey: key.der }));
        const arn = 'arn:aws:kms:us-east-1:111122223333:alias/quote-key';
        const v = verifier({
          sellerKeyResolver: {
            type: 'kms',
            kmsKeyArn: arn,
            region: 'us-east-1',
            kmsClient: { send },
          },
        });
        const quote = await customQuote({}, key.privateKey, { alg: 'ES384', kid: 'quote-key' });
        await expectValid(await service.issue(quote), wire(quote), v);
        await expectValid(await service.issue(quote), wire(quote), v);
        expect(send).toHaveBeenCalledTimes(1);
        expect((send.mock.calls[0] as unknown[])[0]).toMatchObject({ input: { KeyId: arn } });
      });

      it('fails when GetPublicKey returns no key material', async () => {
        const v = verifier({
          sellerKeyResolver: {
            type: 'kms',
            kmsKeyArn: 'arn',
            region: 'us-east-1',
            kmsClient: { send: () => Promise.resolve({ PublicKey: undefined }) },
          },
        });
        const quote = await customQuote();
        await expectInvalid(
          await service.issue(quote),
          wire(quote),
          'invalid_quote',
          'Quote token signature invalid: KMS GetPublicKey returned no key material',
          v
        );
      });

      it('fails for a quote not signed by the KMS key', async () => {
        const key = await kmsKey();
        const v = verifier({
          sellerKeyResolver: {
            type: 'kms',
            kmsKeyArn: 'arn',
            region: 'us-east-1',
            kmsClient: { send: () => Promise.resolve({ PublicKey: key.der }) },
          },
        });
        const other = await jose.generateKeyPair('ES384');
        const quote = await customQuote({}, other.privateKey, { alg: 'ES384' });
        await expectInvalid(
          await service.issue(quote),
          wire(quote),
          'invalid_quote',
          'Quote token signature invalid: Signature verification failed',
          v
        );
      });

      it('creates a KMS client with the region and credentials when none is given', async () => {
        const key = await kmsKey();
        const clients: unknown[] = [];
        vi.doMock('@aws-sdk/client-kms', () => ({
          KMSClient: class {
            constructor(config: unknown) {
              clients.push(config);
            }
            send() {
              return Promise.resolve({ PublicKey: key.der });
            }
          },
          GetPublicKeyCommand: class {
            constructor(public input: unknown) {}
          },
        }));
        try {
          const credentials = { accessKeyId: 'AKIA', secretAccessKey: 'secret' };
          const v = verifier({
            sellerKeyResolver: {
              type: 'kms',
              kmsKeyArn: 'arn',
              region: 'eu-west-1',
              credentials: () => Promise.resolve(credentials),
            },
          });
          const quote = await customQuote({}, key.privateKey, { alg: 'ES384' });
          await expectValid(await service.issue(quote), wire(quote), v);
          const ambient = verifier({
            sellerKeyResolver: { type: 'kms', kmsKeyArn: 'arn2', region: 'eu-west-1' },
          });
          await expectValid(await service.issue(quote), wire(quote), ambient);
          expect(clients).toEqual([{ region: 'eu-west-1', credentials }, { region: 'eu-west-1' }]);
        } finally {
          vi.doUnmock('@aws-sdk/client-kms');
        }
      });
    });
  });

  describe('8. payment audience is the quote issuer', () => {
    it.each([
      ['another seller', 'https://other.example.com'],
      ['a list', [SELLER_URL]],
      ['missing', undefined],
    ])('fails when aud is %s', async (_name, audience) => {
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote, { audience }),
        wire(quote),
        'invalid_payment',
        'Payment token audience is not the quote issuer'
      );
    });

    it('does not check the quote aud', async () => {
      const quote = await customQuote({ aud: 'someone-else' });
      await expectValid(await service.issue(quote), wire(quote));
    });
  });

  describe('9. quote expiry', () => {
    it('passes when the quote exp equals now', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(1_790_000_000_000);
      const quote = await customQuote({ exp: 1_790_000_000 });
      await expectValid(await service.issue(quote), wire(quote));
    });

    it.each([
      ['expired', { exp: Math.floor(Date.now() / 1000) - 1 }],
      ['missing', { exp: undefined }],
      ['a float', { exp: Math.floor(Date.now() / 1000) + 0.5 + 300 }],
    ])('fails when the quote exp is %s', async (_name, claims) => {
      const quote = await customQuote(claims);
      await expectInvalid(
        await service.issue(quote),
        wire(quote),
        'quote_expired',
        'Quote token expired'
      );
    });
  });

  describe('10. price and currency against the requirements', () => {
    it.each([
      ['a relabelled amount', { amount: '1.00' }],
      ['an equal number written differently', { amount: '0.1' }],
      ['another currency', { asset: 'iso4217:EUR' }],
      ['no amount', { amount: undefined }],
    ])('fails for %s', async (_name, overrides) => {
      const quote = await sellerQuote();
      await expectInvalid(
        await service.issue(quote),
        wire(quote, overrides),
        'invalid_payment',
        'Amount or currency mismatch'
      );
    });

    it('fails when the quote price is not an object', async () => {
      const quote = await customQuote({ price: '0.10' });
      await expectInvalid(
        await service.issue(quote),
        wire(quote),
        'invalid_payment',
        'Amount or currency mismatch'
      );
    });
  });

  describe('11. product', () => {
    it('passes when the quote is for the route product', async () => {
      const quote = await sellerQuote();
      await expectValid(await service.issue(quote), wire(quote, { productId: PRODUCT }));
    });

    it('fails when the quote is for another product at the same price', async () => {
      const quote = await sellerQuote('0.10', 'prod-other');
      await expectInvalid(
        await service.issue(quote),
        wire(quote, { productId: PRODUCT }),
        'invalid_payment',
        'Quote is for a different product'
      );
    });

    it('fails when settlement.product_id differs from payTo', async () => {
      const quote = await customQuote({ settlement: { product_id: 'prod-other' } });
      await expectInvalid(
        await service.issue(quote),
        wire(quote, { productId: PRODUCT }),
        'invalid_payment',
        'Quote is for a different product'
      );
    });

    it('is not checked when the requirements name no product', async () => {
      const quote = await sellerQuote('0.10', 'prod-other');
      await expectValid(await service.issue(quote), wire(quote));
    });
  });

  describe('valid payment', () => {
    it('returns the payer and the payment id', async () => {
      const quote = await sellerQuote();
      const token = await service.issue(quote);
      expect(await verifier().verify(token, wire(quote))).toEqual({
        isValid: true,
        payer: BUYER,
        paymentId: jose.decodeJwt(token).payment_id,
      });
    });

    it('verifies the fixed payment token vector', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime((fixtures.FIXED_NOW + 10) * 1000);
      vi.stubGlobal('fetch', jwksFetch({ [SERVICE_JWKS_URL]: fixtures.SERVICE_JWKS }));
      const v = verifier({
        sellerKeyResolver: { type: 'static', publicJwk: { ...fixtures.SELLER_PUBLIC_JWK } },
      });
      expect(
        await v.verify(fixtures.PAYMENT_TOKEN, {
          amount: '0.10',
          asset: 'iso4217:USD',
          extra: { quoteToken: fixtures.QUOTE_TOKEN },
          productId: 'prod-fixture123',
        })
      ).toEqual({ isValid: true, payer: fixtures.PAYMENT_PAYER, paymentId: fixtures.PAYMENT_ID });
    });
  });
});
