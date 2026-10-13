// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * LocalQuoteSigner: construction from a key pair or a PEM, the checks on each,
 * signing, and the fixed seller key and quote vectors.
 *
 * Every private key is generated (or, for the fixture, derived) at test time;
 * no private key PEM is stored in the repository.
 */

import { describe, expect, it } from 'vitest';
import { createPrivateKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import * as jose from 'jose';
import { LocalQuoteSigner } from '../../../src/signers/local';
import type { QuoteSigner } from '../../../src/signers/protocol';
import { SigningError } from '../../../src/types';
import * as fixtures from '../../helpers/fixed-vectors';

const SELLER_URL = 'https://seller.example.com';

type Curve = 'P-256' | 'P-384' | 'P-521';

/** An EC key pair and its public JWK with alg and kid */
function ecKey(kid: string, curve: Curve = 'P-256', alg = 'ES256') {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: curve });
  const jwk = { ...publicKey.export({ format: 'jwk' }), alg, kid } as jose.JWK;
  return { privateKey, publicKey, jwk };
}

function rsaKey(bits: number) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: bits });
  return { privateKey, publicKey, jwk: publicKey.export({ format: 'jwk' }) as jose.JWK };
}

/** A PKCS #8 PEM, encrypted when a password is given */
function pem(key: KeyObject, password?: string): string {
  return key.export(
    password
      ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: password }
      : { type: 'pkcs8', format: 'pem' }
  ) as string;
}

/** A PEM block with a given label and a dummy body (not a key) */
function pemBlock(label: string, body: string): string {
  return `-----BEGIN ${label}-----\n${body}\n-----END ${label}-----\n`;
}

