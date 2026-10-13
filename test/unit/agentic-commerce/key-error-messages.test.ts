// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * A key that cannot be imported is reported as `JWK <kid>: invalid key material`
 * (`JWK: invalid key material` without a string kid), never written out: a
 * misconfigured JWKS can hold private key members, and the message reaches
 * the facilitator's invalidMessage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { x402Facilitator } from '@x402/core/facilitator';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { ExactAgenticCommerceScheme } from '../../../src/agentic-commerce/exact/facilitator';
import { enhancePaymentRequirements } from '../../../src/agentic-commerce/exact/quote';
import { AgenticCommerceVerifier, importJwk } from '../../../src/agentic-commerce/verifier';
import { verifyDPoPProof } from '../../../src/dpop/verification';
import {
  FakePaymentService,
  SELLER_URL,
  SERVICE_JWKS_BASE_URL,
  SERVICE_JWKS_URL,
  createSeller,
  jwksFetch,
} from '../../helpers/fake-payment-service';

const MARKER = 'PRIVATE-KEY-MATERIAL-MARKER';

/** Every private JWK member, each holding the marker */
const PRIVATE_MEMBERS = {
  d: `${MARKER}-d`,
  p: `${MARKER}-p`,
  q: `${MARKER}-q`,
  dp: `${MARKER}-dp`,
  dq: `${MARKER}-dq`,
  qi: `${MARKER}-qi`,
  k: `${MARKER}-k`,
  oth: [{ r: `${MARKER}-r`, d: `${MARKER}-oth-d`, t: `${MARKER}-t` }],
};

/** Every way a JWK with private members fails to import */
const UNUSABLE_KEYS: [string, Record<string, unknown>][] = [
  ['no kty', { crv: 'P-256', x: 'x', y: 'y' }],
  ['an OKP key without crv', { kty: 'OKP', x: 'x' }],
  ['an OKP key with another crv', { kty: 'OKP', crv: 'X25519', x: 'x' }],
  ['an EC key with an unknown crv', { kty: 'EC', crv: 'P-999', x: 'x', y: 'y' }],
  ['an unknown kty', { kty: 'oct' }],
  ['an alg outside its key type', { kty: 'EC', crv: 'P-256', alg: 'RS256', x: 'x', y: 'y' }],
  ['an unknown kty with an alg', { kty: 'oct', alg: 'HS256' }],
  ['members that do not make a key', { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }],
  ['a kty that is an Object.prototype name', { kty: 'constructor', alg: 'ES256' }],
  ['a crv that is an Object.prototype name', { kty: 'EC', crv: 'toString', x: 'x', y: 'y' }],
];

function thrownMessage(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error('expected an error');
}

describe('importJwk: errors name the key, never its members', () => {
  it.each(UNUSABLE_KEYS)('%s, with a kid', (_, key) => {
    const text = thrownMessage(() => importJwk({ ...key, kid: 'seller-key', ...PRIVATE_MEMBERS }));
    expect(text).toBe('JWK seller-key: invalid key material');
  });

  it.each(UNUSABLE_KEYS)('%s, without a kid', (_, key) => {
    const text = thrownMessage(() => importJwk({ ...key, ...PRIVATE_MEMBERS }));
    expect(text).toBe('JWK: invalid key material');
  });

  it.each([[42], [null], [{ id: MARKER }], [[MARKER]]])(
    'a kid of %j is not a string, so the key is not named',
    (kid) => {
      const text = thrownMessage(() => importJwk({ kid, ...PRIVATE_MEMBERS }));
      expect(text).toBe('JWK: invalid key material');
    }
  );
});

