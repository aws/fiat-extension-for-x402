// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * jwksDocument: which public JWKs it accepts, and the message it gives for each
 * rejected one. Most details after "invalid key material:" come from the SDK's
 * own checks; a few are the Node.js key import error.
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { JWK } from 'jose';
import { jwksDocument } from '../../../src/agentic-commerce/keys';
import { base64urlDecode } from '../../../src/agentic-commerce/json-value';
import { LocalQuoteSigner } from '../../../src/signers/local';
import { ValidationError } from '../../../src/types';
import * as fixtures from '../../helpers/fixed-vectors';

type Curve = 'P-256' | 'P-384' | 'P-521';

/** A public EC JWK with alg and kid */
function ecJwk(kid: string, curve: Curve = 'P-256', alg = 'ES256'): JWK {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: curve });
  return { ...publicKey.export({ format: 'jwk' }), alg, kid } as JWK;
}

/** A public RSA JWK of the given size, with kid `rsa-<bits>` */
function rsaJwk(bits: number, extra: Record<string, unknown> = {}): JWK {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  return { ...publicKey.export({ format: 'jwk' }), kid: `rsa-${bits}`, ...extra } as JWK;
}

function without(jwk: JWK, member: string): JWK {
  const copy: Record<string, unknown> = { ...jwk };
  delete copy[member];
  return copy as unknown as JWK;
}

function expectInvalid(jwks: JWK[], message: string | RegExp): void {
  expect(() => jwksDocument(...jwks)).toThrow(ValidationError);
  expect(() => jwksDocument(...jwks)).toThrow(message);
}

