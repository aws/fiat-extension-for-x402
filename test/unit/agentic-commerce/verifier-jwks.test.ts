// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Key selection from a JWKS: with no `kid` every key is tried, a key that
 * cannot be loaded is skipped, and a JWKS that is not a set of JSON objects
 * fails.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CompactSign, type KeyLike } from 'jose';
import { AgenticCommerceVerifier } from '../../../src/agentic-commerce/verifier';
import { enhancePaymentRequirements } from '../../../src/agentic-commerce/exact/quote';
import {
  FakePaymentService,
  SERVICE_JWKS_BASE_URL,
  SERVICE_JWKS_URL,
  createSeller,
  jwksFetch,
} from '../../helpers/fake-payment-service';

let service: FakePaymentService;
let seller: Awaited<ReturnType<typeof createSeller>>;
let quote: string;

beforeEach(async () => {
  service = await FakePaymentService.create();
  seller = await createSeller();
  const enhanced = await enhancePaymentRequirements(
    {
      scheme: 'exact',
      network: 'aws:base',
      asset: 'iso4217:USD',
      amount: '0.10',
      payTo: 'prod-1',
      maxTimeoutSeconds: 300,
      extra: {},
    },
    seller.signer
  );
  quote = enhanced.extra.quoteToken as string;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function verifyAgainst(jwks: unknown, header: Record<string, unknown> = { alg: 'ES384' }) {
  vi.stubGlobal('fetch', jwksFetch({ [SERVICE_JWKS_URL]: jwks }));
  const verifier = new AgenticCommerceVerifier({
    sellerKeyResolver: { type: 'static', publicJwk: seller.publicJwk },
    paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
  });
  const token = await service.issue(quote, { header: header as never });
  return verifier.verify(token, {
    amount: '0.10',
    asset: 'iso4217:USD',
    extra: { quoteToken: quote },
  });
}

describe('payment-token JWKS key selection', () => {
  it('skips keys that cannot be loaded and verifies with the next one', async () => {
    const { x, y } = service.jwk;
    const unusable = [
      { crv: 'P-384' },
      { kty: 'EC', crv: 'P-999', x, y },
      { kty: 'OKP' },
      { kty: 'OKP', crv: 'X25519', x },
      { kty: 'oct', k: 'c2VjcmV0' },
      { kty: 'EC', crv: 'P-384', x, y, alg: 'RS256' },
      { kty: 'EC', crv: 'P-384', x: 'AA', y: 'AA' },
      { kty: 'RSA', n: 'AA', e: 'AQAB' },
      { kty: 'EC', x, y },
      { kty: 'OKP', crv: 'Ed25519', x: 'AA' },
    ];
    expect(await verifyAgainst({ keys: [...unusable, service.jwk] })).toMatchObject({
      isValid: true,
    });
  });

  it('reports the last key error when no key verifies', async () => {
    expect(await verifyAgainst({ keys: [{ kty: 'XX' }] })).toEqual({
      isValid: false,
      invalidReason: 'invalid_payment',
      invalidMessage: 'Payment token signature invalid: Unsupported kty: XX',
    });
  });

  it.each([
    ['not an object', ['key'], 'JWKS must be a JSON object'],
    ['keys not a list', { keys: 'key' }, 'JWKS keys must be a list'],
    ['a key not an object, with no kid', { keys: ['key'] }, 'JWKS keys must be JSON objects'],
    ['no keys', {}, 'No matching key found in JWKS'],
  ])('fails when the JWKS has %s', async (_name, jwks, message) => {
    expect(await verifyAgainst(jwks)).toMatchObject({
      invalidMessage: `Payment token signature invalid: ${message}`,
    });
  });

  it('fails when a key is not an object and the token names a kid', async () => {
    expect(await verifyAgainst({ keys: ['key'] }, { alg: 'ES384', kid: 'k' })).toMatchObject({
      invalidMessage: 'Payment token signature invalid: JWKS keys must be JSON objects',
    });
  });

  it('fails when the payload is not a JSON object', async () => {
    vi.stubGlobal('fetch', jwksFetch({ [SERVICE_JWKS_URL]: service.jwks }));
    // A token signed over a JSON array has no claims set, so it is rejected.
    const privateKey = (service as unknown as { privateKey: KeyLike }).privateKey;
    const token = await new CompactSign(new TextEncoder().encode('[1]'))
      .setProtectedHeader({ alg: 'ES384', kid: service.jwk.kid })
      .sign(privateKey);
    const verifier = new AgenticCommerceVerifier({
      sellerKeyResolver: { type: 'static', publicJwk: seller.publicJwk },
      paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
    });
    expect(
      await verifier.verify(token, {
        amount: '0.10',
        asset: 'iso4217:USD',
        extra: { quoteToken: quote },
      })
    ).toMatchObject({
      invalidMessage:
        'Payment token signature invalid: Invalid payload string: must be a json object',
    });
    const notJson = await new CompactSign(new TextEncoder().encode('{'))
      .setProtectedHeader({ alg: 'ES384', kid: service.jwk.kid })
      .sign(privateKey);
    expect(
      (
        await verifier.verify(notJson, {
          amount: '0.10',
          asset: 'iso4217:USD',
          extra: { quoteToken: quote },
        })
      ).invalidMessage
    ).toMatch(/^Payment token signature invalid: Invalid payload string: /);
  });
});