function expectSigningError(fn: () => unknown, message: string | RegExp): void {
  let caught: unknown;
  try {
    fn();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(SigningError);
  expect((caught as SigningError).code).toBe('SIGNING_ERROR');
  expect((caught as Error).message).toMatch(message);
}

describe('LocalQuoteSigner', () => {
  it('satisfies the QuoteSigner interface', () => {
    const { privateKey, jwk } = ecKey('seller-key');
    const signer: QuoteSigner = new LocalQuoteSigner(privateKey, jwk, SELLER_URL);
    expect(typeof signer.signQuote).toBe('function');
  });

  it('exposes the public JWK and the service URL', () => {
    const { privateKey, jwk } = ecKey('seller-key');
    const signer = new LocalQuoteSigner(privateKey, jwk, SELLER_URL);
    expect(signer.publicJwk).toEqual(jwk);
    expect(signer.getServiceUrl()).toBe(SELLER_URL);
  });

  it('returns a copy of the public JWK, so it cannot change the signer', async () => {
    const { privateKey, jwk } = ecKey('seller-key');
    const signer = new LocalQuoteSigner(privateKey, jwk, SELLER_URL);
    signer.publicJwk.kid = 'changed';
    jwk.kid = 'changed-too';
    expect(signer.publicJwk.kid).toBe('seller-key');
    expect(jose.decodeProtectedHeader(await signer.signQuote({})).kid).toBe('seller-key');
  });

  it.each(['', '  ', '\u00a0'])('rejects an empty service URL (%j)', (serviceUrl) => {
    const { privateKey, jwk } = ecKey('seller-key');
    expectSigningError(
      () => new LocalQuoteSigner(privateKey, jwk, serviceUrl),
      "serviceUrl is required and must be non-empty. It becomes the quote token's 'iss' " +
        'claim, which the service requires.'
    );
  });

  it('signs with the JWK alg and kid', async () => {
    const { privateKey, publicKey, jwk } = ecKey('seller-p384', 'P-384', 'ES384');
    const token = await new LocalQuoteSigner(privateKey, jwk, SELLER_URL).signQuote({
      iss: SELLER_URL,
    });
    expect(jose.decodeProtectedHeader(token)).toEqual({
      alg: 'ES384',
      kid: 'seller-p384',
      typ: 'JWT',
    });
    const { payload } = await jose.jwtVerify(token, publicKey, { algorithms: ['ES384'] });
    expect(payload).toEqual({ iss: SELLER_URL });
  });

  it('defaults to ES256 and sends no kid without one', async () => {
    const { privateKey, jwk } = ecKey('unused');
    const { alg: _alg, kid: _kid, ...publicJwk } = jwk;
    const token = await new LocalQuoteSigner(privateKey, publicJwk, SELLER_URL).signQuote({ a: 1 });
    const header = jose.decodeProtectedHeader(token);
    expect(header).toEqual({ alg: 'ES256', typ: 'JWT' });
  });

  it('signs with an RSA key', async () => {
    const { privateKey, publicKey, jwk } = rsaKey(2048);
    const signer = new LocalQuoteSigner(
      privateKey,
      { ...jwk, alg: 'RS256', kid: 'seller-rsa' },
      SELLER_URL
    );
    const { payload } = await jose.jwtVerify(await signer.signQuote({ a: 1 }), publicKey, {
      algorithms: ['RS256'],
    });
    expect(payload).toEqual({ a: 1 });
  });

  it('accepts a WebCrypto CryptoKey', async () => {
    const { privateKey, publicKey } = await jose.generateKeyPair('ES384', { extractable: true });
    const jwk = { ...(await jose.exportJWK(publicKey)), alg: 'ES384', kid: 'web' };
    const token = await new LocalQuoteSigner(privateKey, jwk, SELLER_URL).signQuote({ a: 1 });
    expect((await jose.jwtVerify(token, publicKey)).payload).toEqual({ a: 1 });
  });

  it.each(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'])(
    'rejects private key member %s in the public JWK',
    (member) => {
      const { privateKey, jwk } = ecKey('seller-key');
      expectSigningError(
        () => new LocalQuoteSigner(privateKey, { ...jwk, [member]: 'secret' }, SELLER_URL),
        `publicJwk contains private key members: ['${member}']. Pass only the public key.`
      );
    }
  );

  it('lists every private member, sorted', () => {
    const { privateKey, jwk } = ecKey('seller-key');
    expectSigningError(
      () => new LocalQuoteSigner(privateKey, { ...jwk, q: 'x', d: 'x', dp: 'x' }, SELLER_URL),
      "publicJwk contains private key members: ['d', 'dp', 'q']. Pass only the public key."
    );
  });

  it('rejects a private JWK exported whole', () => {
    const { privateKey } = ecKey('seller-key');
    const privateJwk = privateKey.export({ format: 'jwk' }) as jose.JWK;
    expectSigningError(
      () => new LocalQuoteSigner(privateKey, privateJwk, SELLER_URL),
      "publicJwk contains private key members: ['d']"
    );
  });

  it('rejects an RSA key shorter than 2048 bits', () => {
    const { privateKey, jwk } = rsaKey(1024);
    expectSigningError(
      () => new LocalQuoteSigner(privateKey, { ...jwk, alg: 'RS256', kid: 'r' }, SELLER_URL),
      'RSA keys must be at least 2048 bits, got 1024'
    );
  });

  it('accepts an RSA key of 2047 bits only as short', () => {
    const { privateKey, jwk } = rsaKey(2047);
    expectSigningError(
      () => new LocalQuoteSigner(privateKey, { ...jwk, alg: 'RS256', kid: 'r' }, SELLER_URL),
      'RSA keys must be at least 2048 bits, got 2047'
    );
  });

  describe('checks made at construction rather than when signing or verifying', () => {
    it.each([
      [
        'ES384 on a P-256 key',
        'P-256',
        'ES384',
        "publicJwk alg 'ES384' does not match the private key (use ES256)",
      ],
      [
        'RS256 on an EC key',
        'P-256',
        'RS256',
        "publicJwk alg 'RS256' does not match the private key (use ES256)",
      ],
      [
        'the ES256 default on a P-384 key',
        'P-384',
        undefined,
        "publicJwk alg 'ES256' does not match the private key (use ES384)",
      ],
      [
        'a null alg',
        'P-256',
        null,
        'publicJwk alg None does not match the private key (use ES256)',
      ],
    ] as const)('rejects %s', (_name, curve, alg, message) => {
      const { privateKey, jwk } = ecKey('k', curve);
      const publicJwk = { ...jwk, alg } as jose.JWK;
      if (alg === undefined) delete publicJwk.alg;
      expectSigningError(() => new LocalQuoteSigner(privateKey, publicJwk, SELLER_URL), message);
    });

    it.each(['PS256', 'RS384', 'ES256'])('rejects alg %s on an RSA key', (alg) => {
      const { privateKey, jwk } = rsaKey(2048);
      expectSigningError(
        () => new LocalQuoteSigner(privateKey, { ...jwk, alg }, SELLER_URL),
        `publicJwk alg '${alg}' does not match the private key (use RS256)`
      );
    });

    it('rejects a public JWK of another key, of another curve, or without key material', () => {
      const { privateKey, jwk } = ecKey('k');
      const other = ecKey('k').jwk;
      const p384 = ecKey('k', 'P-384', 'ES256').jwk;
      const candidates: jose.JWK[] = [
        other,
        p384,
        { alg: 'ES256', kid: 'k' } as jose.JWK,
        { ...jwk, x: other.x },
      ];
      for (const publicJwk of candidates) {
        expectSigningError(
          () => new LocalQuoteSigner(privateKey, publicJwk, SELLER_URL),
          'publicJwk is not the public key of privateKey'
        );
      }
      const rsa = rsaKey(2048);
      expectSigningError(
        () =>
          new LocalQuoteSigner(rsa.privateKey, { ...rsaKey(2048).jwk, alg: 'RS256' }, SELLER_URL),
        'publicJwk is not the public key of privateKey'
      );
    });

    it('signs RS256 with an RSASSA-PKCS1-v1_5 CryptoKey made for SHA-512', async () => {
      const { privateKey, publicKey } = await crypto.subtle.generateKey(
        {
          name: 'RSASSA-PKCS1-v1_5',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-512',
        },
        true,
        ['sign', 'verify']
      );
      const jwk = { ...(await jose.exportJWK(publicKey)), alg: 'RS256', kid: 'web-rsa' };
      const token = await new LocalQuoteSigner(privateKey, jwk, SELLER_URL).signQuote({ a: 1 });
      const verifyKey = await jose.importJWK(jwk, 'RS256');
      expect((await jose.jwtVerify(token, verifyKey)).payload).toEqual({ a: 1 });
    });

    it.each([
      ['an ECDH key', { name: 'ECDH', namedCurve: 'P-256' }, ['deriveBits']],
      [
        'an RSA-OAEP key',
        {
          name: 'RSA-OAEP',
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: 'SHA-256',
        },
        ['encrypt', 'decrypt'],
      ],
    ] as const)(
      'rejects a CryptoKey that is not for signing: %s',
      async (_name, algorithm, usages) => {
        const pair = (await crypto.subtle.generateKey(algorithm, true, [...usages])) as {
          privateKey: jose.KeyLike;
          publicKey: Parameters<typeof crypto.subtle.exportKey>[1];
        };
        const publicJwk = {
          ...(await crypto.subtle.exportKey('jwk', pair.publicKey)),
          alg: 'ES256',
        };
        expectSigningError(
          () => new LocalQuoteSigner(pair.privateKey, publicJwk as jose.JWK, SELLER_URL),
          'privateKey must be an EC or RSA private key'
        );
      }
    );

    it('rejects a kid that is not a string', () => {
      const { privateKey, jwk } = ecKey('k');
      expectSigningError(
        () =>
          new LocalQuoteSigner(privateKey, { ...jwk, kid: 123 } as unknown as jose.JWK, SELLER_URL),
        'publicJwk kid must be a string'
      );
    });

    it('rejects a JWK value that cannot be copied', () => {
      const { privateKey, jwk } = ecKey('k');
      expectSigningError(
        () =>
          new LocalQuoteSigner(
            privateKey,
            { ...jwk, ext: () => true } as unknown as jose.JWK,
            SELLER_URL
          ),
        'publicJwk must be a JWK object'
      );
    });

    it('rejects EC coordinates that are not the curve size, which jwksDocument would reject', () => {
      // Find a key whose x starts with a zero byte, then drop that byte.
      for (let i = 0; i < 5000; i++) {
        const { privateKey, jwk } = ecKey('k');
        const x = Buffer.from(jwk.x!, 'base64url');
        if (x[0] !== 0) continue;
        const short = { ...jwk, x: x.subarray(1).toString('base64url') };
        expectSigningError(
          () => new LocalQuoteSigner(privateKey, short, SELLER_URL),
          'publicJwk is not the public key of privateKey'
        );
        return;
      }
      throw new Error('no key with a leading zero byte in x');
    });

    it('accepts the right public JWK with a non-minimal (zero-prefixed) n', async () => {
      const { privateKey, publicKey, jwk } = rsaKey(2048);
      const n = Buffer.concat([Buffer.from([0]), Buffer.from(jwk.n!, 'base64url')]).toString(
        'base64url'
      );
      const signer = new LocalQuoteSigner(privateKey, { ...jwk, n, alg: 'RS256' }, SELLER_URL);
      await expect(jose.jwtVerify(await signer.signQuote({}), publicKey)).resolves.toBeDefined();
    });

    it('rejects a public key in place of the private key', () => {
      const { publicKey, jwk } = ecKey('k');
      expectSigningError(
        () => new LocalQuoteSigner(publicKey, jwk, SELLER_URL),
        'privateKey must be an EC or RSA private key'
      );
    });

    it('rejects an Ed25519 key and an EC key on another curve', () => {
      const ed = generateKeyPairSync('ed25519');
      expectSigningError(
        () => new LocalQuoteSigner(ed.privateKey, { kty: 'OKP' }, SELLER_URL),
        'privateKey must be an EC or RSA private key'
      );
      const k1 = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
      expectSigningError(
        () => new LocalQuoteSigner(k1.privateKey, { kty: 'EC' }, SELLER_URL),
        'Unsupported EC curve: secp256k1'
      );
    });

    it('rejects a public JWK that is not an object', () => {
      const { privateKey } = ecKey('k');
      expectSigningError(
        () => new LocalQuoteSigner(privateKey, null as unknown as jose.JWK, SELLER_URL),
        'publicJwk must be a JWK object'
      );
    });
  });
});

describe('LocalQuoteSigner.fromPem', () => {
  it.each([
    ['P-256', 'ES256'],
    ['P-384', 'ES384'],
    ['P-521', 'ES512'],
  ] as const)('loads a %s key and signs %s', async (curve, alg) => {
    const { privateKey } = ecKey('unused', curve);
    const signer = LocalQuoteSigner.fromPem(pem(privateKey), { kid: 'k1', serviceUrl: SELLER_URL });

    const jwk = signer.publicJwk;
    expect(Object.keys(jwk)).toEqual(['kty', 'crv', 'x', 'y', 'alg', 'kid', 'use']);
    expect(jwk).toMatchObject({ kty: 'EC', crv: curve, alg, kid: 'k1', use: 'sig' });
    expect(jwk).not.toHaveProperty('d');
    const token = await signer.signQuote({ a: 1 });
    expect(jose.decodeProtectedHeader(token).kid).toBe('k1');
    const { payload } = await jose.jwtVerify(token, await jose.importJWK(jwk), {
      algorithms: [alg],
    });
    expect(payload).toEqual({ a: 1 });
  });

  it("loads an RSA key from a string, with key_ops ['verify'] in its public JWK", async () => {
    const { privateKey, publicKey } = rsaKey(2048);
    const signer = LocalQuoteSigner.fromPem(pem(privateKey), { kid: 'r1', serviceUrl: SELLER_URL });

    const jwk = signer.publicJwk;
    expect(Object.keys(jwk)).toEqual(['kty', 'key_ops', 'n', 'e', 'alg', 'kid', 'use']);
    expect(jwk).toMatchObject({ kty: 'RSA', key_ops: ['verify'], alg: 'RS256', use: 'sig' });
    for (const member of ['d', 'p', 'q', 'dp', 'dq', 'qi']) expect(jwk).not.toHaveProperty(member);
    const { payload } = await jose.jwtVerify(await signer.signQuote({ a: 1 }), publicKey, {
      algorithms: ['RS256'],
    });
    expect(payload).toEqual({ a: 1 });
  });

  it('loads a PEM given as bytes, and SEC 1 and PKCS #1 PEMs', () => {
    const ec = ecKey('unused', 'P-384').privateKey;
    const rsa = rsaKey(2048).privateKey;
    const bytes = new TextEncoder().encode(pem(ec));
    expect(
      LocalQuoteSigner.fromPem(bytes, { kid: 'b', serviceUrl: SELLER_URL }).publicJwk.alg
    ).toBe('ES384');
    const sec1 = ec.export({ type: 'sec1', format: 'pem' }) as string;
    expect(LocalQuoteSigner.fromPem(sec1, { kid: 's', serviceUrl: SELLER_URL }).publicJwk.alg).toBe(
      'ES384'
    );
    const pkcs1 = rsa.export({ type: 'pkcs1', format: 'pem' }) as string;
    expect(
      LocalQuoteSigner.fromPem(pkcs1, { kid: 'p', serviceUrl: SELLER_URL }).publicJwk.alg
    ).toBe('RS256');
  });

  it('loads an encrypted PEM with its password, as a string or bytes', () => {
    const { privateKey } = ecKey('unused', 'P-384');
    const encrypted = pem(privateKey, 'pass-phrase');
    for (const password of ['pass-phrase', new TextEncoder().encode('pass-phrase')]) {
      const signer = LocalQuoteSigner.fromPem(encrypted, {
        kid: 'k1',
        serviceUrl: SELLER_URL,
        password,
      });
      expect(signer.publicJwk.alg).toBe('ES384');
    }
  });

  it('treats an empty password for an encrypted PEM as none', () => {
    for (const password of ['', new Uint8Array(0)]) {
      expectSigningError(
        () =>
          LocalQuoteSigner.fromPem(pem(ecKey('unused').privateKey, 'pass-phrase'), {
            kid: 'k1',
            serviceUrl: SELLER_URL,
            password,
          }),
        'Could not load the PEM private key: Password was not given but private key is encrypted'
      );
    }
    expectSigningError(
      () =>
        LocalQuoteSigner.fromPem(pem(ecKey('unused').privateKey), {
          kid: 'k1',
          serviceUrl: SELLER_URL,
          password: '',
        }),
      'Could not load the PEM private key: Password was given but private key is not encrypted.'
    );
  });

  it('loads the first private key block of a bundle', () => {
    const plainKey = ecKey('unused', 'P-384').privateKey;
    const plain = pem(plainKey);
    const encrypted = pem(ecKey('unused').privateKey, 'pass-phrase');
    const signer = LocalQuoteSigner.fromPem(`${plain}${encrypted}`, {
      kid: 'k1',
      serviceUrl: SELLER_URL,
    });
    expect(signer.publicJwk.crv).toBe('P-384');
    expectSigningError(
      () =>
        LocalQuoteSigner.fromPem(`${plain}${encrypted}`, {
          kid: 'k1',
          serviceUrl: SELLER_URL,
          password: 'pass-phrase',
        }),
      'Could not load the PEM private key: Password was given but private key is not encrypted.'
    );
    expectSigningError(
      () => LocalQuoteSigner.fromPem(`${encrypted}${plain}`, { kid: 'k1', serviceUrl: SELLER_URL }),
      'Could not load the PEM private key: Password was not given but private key is encrypted'
    );
    // A certificate before the key is skipped.
    const withCert = `${pemBlock('CERTIFICATE', 'AAAA')}${plain}`;
    expect(
      LocalQuoteSigner.fromPem(withCert, { kid: 'k1', serviceUrl: SELLER_URL }).publicJwk.crv
    ).toBe('P-384');
  });

  it('names an unsupported curve by its SEC name (secp192r1, not prime192v1)', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime192v1' });
    expectSigningError(
      () => LocalQuoteSigner.fromPem(pem(privateKey), { kid: 'k1', serviceUrl: SELLER_URL }),
      'Unsupported EC curve: secp192r1'
    );
  });

  it('treats a null password as no password', () => {
    const plain = pem(ecKey('unused').privateKey);
    const signer = LocalQuoteSigner.fromPem(plain, {
      kid: 'k1',
      serviceUrl: SELLER_URL,
      password: null,
    });
    expect(signer.publicJwk.kid).toBe('k1');
    expectSigningError(
      () =>
        LocalQuoteSigner.fromPem(pem(ecKey('unused').privateKey, 'pass-phrase'), {
          kid: 'k1',
          serviceUrl: SELLER_URL,
          password: null,
        }),
      'Could not load the PEM private key: Password was not given but private key is encrypted'
    );
  });

  it('keeps the load error as the cause', () => {
    try {
      LocalQuoteSigner.fromPem('not a key', { kid: 'k1', serviceUrl: SELLER_URL });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });

  it('reports a damaged encrypted PEM as damaged, not as a wrong password', () => {
    const lines = pem(ecKey('unused').privateKey, 'pass-phrase').split('\n');
    const truncated = [...lines.slice(0, 3), ...lines.slice(-2)].join('\n');
    let message = '';
    try {
      LocalQuoteSigner.fromPem(truncated, {
        kid: 'k1',
        serviceUrl: SELLER_URL,
        password: 'pass-phrase',
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/^Could not load the PEM private key: /);
    expect(message).not.toContain('Incorrect password');
  });

  it('reports a wrong password that decrypts to undecodable bytes as a format error', () => {
    // About 1 in 100 wrong passwords pass the padding check and fail to decode
    // (ERR_OSSL_UNSUPPORTED). Those are reported as a format error, not as a
    // wrong password. Find one.
    const encrypted = pem(ecKey('unused').privateKey, 'pass-phrase');
    for (let i = 0; i < 3000; i++) {
      try {
        createPrivateKey({ key: encrypted, format: 'pem', passphrase: `wrong-${i}` });
      } catch (error) {
        if ((error as { code?: string }).code !== 'ERR_OSSL_UNSUPPORTED') continue;
        let message = '';
        try {
          LocalQuoteSigner.fromPem(encrypted, {
            kid: 'k1',
            serviceUrl: SELLER_URL,
            password: `wrong-${i}`,
          });
        } catch (thrown) {
          message = (thrown as Error).message;
        }
        expect(message).toMatch(/^Could not load the PEM private key: /);
        expect(message).not.toContain('Incorrect password');
        return;
      }
    }
    throw new Error('no wrong password failed with ERR_OSSL_UNSUPPORTED');
  });

  it('reports a PEM with no private key block', () => {
    const publicPem = ecKey('unused').publicKey.export({ type: 'spki', format: 'pem' }) as string;
    const openssh = pemBlock(['OPENSSH', 'PRIVATE', 'KEY'].join(' '), 'AAAA');
    for (const text of [publicPem, openssh]) {
      expectSigningError(
        () => LocalQuoteSigner.fromPem(text, { kid: 'k1', serviceUrl: SELLER_URL }),
        'Could not load the PEM private key: Valid PEM but no BEGIN/END delimiters for a ' +
          'private key found. Are you sure this is a private key?'
      );
    }
  });

  it.each(['', 'hello', 'not a key'])(
    'reports text with no PEM section (%j) as MalformedFraming',
    (text) => {
      expectSigningError(
        () => LocalQuoteSigner.fromPem(text, { kid: 'k1', serviceUrl: SELLER_URL }),
        'Could not load the PEM private key: Unable to load PEM file. See ' +
          'https://cryptography.io/en/latest/faq/#why-can-t-i-import-my-pem-file for more ' +
          'details. MalformedFraming'
      );
    }
  );

  it('skips an OPENSSH PRIVATE KEY block before the key', () => {
    const openssh = pemBlock(['OPENSSH', 'PRIVATE', 'KEY'].join(' '), 'AAAA');
    const signer = LocalQuoteSigner.fromPem(
      `${openssh}${pem(ecKey('unused', 'P-384').privateKey)}`,
      {
        kid: 'k1',
        serviceUrl: SELLER_URL,
      }
    );
    expect(signer.publicJwk.crv).toBe('P-384');
  });

  it('fails with a wrong password', () => {
    const encrypted = pem(ecKey('unused', 'P-384').privateKey, 'pass-phrase');
    expectSigningError(
      () =>
        LocalQuoteSigner.fromPem(encrypted, { kid: 'k1', serviceUrl: SELLER_URL, password: 'no' }),
      'Could not load the PEM private key: Incorrect password, could not decrypt key'
    );
  });

  it('fails without the password of an encrypted PEM', () => {
    const encrypted = pem(ecKey('unused').privateKey, 'pass-phrase');
    const traditional = ecKey('unused').privateKey.export({
      type: 'sec1',
      format: 'pem',
      cipher: 'aes-256-cbc',
      passphrase: 'pass-phrase',
    }) as string;
    for (const text of [encrypted, traditional]) {
      expectSigningError(
        () => LocalQuoteSigner.fromPem(text, { kid: 'k1', serviceUrl: SELLER_URL }),
        'Could not load the PEM private key: Password was not given but private key is encrypted'
      );
    }
    const signer = LocalQuoteSigner.fromPem(traditional, {
      kid: 'k1',
      serviceUrl: SELLER_URL,
      password: 'pass-phrase',
    });
    expect(signer.publicJwk.alg).toBe('ES256');
  });

  it('refuses a password for an unencrypted PEM', () => {
    expectSigningError(
      () =>
        LocalQuoteSigner.fromPem(pem(ecKey('unused').privateKey), {
          kid: 'k1',
          serviceUrl: SELLER_URL,
          password: 'pass-phrase',
        }),
      'Could not load the PEM private key: Password was given but private key is not encrypted.'
    );
  });

  it('fails on text that is not a PEM private key', () => {
    const publicPem = ecKey('unused').publicKey.export({ type: 'spki', format: 'pem' }) as string;
    for (const text of ['not a key', publicPem, '']) {
      expectSigningError(
        () => LocalQuoteSigner.fromPem(text, { kid: 'k1', serviceUrl: SELLER_URL }),
        /^Could not load the PEM private key: /
      );
    }
  });

  it.each(['', '  ', undefined, 7])('requires a non-empty kid (%j)', (kid) => {
    expectSigningError(
      () =>
        LocalQuoteSigner.fromPem(pem(ecKey('unused').privateKey), {
          kid: kid as string,
          serviceUrl: SELLER_URL,
        }),
      'kid is required and must be non-empty.'
    );
  });

  it('checks the kid before loading the PEM', () => {
    expectSigningError(
      () => LocalQuoteSigner.fromPem('not a key', { kid: '', serviceUrl: SELLER_URL }),
      'kid is required and must be non-empty.'
    );
  });

  it('requires a service URL', () => {
    expectSigningError(
      () =>
        LocalQuoteSigner.fromPem(pem(ecKey('unused').privateKey), { kid: 'k', serviceUrl: ' ' }),
      /^serviceUrl is required/
    );
  });

  it('rejects an unsupported curve', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    expectSigningError(
      () => LocalQuoteSigner.fromPem(pem(privateKey), { kid: 'k1', serviceUrl: SELLER_URL }),
      'Unsupported EC curve: secp256k1'
    );
  });

  it('checks the curve before the service URL', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
    expectSigningError(
      () => LocalQuoteSigner.fromPem(pem(privateKey), { kid: 'k1', serviceUrl: '' }),
      'Unsupported EC curve: secp256k1'
    );
  });

  it.each([
    ['DSA', () => generateKeyPairSync('dsa', { modulusLength: 2048, divisorLength: 256 })],
    ['RSA-PSS', () => generateKeyPairSync('rsa-pss', { modulusLength: 2048 })],
    ['X25519', () => generateKeyPairSync('x25519')],
  ] as const)('rejects a %s key before any JWK export', (_name, generate) => {
    expectSigningError(
      () =>
        LocalQuoteSigner.fromPem(pem(generate().privateKey), { kid: 'k1', serviceUrl: SELLER_URL }),
      'Only EC and RSA private keys are supported.'
    );
  });

  it('rejects a curve that has no JWK form', () => {
    const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp224r1' });
    expectSigningError(
      () => LocalQuoteSigner.fromPem(pem(privateKey), { kid: 'k1', serviceUrl: SELLER_URL }),
      'Unsupported EC curve: secp224r1'
    );
  });

  it('rejects a key type other than EC and RSA', () => {
    const { privateKey } = generateKeyPairSync('ed25519');
    expectSigningError(
      () => LocalQuoteSigner.fromPem(pem(privateKey), { kid: 'k1', serviceUrl: SELLER_URL }),
      'Only EC and RSA private keys are supported.'
    );
  });

  it('rejects an RSA key shorter than 2048 bits', () => {
    expectSigningError(
      () =>
        LocalQuoteSigner.fromPem(pem(rsaKey(1024).privateKey), {
          kid: 'r',
          serviceUrl: SELLER_URL,
        }),
      'RSA keys must be at least 2048 bits, got 1024'
    );
  });

  describe('the fixed seller key and quote vectors', () => {
    const signer = () =>
      LocalQuoteSigner.fromPem(pem(fixtures.sellerPrivateKey()), {
        kid: 'fixture-seller-1',
        serviceUrl: fixtures.SELLER_URL,
      });

    it('derives the fixture public JWK, member for member and in order', () => {
      expect(JSON.stringify(signer().publicJwk)).toBe(JSON.stringify(fixtures.SELLER_PUBLIC_JWK));
    });

    it('signs the fixture quote with its exact header and payload bytes', async () => {
      const [header, body] = fixtures.QUOTE_TOKEN.split('.');
      const token = await signer().signQuote(JSON.parse(fixtures.QUOTE_PAYLOAD_JSON) as object);
      expect(token.split('.').slice(0, 2)).toEqual([header, body]);
      // The signature is randomised; it verifies with the fixture public key.
      await expect(
        jose.compactVerify(token, await jose.importJWK(fixtures.SELLER_PUBLIC_JWK))
      ).resolves.toBeDefined();
    });
  });
});
