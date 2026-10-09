// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import * as jose from 'jose';
import { toQuoteSigner, toPaymentTokenSigner } from '../../../src/signers/protocol';
import { ValidationError } from '../../../src/types';

// The jose adapters must sign with the key's own alg. They used to hard-code
// RS256, so an EC key could not sign at all.

const claims = { iss: 'https://seller.example.com', jti: 'quote-1' };

const sign = {
  quote: (privateKey: jose.KeyLike, publicJwk: jose.JWK) =>
    toQuoteSigner(privateKey, publicJwk, 'https://seller.example.com').signQuote(claims as never),
  payment: (privateKey: jose.KeyLike, publicJwk: jose.JWK) =>
    toPaymentTokenSigner(privateKey, publicJwk, 'service').signPayment(claims as never),
};

describe.each(Object.entries(sign))('%s signer: signing algorithm', (_name, signWith) => {
  it.each(['ES256', 'ES384', 'ES512', 'RS256'])(
    'signs with %s for a key of that type, and the token verifies',
    async (alg) => {
      const { privateKey, publicKey } = await jose.generateKeyPair(alg);
      const token = await signWith(privateKey, await jose.exportJWK(publicKey));

      expect(jose.decodeProtectedHeader(token)).toEqual({ alg, typ: 'JWT' });
      const { payload } = await jose.jwtVerify(token, publicKey, { algorithms: [alg] });
      expect(payload.jti).toBe('quote-1');
    }
  );

  it("uses the public JWK's alg when it is set", async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair('ES384');
    const publicJwk = { ...(await jose.exportJWK(publicKey)), alg: 'ES384' };

    const token = await signWith(privateKey, publicJwk);
    expect(jose.decodeProtectedHeader(token).alg).toBe('ES384');
  });

  it('derives the alg from the private key when the public key is not a JWK', async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair('ES512');

    const token = await signWith(privateKey, publicKey as unknown as jose.JWK);
    expect(jose.decodeProtectedHeader(token).alg).toBe('ES512');
  });

  it('derives RS256 from an RSA private key when the public key is not a JWK', async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair('RS256');

    const token = await signWith(privateKey, publicKey as unknown as jose.JWK);
    expect(jose.decodeProtectedHeader(token).alg).toBe('RS256');
  });

  it('derives RS256 from a WebCrypto RSASSA-PKCS1-v1_5 private key', async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair('RS256', { extractable: true });
    const webKey = await crypto.subtle.importKey(
      'jwk',
      await jose.exportJWK(privateKey),
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const token = await signWith(webKey, {} as jose.JWK);
    expect(jose.decodeProtectedHeader(token).alg).toBe('RS256');
    await expect(jose.jwtVerify(token, publicKey)).resolves.toBeDefined();
  });

  it('rejects a WebCrypto key of another algorithm', async () => {
    const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, [
      'sign',
    ]);
    expect(() => signWith(hmac, {} as jose.JWK)).toThrow('Unsupported signing key: alg unknown');
  });

  it('derives the alg from a WebCrypto private key', async () => {
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      { name: 'ECDSA', namedCurve: 'P-384' },
      true,
      ['sign', 'verify']
    );

    const token = await signWith(privateKey, {} as jose.JWK);
    expect(jose.decodeProtectedHeader(token).alg).toBe('ES384');
    await expect(jose.jwtVerify(token, publicKey)).resolves.toBeDefined();
  });

  it.each([
    ['PS256', { kty: 'RSA', alg: 'PS256' }],
    ['HS256', { kty: 'oct', alg: 'HS256' }],
    ['an unsupported curve', { kty: 'EC', crv: 'secp256k1' }],
    ['an EC JWK without a curve', { kty: 'EC' }],
    ['an Ed25519 key', { kty: 'OKP', crv: 'Ed25519' }],
  ])('rejects %s when the signer is created', async (_label, publicJwk) => {
    const { privateKey } = await jose.generateKeyPair('ES256');
    // A rejected alg throws before anything is signed.
    expect(() => signWith(privateKey, publicJwk as jose.JWK)).toThrow(ValidationError);
    expect(() => signWith(privateKey, publicJwk as jose.JWK)).toThrow(
      /is not one of RS256, ES256, ES384, ES512/
    );
  });

  it('rejects a key whose alg cannot be determined', async () => {
    expect(() => signWith(new Uint8Array(32) as unknown as jose.KeyLike, {} as jose.JWK)).toThrow(
      'Unsupported signing key: alg unknown'
    );
    expect(() => signWith(null as unknown as jose.KeyLike, {} as jose.JWK)).toThrow(
      ValidationError
    );
  });
});
