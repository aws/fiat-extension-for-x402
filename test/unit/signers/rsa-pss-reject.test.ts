// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * RSA-PSS-only keys are rejected: fromPem reads the algorithm OID of the first
 * unencrypted `BEGIN PRIVATE KEY` block before loading, and an RSA-PSS key fails
 * with "Only EC and RSA private keys are supported.". An encrypted RSA-PSS key
 * is rejected the same way once decrypted. Quote tokens are signed RS256
 * (PKCS #1 v1.5), which such a key does not allow.
 *
 * Every key is generated at test time; no private key PEM is stored.
 */

import { describe, expect, it } from 'vitest';
import { createPrivateKey, generateKeyPairSync, type KeyObject } from 'node:crypto';
import * as jose from 'jose';
import { LocalQuoteSigner, SigningError } from '../../../src/index';

const SELLER_URL = 'https://seller.example.com';
const ONLY_EC_AND_RSA = 'Only EC and RSA private keys are supported.';

const rsaPss = (bits = 2048, params = false) =>
  generateKeyPairSync('rsa-pss', {
    modulusLength: bits,
    ...(params ? { hashAlgorithm: 'sha256', mgf1HashAlgorithm: 'sha256' } : {}),
  }).privateKey;
const pkcs8Pem = (key: KeyObject, password?: string) =>
  key.export(
    password
      ? { type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: password }
      : { type: 'pkcs8', format: 'pem' }
  ) as string;
const plainRsa = () => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

// The PKCS #8 label, assembled so the test holds no key-shaped literal.
const PKCS8_LABEL = ['PRIVATE', 'KEY'].join(' ');

/** A PEM block with a label, around a base64 body (64-character lines) */
function pemOfBase64(label: string, b64: string): string {
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  return [`-----BEGIN ${label}-----`, ...lines, `-----END ${label}-----`, ''].join('\n');
}

/** A PEM block with a label, around DER bytes */
function pem(label: string, der: Buffer): string {
  return pemOfBase64(label, der.toString('base64'));
}

/** An RSA-PSS PKCS #8 key whose parameters name a mask that is not MGF1, which OpenSSL refuses */
function nonMgf1PssPem(): string {
  const len = (n: number) => (n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : [0x82, n >> 8, n & 0xff]);
  const tlv = (tag: number, body: Buffer) =>
    Buffer.concat([Buffer.from([tag, ...len(body.length)]), body]);
  const hex = (h: string) => Buffer.from(h, 'hex');
  const inner = Buffer.from(plainRsa().export({ type: 'pkcs1', format: 'der' }));
  const sha256 = hex('300b0609608648016503040201');
  const params = tlv(
    0x30,
    Buffer.concat([
      tlv(0xa0, sha256),
      tlv(0xa1, tlv(0x30, Buffer.concat([hex('06092a864886f70d010109'), sha256]))),
    ])
  );
  const der = tlv(
    0x30,
    Buffer.concat([
      hex('020100'),
      tlv(0x30, Buffer.concat([hex('06092a864886f70d01010a'), params])),
      tlv(0x04, inner),
    ])
  );
  return pem(PKCS8_LABEL, der);
}

function fromPemError(text: string, password?: string): SigningError {
  try {
    LocalQuoteSigner.fromPem(text, { kid: 'k', serviceUrl: SELLER_URL, password });
  } catch (error) {
    expect(error).toBeInstanceOf(SigningError);
    return error as SigningError;
  }
  throw new Error('fromPem accepted the key');
}

describe('LocalQuoteSigner.fromPem rejects RSA-PSS-only keys', () => {
  it.each([
    ['without PSS parameters', () => pkcs8Pem(rsaPss())],
    ['with PSS parameters', () => pkcs8Pem(rsaPss(2048, true))],
    ['of 1024 bits (rejected as RSA-PSS, before the size check)', () => pkcs8Pem(rsaPss(1024))],
    ['whose parameters OpenSSL refuses (a mask that is not MGF1)', nonMgf1PssPem],
  ])('an unencrypted RSA-PSS key %s', (_name, make) => {
    expect(fromPemError(make()).message).toBe(ONLY_EC_AND_RSA);
  });

  it('checks the key before the password', () => {
    expect(fromPemError(pkcs8Pem(rsaPss()), 'pass-phrase').message).toBe(ONLY_EC_AND_RSA);
  });

  it('checks the first PRIVATE KEY block of the text, even after another key block', () => {
    const traditionalRsa = plainRsa().export({ type: 'pkcs1', format: 'pem' }) as string;
    expect(fromPemError(traditionalRsa + pkcs8Pem(rsaPss())).message).toBe(ONLY_EC_AND_RSA);
    expect(fromPemError(pkcs8Pem(rsaPss()) + traditionalRsa).message).toBe(ONLY_EC_AND_RSA);
  });

  it('checks the kid first', () => {
    let caught: unknown;
    try {
      LocalQuoteSigner.fromPem(pkcs8Pem(rsaPss()), { kid: '', serviceUrl: SELLER_URL });
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toBe('kid is required and must be non-empty.');
  });

  it('rejects an encrypted RSA-PSS key too', () => {
    expect(fromPemError(pkcs8Pem(rsaPss(), 'pass-phrase'), 'pass-phrase').message).toBe(
      ONLY_EC_AND_RSA
    );
    expect(fromPemError(pkcs8Pem(rsaPss(), 'pass-phrase')).message).toBe(
      'Could not load the PEM private key: Password was not given but private key is encrypted'
    );
  });

  it.each([
    ['plain RSA PKCS #8', () => pkcs8Pem(plainRsa())],
    ['EC PKCS #8', () => pkcs8Pem(generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey)],
    ['traditional RSA', () => plainRsa().export({ type: 'pkcs1', format: 'pem' }) as string],
  ])('does not flag %s', async (_name, make) => {
    const signer = LocalQuoteSigner.fromPem(make(), { kid: 'k', serviceUrl: SELLER_URL });
    expect(jose.decodeProtectedHeader(await signer.signQuote({})).alg).toMatch(/^(RS|ES)256$/);
  });

  it.each([
    ['bad base64', 'MII!!!'],
    ['an empty body', ''],
    ['a wrong outer tag', Buffer.from('31020100', 'hex').toString('base64')],
    ['an indefinite length', Buffer.from('3080020100', 'hex').toString('base64')],
    ['an over-long length', Buffer.from('3085010000000000', 'hex').toString('base64')],
  ])('does not flag malformed PKCS #8 (%s): the loader reports it', (_name, body) => {
    const text = pemOfBase64(PKCS8_LABEL, body);
    expect(fromPemError(text).message).toMatch(/^Could not load the PEM private key: /);
  });
});

describe('a slightly malformed RSA-PSS PEM is left to the loader', () => {
  // Each still reads as RSA-PSS to a lenient reader, but the strict check
  // before loading does not flag it, so the loader rejects it with its own
  // message.
  const der = () => Buffer.from(rsaPss().export({ type: 'pkcs8', format: 'der' }));
  const wrap = (b64: string) => pemOfBase64(PKCS8_LABEL, b64);
  it.each([
    ['a character outside the base64 alphabet', () => wrap(`!!!!${der().toString('base64')}`)],
    [
      'unpadded base64 (a partial final quantum)',
      () => {
        const b64 = der().toString('base64');
        let cut = b64;
        while (cut.endsWith('=')) cut = cut.slice(0, -1);
        return wrap(cut === b64 ? b64.slice(0, -1) : cut);
      },
    ],
    ['excess base64 padding', () => wrap(`${der().toString('base64')}=`)],
    ...(
      [
        ['a wrong version tag', 4, 0x04],
        ['a wrong AlgorithmIdentifier tag', 7, 0x31],
        ['a wrong OID tag', 9, 0x05],
      ] as const
    ).map(
      ([name, at, tag]) =>
        [
          name,
          () => {
            // The real RSA-PSS DER (30 82 LL LL | 02 01 00 | 30 .. | 06 ..), one tag changed
            const bytes = der();
            bytes[at] = tag;
            return wrap(bytes.toString('base64'));
          },
        ] as const
    ),
    [
      'a wrong outer DER tag',
      () => {
        const bytes = der();
        bytes[0] = 0x31;
        return wrap(bytes.toString('base64'));
      },
    ],
  ] as [string, () => string][])('%s', (_name, make) => {
    expect(fromPemError(make()).message).toMatch(/^Could not load the PEM private key: /);
  });
});

describe("an RSA-PSS key with a BER length is rejected, with Node's reason", () => {
  // OpenSSL accepts BER lengths and loads the key as rsa-pss, which is then
  // refused as not EC or RSA.
  const der = () => Buffer.from(rsaPss().export({ type: 'pkcs8', format: 'der' }));
  const wrap = (bytes: Buffer) => pem(PKCS8_LABEL, bytes);
  it.each([
    [
      'a 5-byte length',
      (b: Buffer) =>
        Buffer.concat([Buffer.from([0x30, 0x85, 0, 0, 0, b[2]!, b[3]!]), b.subarray(4)]),
    ],
    [
      'an indefinite length',
      (b: Buffer) => Buffer.concat([Buffer.from([0x30, 0x80]), b.subarray(4), Buffer.from([0, 0])]),
    ],
  ])('%s', (_name, rewrite) => {
    const message = fromPemError(wrap(rewrite(der()))).message;
    expect(message).toBe(ONLY_EC_AND_RSA);
  });
});

describe('fromPem with the PEM as bytes from another realm or as an ArrayBuffer', () => {
  it('checks a Uint8Array from another realm and an ArrayBuffer like a string', async () => {
    const { runInNewContext } = await import('node:vm');
    const bytes = new TextEncoder().encode(pkcs8Pem(rsaPss()));
    const foreign = runInNewContext(`new Uint8Array(${bytes.length})`) as Uint8Array;
    foreign.set(bytes);
    for (const input of [foreign, bytes.buffer]) {
      expect(fromPemError(input as unknown as string).message).toBe(ONLY_EC_AND_RSA);
      expect(fromPemError(input as unknown as string, 'pw').message).toBe(ONLY_EC_AND_RSA);
    }
  });
});

describe('fromPem with bytes it cannot read', () => {
  it('reads a detached buffer as empty, with the same message as before the check', () => {
    const bytes = new Uint8Array(16);
    structuredClone(bytes.buffer, { transfer: [bytes.buffer] });
    expect(fromPemError(bytes as unknown as string).message).toBe(
      'Could not load the PEM private key: Unable to load PEM file. See ' +
        'https://cryptography.io/en/latest/faq/#why-can-t-i-import-my-pem-file for more ' +
        'details. MalformedFraming'
    );
  });

  it('reads a Uint8Array at its own offset (a slice of a larger buffer)', () => {
    const text = pkcs8Pem(rsaPss());
    const padded = Buffer.concat([
      Buffer.from('ignored before'),
      Buffer.from(text),
      Buffer.from('after'),
    ]);
    const slice = padded.subarray(14, 14 + Buffer.byteLength(text));
    expect(slice.byteOffset).toBeGreaterThan(0);
    expect(fromPemError(slice as unknown as string, 'pw').message).toBe(ONLY_EC_AND_RSA);
    // An RSA-PSS key before the slice, which reading the whole buffer would find
    const before = Buffer.from(pkcs8Pem(rsaPss()));
    const rsaText = Buffer.from(pkcs8Pem(plainRsa()));
    const signer = LocalQuoteSigner.fromPem(
      Buffer.concat([before, rsaText]).subarray(before.length),
      {
        kid: 'k',
        serviceUrl: SELLER_URL,
      }
    );
    expect(signer.publicJwk.kty).toBe('RSA');
  });

  it('checks other array types the loader reads as bytes', () => {
    const text = pkcs8Pem(rsaPss());
    const clamped = Uint8ClampedArray.from(Buffer.from(text));
    expect(fromPemError(clamped as unknown as string, 'pw').message).toBe(ONLY_EC_AND_RSA);
  });
});

describe('fromPem with input that is not a PEM', () => {
  it.each([undefined, null, 42, {}])('reports %j as a SigningError', (value) => {
    let caught: unknown;
    try {
      LocalQuoteSigner.fromPem(value as unknown as string, { kid: 'k', serviceUrl: SELLER_URL });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SigningError);
    expect((caught as Error).message).toMatch(/^Could not load the PEM private key: /);
  });
});

describe('the constructor rejects an RSA-PSS key object', () => {
  it('rejects an RSA-PSS KeyObject', () => {
    const key = createPrivateKey(pkcs8Pem(rsaPss()));
    expect(() => new LocalQuoteSigner(key, { kty: 'RSA', alg: 'RS256' }, SELLER_URL)).toThrow(
      new SigningError('privateKey must be an EC or RSA private key')
    );
  });

  it('rejects a WebCrypto RSA-PSS CryptoKey', async () => {
    const pair = await crypto.subtle.generateKey(
      {
        name: 'RSA-PSS',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify']
    );
    const jwk = { ...(await jose.exportJWK(pair.publicKey)), alg: 'RS256' } as jose.JWK;
    expect(() => new LocalQuoteSigner(pair.privateKey, jwk, SELLER_URL)).toThrow(
      'privateKey must be an EC or RSA private key'
    );
  });
});