describe('the facilitator never reports a key in invalidMessage', () => {
  const ROUTE: PaymentRequirements = {
    scheme: 'exact',
    network: 'aws:base',
    asset: 'iso4217:USD',
    amount: '0.10',
    payTo: 'prod-weather',
    maxTimeoutSeconds: 300,
    extra: { description: 'Weather' },
  };
  const SELLER_JWKS_URL = `${SELLER_URL}/.well-known/jwks.json`;

  let service: FakePaymentService;
  let seller: Awaited<ReturnType<typeof createSeller>>;

  beforeEach(async () => {
    service = await FakePaymentService.create();
    seller = await createSeller();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Verify a genuine payment through x402 core's facilitator with these JWKS documents */
  async function verifyWith(jwks: { service?: unknown; seller?: unknown }) {
    vi.stubGlobal(
      'fetch',
      jwksFetch({
        [SERVICE_JWKS_URL]: jwks.service ?? service.jwks,
        [SELLER_JWKS_URL]: jwks.seller ?? { keys: [seller.publicJwk] },
      })
    );
    const scheme = new ExactAgenticCommerceScheme({
      verifier: new AgenticCommerceVerifier({
        sellerKeyResolver: { type: 'jwks', jwksUrl: SELLER_URL },
        paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
      }),
    });
    const facilitator = new x402Facilitator().register('aws:base', scheme);
    const accepted = await enhancePaymentRequirements(ROUTE, seller.signer);
    const paymentToken = await service.issue(accepted.extra.quoteToken as string);
    const payload: PaymentPayload = { x402Version: 2, accepted, payload: { paymentToken } };
    return facilitator.verify(payload, accepted);
  }

  /** The seller's key, published with private members and made unusable by `change` */
  function brokenSellerJwks(change: Record<string, unknown>) {
    const key: Record<string, unknown> = { ...seller.publicJwk, ...PRIVATE_MEMBERS, ...change };
    for (const [name, value] of Object.entries(key)) if (value === undefined) delete key[name];
    return { keys: [key] };
  }

  it('the baseline payment verifies', async () => {
    expect(await verifyWith({})).toMatchObject({ isValid: true });
  });

  it.each([
    ['no kty', { kty: undefined }],
    ['an OKP key without crv', { kty: 'OKP', crv: undefined, alg: undefined }],
    ['an alg outside its key type', { alg: 'RS256' }],
    ['members that do not make a key', { x: 'x' }],
  ])('a seller JWKS key with %s', async (_, change) => {
    const result = await verifyWith({ seller: brokenSellerJwks(change) });
    expect(result).toMatchObject({
      isValid: false,
      invalidReason: 'invalid_quote',
      invalidMessage: 'Quote token signature invalid: JWK seller-key: invalid key material',
    });
    expect(JSON.stringify(result)).not.toContain(MARKER);
  });

  it('a payment service JWKS key with private members and an alg outside its key type', async () => {
    const keys = service.jwks.keys.map((key) => ({ ...key, ...PRIVATE_MEMBERS, alg: 'RS256' }));
    const result = await verifyWith({ service: { keys } });
    expect(result).toMatchObject({
      isValid: false,
      invalidReason: 'invalid_payment',
      invalidMessage: 'Payment token signature invalid: JWK service-key: invalid key material',
    });
    expect(JSON.stringify(result)).not.toContain(MARKER);
  });

  it.each([
    ['no kty', {}],
    ['members that do not make a key', { kty: 'EC' }],
  ])('a DPoP proof whose header key has private members and %s', async (_, change) => {
    const { privateKey } = await jose.generateKeyPair('ES256');
    const jwk = { kid: 'buyer-key', crv: 'P-256', x: 'x', y: 'y', ...PRIVATE_MEMBERS, ...change };
    const proof = await new jose.SignJWT({ jti: 'j', htm: 'GET', htu: SELLER_URL, iat: 1 })
      .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: jwk as unknown as jose.JWK })
      .sign(privateKey);
    const error = await verifyDPoPProof(proof, { method: 'GET', url: SELLER_URL }).catch(
      (e: unknown) => e as Error
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe(
      'DPoP proof signature verification failed: JWK buyer-key: invalid key material'
    );
    expect(JSON.stringify(error)).not.toContain(MARKER);
  });
});