describe('jwksDocument', () => {
  it('builds the document from one key, copying it', () => {
    const jwk = ecJwk('current');
    const document = jwksDocument(jwk);
    expect(document).toEqual({ keys: [jwk] });
    expect(document.keys[0]).not.toBe(jwk);
  });

  it('keeps the order of the keys for a rotation', () => {
    const current = ecJwk('current');
    const previous = ecJwk('previous');
    expect(jwksDocument(current, previous)).toEqual({ keys: [current, previous] });
  });

  it.each([
    ['P-256', 'ES256'],
    ['P-384', 'ES384'],
    ['P-521', 'ES512'],
  ] as const)('accepts an EC key on %s with alg %s', (curve, alg) => {
    const jwk = ecJwk('k', curve, alg);
    expect(jwksDocument(jwk)).toEqual({ keys: [jwk] });
  });

  it('accepts a key without alg or use, and with use sig', () => {
    const jwk = without(ecJwk('current'), 'alg');
    expect(jwksDocument(jwk)).toEqual({ keys: [jwk] });
    expect(jwksDocument({ ...jwk, use: 'sig' }).keys[0].use).toBe('sig');
  });

  it('accepts an RSA key of 2048 bits', () => {
    const jwk = rsaJwk(2048, { alg: 'RS256' });
    expect(jwksDocument(jwk)).toEqual({ keys: [jwk] });
  });

  it("accepts a LocalQuoteSigner's public JWK, and the fixture seller JWK", () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const signer = LocalQuoteSigner.fromPem(privateKey.export({ type: 'pkcs8', format: 'pem' }), {
      kid: 'r',
      serviceUrl: 'https://seller.example.com',
    });
    expect(jwksDocument(signer.publicJwk).keys).toEqual([signer.publicJwk]);
    expect(jwksDocument(fixtures.SELLER_PUBLIC_JWK as JWK)).toEqual({
      keys: [fixtures.SELLER_PUBLIC_JWK],
    });
  });

  it('requires a key', () => {
    expectInvalid([], 'At least one public key is required');
  });

  it.each([undefined, '', '  ', '\u2003', 123, null])(
    'requires a non-empty string kid (%j)',
    (kid) => {
      const jwk = kid === undefined ? without(ecJwk('x'), 'kid') : { ...ecJwk('x'), kid };
      expectInvalid([jwk as JWK], "Every JWK needs a non-empty string 'kid'");
    }
  );

  it('rejects a repeated kid', () => {
    expectInvalid([ecJwk('same'), ecJwk('same')], 'Duplicate kid: same');
  });

  it.each(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'])('rejects private member %s', (member) => {
    expectInvalid(
      [{ ...ecJwk('current'), [member]: 'secret' }],
      `JWK current: contains private key members ['${member}']`
    );
  });

  it('rejects a whole private JWK, listing its private members', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = { ...privateKey.export({ format: 'jwk' }), kid: 'leak' } as JWK;
    expectInvalid(
      [jwk],
      "JWK leak: contains private key members ['d', 'dp', 'dq', 'p', 'q', 'qi']"
    );
  });

  it.each([
    [undefined, 'None'],
    ['OKP', "'OKP'"],
    ['oct-like', "'oct-like'"],
    ['oct', "'oct'"],
  ])('rejects kty %j', (kty, shown) => {
    const jwk = kty === undefined ? without(ecJwk('current'), 'kty') : { ...ecJwk('current'), kty };
    expectInvalid([jwk], `JWK current: kty must be 'EC' or 'RSA', got ${shown}`);
  });

  it.each([
    [undefined, 'None'],
    ['secp256k1', "'secp256k1'"],
    ['P-192', "'P-192'"],
    ['toString', "'toString'"],
    [['P-256'], "['P-256']"],
    ['P-256\u00a0', "'P-256\\xa0'"],
    ['P-256\u200b', "'P-256\\u200b'"],
    ['P-256\u{e0001}', "'P-256\\U000e0001'"],
    ['a\u2028', "'a\\u2028'"],
    [{ name: "it's" }, `{'name': "it's"}`],
  ])('rejects crv %j', (crv, shown) => {
    const jwk = crv === undefined ? without(ecJwk('current'), 'crv') : { ...ecJwk('current'), crv };
    expectInvalid([jwk as JWK], `JWK current: unsupported EC curve ${shown}`);
  });

  it.each([
    ['HS256', "'HS256'"],
    ['ES384', "'ES384'"],
    ['none', "'none'"],
    ['RS256', "'RS256'"],
    [null, 'None'],
  ])('rejects alg %j on a P-256 key', (alg, shown) => {
    expectInvalid(
      [{ ...ecJwk('current'), alg } as JWK],
      `JWK current: alg ${shown} does not match the key (use ES256)`
    );
  });

  it.each(['PS256', 'RS384', 'ES256'])('rejects alg %s on an RSA key', (alg) => {
    expectInvalid(
      [rsaJwk(2048, { alg })],
      `JWK rsa-2048: alg '${alg}' does not match the key (use RS256)`
    );
  });

  it.each([
    ['enc', "'enc'"],
    [null, 'None'],
  ])('rejects use %j', (use, shown) => {
    expectInvalid(
      [{ ...ecJwk('current'), use } as JWK],
      `JWK current: use must be 'sig', got ${shown}`
    );
  });

  it.each([
    ['a short x', { x: 'AAAA' }, 'Coords should be 32 bytes for curve P-256'],
    [
      'an x that is not base64url',
      { x: '!!not-base64!!' },
      'Coords should be 32 bytes for curve P-256',
    ],
    ['a missing y', { y: undefined }, 'Not an Elliptic curve key'],
    ['a numeric x', { x: 5 }, 'Expected a string value'],
    [
      'an x of 1 more than a multiple of 4 characters',
      { x: 'AAAAA' },
      'Unable to construct key from JWK: Invalid base64-encoded string: number of data ' +
        'characters (5) cannot be 1 more than a multiple of 4',
    ],
  ])('rejects EC key material with %s', (_name, change, detail) => {
    const jwk: Record<string, unknown> = { ...ecJwk('current'), ...change };
    for (const [name, value] of Object.entries(change)) if (value === undefined) delete jwk[name];
    expectInvalid([jwk as unknown as JWK], `JWK current: invalid key material: ${detail}`);
  });

  it('rejects an EC point that is not on the curve', () => {
    const jwk = ecJwk('current');
    const zero = Buffer.alloc(32).toString('base64url');
    for (const change of [{ y: ecJwk('other').y }, { x: zero, y: zero }]) {
      expectInvalid(
        [{ ...jwk, ...change }],
        'JWK current: invalid key material: Unable to construct key from JWK: ' +
          'Invalid EC key. Point is not on the curve specified.'
      );
    }
  });

  it('rejects an RSA key shorter than 2048 bits', () => {
    expectInvalid([rsaJwk(1024)], 'JWK rsa-1024: RSA keys must be at least 2048 bits, got 1024');
  });

  it('rejects an RSA key of 2047 bits', () => {
    expectInvalid([rsaJwk(2047)], 'JWK rsa-2047: RSA keys must be at least 2048 bits, got 2047');
  });

  it.each(['n', 'e'])('rejects RSA key material without %s', (member) => {
    expectInvalid(
      [without(rsaJwk(2048), member)],
      'JWK rsa-2048: invalid key material: Not a public or private key'
    );
  });

  it.each([
    ['an even e', 'AQAC', 'e must be odd.'],
    ['e = 1', 'AQ', 'e must be >= 3 and < n.'],
    ['an empty e', '', 'e must be >= 3 and < n.'],
  ])('rejects invalid RSA public numbers: %s', (_name, e, detail) => {
    expectInvalid(
      [{ ...rsaJwk(2048), e }],
      `JWK rsa-2048: invalid key material: Unable to construct key from JWK: ${detail}`
    );
  });

  it('rejects an RSA n below 3', () => {
    expectInvalid(
      [{ ...rsaJwk(2048), n: 'Ag' }],
      'JWK rsa-2048: invalid key material: Unable to construct key from JWK: n must be >= 3.'
    );
  });

  it('rejects an e not below n', () => {
    const jwk = rsaJwk(2048);
    expectInvalid(
      [{ ...jwk, e: jwk.n }],
      'JWK rsa-2048: invalid key material: Unable to construct key from JWK: e must be >= 3 and < n.'
    );
  });

  it('rejects a value that is not an object', () => {
    expectInvalid([null as unknown as JWK], 'Every JWK must be an object');
  });

  it('checks every key, and names the failing one', () => {
    expectInvalid([ecJwk('good'), { ...ecJwk('bad'), use: 'enc' }], "JWK bad: use must be 'sig'");
  });
});

