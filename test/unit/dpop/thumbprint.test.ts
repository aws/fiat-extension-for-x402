// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { generateDPoPKeyPair } from '../../helpers/dpop';
import { computeJWKThumbprint } from '../../../src/dpop/verification';
import { DPoPError } from '../../../src/types';
import { createHash } from 'crypto';
import { BUYER_JKT, BUYER_PUBLIC_JWK } from '../../helpers/cross-language-fixtures';

describe('DPoP JWK thumbprint', () => {
  describe('computeJWKThumbprint', () => {
    it('should compute thumbprint for EC key', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const thumbprint = await computeJWKThumbprint(keyPair.publicKey);

      expect(thumbprint).toBeDefined();
      expect(typeof thumbprint).toBe('string');
      expect(thumbprint.length).toBeGreaterThan(0);
    });

    it('should compute thumbprint for RSA key', async () => {
      const keyPair = await generateDPoPKeyPair('RS256');
      const thumbprint = await computeJWKThumbprint(keyPair.publicKey);

      expect(thumbprint).toBeDefined();
      expect(typeof thumbprint).toBe('string');
    });

    it('should compute same thumbprint for same key', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const thumbprint1 = await computeJWKThumbprint(keyPair.publicKey);
      const thumbprint2 = await computeJWKThumbprint(keyPair.publicKey);

      expect(thumbprint1).toBe(thumbprint2);
    });

    it('should compute different thumbprints for different keys', async () => {
      const keyPair1 = await generateDPoPKeyPair('ES256');
      const keyPair2 = await generateDPoPKeyPair('ES256');

      const thumbprint1 = await computeJWKThumbprint(keyPair1.publicKey);
      const thumbprint2 = await computeJWKThumbprint(keyPair2.publicKey);

      expect(thumbprint1).not.toBe(thumbprint2);
    });
  });

  // As the Python SDK's compute_jwk_thumbprint (dpop/verification.py:156-175).
  it('matches the RFC 7638 section 3.1 example', async () => {
    const jwk = {
      kty: 'RSA',
      n:
        '0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAtVT86zwu1RK7aPFFxuhDR1L6' +
        'tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W-5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5' +
        'v-65YGjQR0_FDW2QvzqY368QQMicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbIS' +
        'D08qNLyrdkt-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-csFCur-k' +
        'EgU8awapJzKnqDKgw',
      e: 'AQAB',
      alg: 'RS256',
      kid: '2011-04-29',
    };
    expect(await computeJWKThumbprint(jwk)).toBe('NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs');
  });

  it('matches the cross-language buyer key thumbprint', async () => {
    expect(await computeJWKThumbprint({ ...BUYER_PUBLIC_JWK, alg: 'ES256', use: 'sig' })).toBe(
      BUYER_JKT
    );
  });

  it('hashes the required members that are present, as Python does', async () => {
    // sha256('{"kty":"EC"}'): Python omits missing members instead of raising.
    expect(await computeJWKThumbprint({ kty: 'EC' })).toBe(
      createHash('sha256').update('{"kty":"EC"}').digest('base64url')
    );
    // Nested values are dumped as Python does, with sorted keys.
    expect(await computeJWKThumbprint({ kty: 'EC', x: [1, { b: 2, a: null }] } as never)).toBe(
      createHash('sha256').update('{"kty":"EC","x":[1,{"a":null,"b":2}]}').digest('base64url')
    );
    // Python's json.dumps escapes non-ASCII characters.
    expect(await computeJWKThumbprint({ kty: 'EC', crv: '\u00e9' })).toBe(
      createHash('sha256').update('{"crv":"\\u00e9","kty":"EC"}').digest('base64url')
    );
  });

  it.each([{ kty: 'OKP', crv: 'Ed25519', x: 'abc' }, {}, { kty: 7 }])(
    'rejects an unsupported key type: %j',
    async (jwk) => {
      await expect(computeJWKThumbprint(jwk as never)).rejects.toThrow(
        new DPoPError(`Unsupported key type in DPoP proof: ${String(jwk.kty ?? '')}`)
      );
    }
  );
});