/**
 * base64urlDecode is lenient: it accepts both alphabets, adds missing padding
 * and skips characters outside the alphabet. Each case gives the decoded bytes
 * in hex, or the error.
 */
describe('base64urlDecode', () => {
  it.each([
    ['AAAA', '000000'],
    ['AAAA.', '000000'],
    ['AA==', '00'],
    ['AAAA=', '000000'],
    ['AB=CD', '001083'],
    ['\u00e9', ''],
    ['AAA\u00e9', '0000'],
    ['+/+/', 'fbffbf'],
    ['-_-_', 'fbffbf'],
    ['AA==AAAA', '00'],
    ['', ''],
    ['=', ''],
    ['AAAAAA', '00000000'],
  ])('decodes %j', (input, hex) => {
    expect(base64urlDecode(input).toString('hex')).toBe(hex);
  });

  it.each([
    ['AAA.', 'Incorrect padding'],
    ['AA.', 'Incorrect padding'],
    ['AA=A', 'Incorrect padding'],
    ['A=AA', 'Incorrect padding'],
    [
      'A.',
      'Invalid base64-encoded string: number of data characters (1) cannot be 1 more than a multiple of 4',
    ],
    [
      'AAAAA',
      'Invalid base64-encoded string: number of data characters (5) cannot be 1 more than a multiple of 4',
    ],
  ])('rejects %j', (input, message) => {
    expect(() => base64urlDecode(input)).toThrow(message);
    expect(() => base64urlDecode(input)).not.toThrow('Unable to construct key');
  });

  it('rejects a lone surrogate, which has no UTF-8 encoding', () => {
    expect(() => base64urlDecode('AA\ud800AA')).toThrow(
      "'utf-8' codec can't encode character '\\ud800' in position 2: surrogates not allowed"
    );
    // A surrogate pair is fine: it is not base64, so it is skipped.
    expect(base64urlDecode('AAAA\ud83d\ude00').toString('hex')).toBe('000000');
  });

  it('reports a lone surrogate in a JWK as invalid key material', () => {
    const jwk = ecJwk('k');
    expectInvalid(
      [{ ...jwk, x: `\ud800${jwk.x as string}` }],
      'JWK k: invalid key material: Unable to construct key from JWK: ' +
        "'utf-8' codec can't encode character '\\ud800' in position 0: surrogates not allowed"
    );
  });

  it('decodes RSA e before n, so e reports first', () => {
    expectInvalid(
      [{ ...rsaJwk(2048), n: 'A', e: 'AAAAA' }],
      'JWK rsa-2048: invalid key material: Unable to construct key from JWK: ' +
        'Invalid base64-encoded string: number of data characters (5) cannot be 1 more than a multiple of 4'
    );
  });

  it('rejects a value that is not a string', () => {
    expect(() => base64urlDecode(5)).toThrow(new TypeError('Expected a string value'));
  });

  it('rejects an EC coordinate with a stray character', () => {
    const jwk = ecJwk('current');
    expectInvalid(
      [{ ...jwk, x: `${jwk.x as string}.` }],
      'JWK current: invalid key material: Unable to construct key from JWK: Incorrect padding'
    );
  });
});
