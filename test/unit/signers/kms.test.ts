// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * KmsQuoteSigner (and the deprecated createKmsQuoteSigner): kid derivation,
 * algorithms, signing through KMS, and how KMS errors are reported.
 *
 * KMS is mocked; no test calls AWS.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import * as jose from 'jose';

const { sendMock, clientConfigs } = vi.hoisted(() => ({
  sendMock: vi.fn(),
  clientConfigs: [] as unknown[],
}));

// KMS is mocked: each test signs locally with a key of the matching curve and
// hands back a DER signature, the format KMS Sign returns.
vi.mock('@aws-sdk/client-kms', () => ({
  KMSClient: class {
    constructor(config: unknown) {
      clientConfigs.push(config);
    }
    send = sendMock;
  },
  SignCommand: class {
    constructor(readonly input: { Message: Uint8Array; SigningAlgorithm: string }) {}
  },
}));

import { KmsQuoteSigner, createKmsQuoteSigner, derToRaw } from '../../../src/signers/kms';
import type { QuoteSigner } from '../../../src/signers/protocol';
import { SigningError, type QuoteTokenPayload } from '../../../src/types';

/** The shape of a KMS command passed to the mocked client */
interface KmsCommand {
  input: Record<string, unknown>;
}

const keyArn = 'arn:aws:kms:us-east-1:123456789012:alias/quote-key';
const serviceUrl = 'https://api.example.com';

const CURVES = {
  ECDSA_SHA_256: { namedCurve: 'P-256', hash: 'sha256', alg: 'ES256', size: 32 },
  ECDSA_SHA_384: { namedCurve: 'P-384', hash: 'sha384', alg: 'ES384', size: 48 },
  ECDSA_SHA_512: { namedCurve: 'P-521', hash: 'sha512', alg: 'ES512', size: 66 },
} as const;
type Algorithm = keyof typeof CURVES;
const ALGORITHMS = Object.keys(CURVES) as Algorithm[];

function signLocallyWith(privateKey: KeyObject, hash: string) {
  sendMock.mockImplementation((command: { input: { Message: Uint8Array } }) =>
    Promise.resolve({
      Signature: sign(hash, command.input.Message, { key: privateKey, dsaEncoding: 'der' }),
    })
  );
}

/** DER length octets: short form, or the one-byte long form. */
function derLength(length: number): number[] {
  return length < 0x80 ? [length] : [0x81, length];
}

/** DER SEQUENCE { INTEGER r, INTEGER s }, the contents given as is. */
function der(r: number[], s: number[]): Uint8Array {
  const body = [0x02, ...derLength(r.length), ...r, 0x02, ...derLength(s.length), ...s];
  return Uint8Array.from([0x30, ...derLength(body.length), ...body]);
}

const fill = (length: number, byte: number): number[] => Array<number>(length).fill(byte);

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

beforeEach(() => {
  sendMock.mockReset();
  clientConfigs.length = 0;
});

describe.each([
  [
    'KmsQuoteSigner',
    (config: ConstructorParameters<typeof KmsQuoteSigner>[0]) => new KmsQuoteSigner(config),
  ],
  ['createKmsQuoteSigner', createKmsQuoteSigner],
] as const)('%s', (_name, create) => {
  for (const algorithm of ALGORITHMS) {
    it(`signs a JWT that verifies with the ${CURVES[algorithm].namedCurve} public key (${algorithm})`, async () => {
      const { namedCurve, hash, alg } = CURVES[algorithm];
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve });
      signLocallyWith(privateKey, hash);

      const signer: QuoteSigner = create({ keyArn, region: 'us-east-1', serviceUrl, algorithm });
      // Several tokens, so r and s of varying DER lengths go through the conversion.
      for (let i = 0; i < 8; i++) {
        const token = await signer.signQuote({ iss: serviceUrl, n: i } as never);
        const { payload, protectedHeader } = await jose.jwtVerify(token, publicKey);
        expect(protectedHeader).toEqual({ alg, typ: 'JWT', kid: 'quote-key' });
        expect(payload).toEqual({ iss: serviceUrl, n: i });
      }

      expect((sendMock.mock.calls[0][0] as KmsCommand).input).toMatchObject({
        KeyId: keyArn,
        MessageType: 'RAW',
        SigningAlgorithm: algorithm,
      });
    });
  }

  it('defaults to ECDSA_SHA_384', async () => {
    sendMock.mockResolvedValue({ Signature: der([1], [2]) });
    const token = await create({ keyArn, region: 'us-east-1', serviceUrl }).signQuote({});

    expect(jose.decodeProtectedHeader(token).alg).toBe('ES384');
    expect((sendMock.mock.calls[0][0] as KmsCommand).input.SigningAlgorithm).toBe('ECDSA_SHA_384');
  });

  it('derives the kid from the ARN unless one is given', async () => {
    sendMock.mockResolvedValue({ Signature: der([1], [2]) });
    const vectors: [string, string | undefined, string][] = [
      ['arn:aws:kms:us-east-1:111122223333:alias/my-quote-key', undefined, 'my-quote-key'],
      [
        'arn:aws:kms:us-east-1:111122223333:key/1234abcd-12ab-34cd-56ef-1234567890ab',
        undefined,
        'key/1234abcd-12ab-34cd-56ef-1234567890ab',
      ],
      ['1234abcd-12ab', undefined, '1234abcd-12ab'],
      ['alias/foo', undefined, 'foo'],
      // An explicit kid wins, and an empty kid is kept rather than derived
      ['arn:aws:kms:us-east-1:111122223333:alias/my-quote-key', 'explicit-kid', 'explicit-kid'],
      ['arn:aws:kms:us-east-1:111122223333:alias/my-quote-key', '', ''],
    ];
    for (const [arn, kid, expected] of vectors) {
      const signer = create({ keyArn: arn, region: 'us-east-1', serviceUrl, kid });
      expect(jose.decodeProtectedHeader(await signer.signQuote({})).kid).toBe(expected);
    }
  });

  it('passes credentials to the KMS client only when given', () => {
    const credentials = vi.fn();
    create({ keyArn, region: 'us-west-2', serviceUrl });
    create({ keyArn, region: 'us-west-2', serviceUrl, credentials });

    expect(clientConfigs).toEqual([{ region: 'us-west-2' }, { region: 'us-west-2', credentials }]);
  });

  it.each([{}, { Signature: undefined }, { Signature: new Uint8Array(0) }])(
    'throws when KMS returns no signature (%j)',
    async (response) => {
      sendMock.mockResolvedValue(response);
      const signer = create({ keyArn, region: 'us-east-1', serviceUrl });
      const error = await signer.signQuote({}).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SigningError);
      expect(error).toMatchObject({
        code: 'SIGNING_ERROR',
        message: 'KMS Sign returned no signature',
      });
    }
  );

  it('wraps a KMS error, keeping it as the cause', async () => {
    const kmsError = Object.assign(new Error('AccessDeniedException: not allowed'), {
      name: 'AccessDeniedException',
      $metadata: { requestId: 'req-1' },
    });
    sendMock.mockRejectedValue(kmsError);
    const signer = create({ keyArn, region: 'us-east-1', serviceUrl });
    const error = await signer.signQuote({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SigningError);
    expect(error).toMatchObject({
      code: 'SIGNING_ERROR',
      message: 'KMS Sign API call failed: AccessDeniedException: not allowed',
    });
    expect((error as Error).cause).toBe(kmsError);
  });

  it('rejects a malformed DER signature from KMS with a plain Error', async () => {
    sendMock.mockResolvedValue({ Signature: Uint8Array.from([0x30, 0x00]) });
    const signer = create({ keyArn, region: 'us-east-1', serviceUrl });
    const error = await signer.signQuote({}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(SigningError);
    expect((error as Error).message).toBe(
      'Invalid DER ECDSA signature from KMS: r is not an INTEGER'
    );
  });

  it.each(['RSASSA_PSS_SHA_256', 'constructor', 'toString', '__proto__', ''])(
    'rejects the unsupported algorithm %j',
    (algorithm) => {
      expectSigningError(
        () => create({ keyArn, region: 'us-east-1', serviceUrl, algorithm: algorithm as never }),
        `Unsupported algorithm: ${algorithm}`
      );
    }
  );

  it('lists the supported algorithms in the error details', () => {
    try {
      create({ keyArn, region: 'us-east-1', serviceUrl, algorithm: 'RSA' as never });
      expect.unreachable();
    } catch (error) {
      expect((error as SigningError).details).toEqual({
        supported: ['ECDSA_SHA_256', 'ECDSA_SHA_384', 'ECDSA_SHA_512'],
      });
    }
  });

  it.each(['', '  ', '\t'])('rejects an empty service URL (%j), before the algorithm', (url) => {
    expectSigningError(
      () => create({ keyArn, region: 'us-east-1', serviceUrl: url, algorithm: 'RSA' as never }),
      "serviceUrl is required and must be non-empty. It becomes the quote token's 'iss' " +
        'claim, which the service requires.'
    );
  });

  it('exposes the service URL, and is a KmsQuoteSigner', () => {
    const signer = create({ keyArn, region: 'us-east-1', serviceUrl });
    expect(signer.getServiceUrl()).toBe(serviceUrl);
    expect(signer).toBeInstanceOf(KmsQuoteSigner);
  });
});

describe('createKmsQuoteSigner (deprecated)', () => {
  it("keeps the former factory's getPublicKey(), returning {}; the class has none", () => {
    expect(
      createKmsQuoteSigner({ keyArn, region: 'us-east-1', serviceUrl }).getPublicKey()
    ).toEqual({});
    expect('getPublicKey' in new KmsQuoteSigner({ keyArn, region: 'us-east-1', serviceUrl })).toBe(
      false
    );
  });

  it('reports a null algorithm as None', () => {
    expectSigningError(
      () =>
        new KmsQuoteSigner({ keyArn, region: 'us-east-1', serviceUrl, algorithm: null as never }),
      'Unsupported algorithm: None'
    );
  });

  it('returns bound methods, so it can be destructured and spread as before', async () => {
    sendMock.mockResolvedValue({ Signature: der([1], [2]) });
    // Typed as plain function properties: the point is that they work unbound.
    const bound: { signQuote: (payload: object) => Promise<string>; getServiceUrl: () => string } =
      createKmsQuoteSigner({ keyArn, region: 'us-east-1', serviceUrl });
    const { signQuote, getServiceUrl } = bound;
    expect(getServiceUrl()).toBe(serviceUrl);
    await expect(signQuote({})).resolves.toMatch(/^eyJ/);
    const signer: QuoteSigner = createKmsQuoteSigner({ keyArn, region: 'us-east-1', serviceUrl });
    const spread: QuoteSigner = { ...signer };
    const payload: QuoteTokenPayload = {
      iss: serviceUrl,
      aud: 'aws:marketplace',
      iat: 0,
      exp: 300,
      jti: 'quote-1',
      price: { amount: '0.10', currency: 'USD' },
      payTo: 'seller-1',
      reference: 'RESOURCE',
    };
    await expect(spread.signQuote(payload)).resolves.toMatch(/^eyJ/);
  });
});

describe('KMS signatures with leading zero bytes in r or s', () => {
  for (const algorithm of ALGORITHMS) {
    it(`verify after DER conversion (${algorithm})`, async () => {
      const { namedCurve, hash, size } = CURVES[algorithm];
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve });
      const signer = new KmsQuoteSigner({ keyArn, region: 'us-east-1', serviceUrl, algorithm });
      // Sign until a DER integer is shorter than the component length, that is
      // r or s has a leading zero byte in raw form (about 1 in 128 signatures).
      let found = false;
      for (let i = 0; i < 20_000 && !found; i++) {
        const payload = { iss: serviceUrl, n: i };
        const header = Buffer.from(
          JSON.stringify({ alg: CURVES[algorithm].alg, typ: 'JWT', kid: 'quote-key' })
        ).toString('base64url');
        const message = `${header}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}`;
        const signature = sign(hash, Buffer.from(message), { key: privateKey, dsaEncoding: 'der' });
        const rLength = signature[signature[1] & 0x80 ? 4 : 3];
        const r = signature.subarray(signature[1] & 0x80 ? 5 : 4);
        const sLength = r[rLength + 1];
        if (rLength >= size && sLength >= size) continue;
        found = true;
        sendMock.mockResolvedValueOnce({ Signature: signature });
        const token = await signer.signQuote(payload);
        expect(Buffer.from(token.split('.')[2], 'base64url')).toHaveLength(2 * size);
        await expect(jose.jwtVerify(token, publicKey)).resolves.toBeDefined();
      }
      expect(found).toBe(true);
    });
  }
});

/**
 * derToRaw turns a DER ECDSA signature into the fixed-width r || s form a JWS
 * uses, each component left-padded to the given size. It accepts a leading
 * sign byte and long-form lengths, and rejects malformed DER and a component
 * wider than the size.
 */
describe('derToRaw', () => {
  const accepted: [string, Uint8Array, number, number[]][] = [
    ['short r and s, left-padded', der([1], [2]), 32, [...fill(31, 0), 1, ...fill(31, 0), 2]],
    ['zero r', der([0], [2]), 32, [...fill(32, 0), ...fill(31, 0), 2]],
    [
      'a leading sign byte dropped, a short s padded',
      der([0x00, ...fill(32, 0xaa)], fill(31, 0x7b)),
      32,
      [...fill(32, 0xaa), 0x00, ...fill(31, 0x7b)],
    ],
    [
      '48-byte r and s (ES384), each with a sign byte',
      der([0x00, ...fill(48, 0xcc)], [0x00, ...fill(48, 0xdd)]),
      48,
      [...fill(48, 0xcc), ...fill(48, 0xdd)],
    ],
    [
      '48-byte r and s without a sign byte',
      der([0x7f, ...fill(47, 0x01)], [0x01, ...fill(47, 0x02)]),
      48,
      [0x7f, ...fill(47, 0x01), 0x01, ...fill(47, 0x02)],
    ],
    [
      '66-byte r and s (ES512), the long-form SEQUENCE length',
      der([0x01, ...fill(65, 0xee)], [0x00, 0x81, ...fill(64, 0xaa)]),
      66,
      [0x01, ...fill(65, 0xee), 0x00, 0x81, ...fill(64, 0xaa)],
    ],
    [
      'an r shorter than the component on ES384',
      der(fill(20, 0x11), fill(48, 0x22)),
      48,
      [...fill(28, 0), ...fill(20, 0x11), ...fill(48, 0x22)],
    ],
  ];

  it.each(accepted)('accepts %s', (_name, signature, size, expected) => {
    expect([...derToRaw(signature, size)]).toEqual(expected);
  });

  const rejected: [string, Uint8Array, number, string][] = [
    ['an empty signature', new Uint8Array(0), 32, 'not a SEQUENCE'],
    [
      'a wrong outer tag',
      Uint8Array.from([0x31, ...der([1], [2]).subarray(1)]),
      32,
      'not a SEQUENCE',
    ],
    ['a truncated signature', der([1], [2]).subarray(0, 7), 32, 'SEQUENCE length does not match'],
    [
      'a trailing byte',
      Uint8Array.from([...der([1], [2]), 0]),
      32,
      'SEQUENCE length does not match',
    ],
    [
      'trailing data inside the SEQUENCE',
      Uint8Array.from([0x30, 0x07, 0x02, 0x01, 0x01, 0x02, 0x01, 0x02, 0x00]),
      32,
      'trailing data in SEQUENCE',
    ],
    [
      'a SEQUENCE length too short for s',
      Uint8Array.from([0x30, 0x05, 0x02, 0x01, 0x01, 0x02, 0x01]),
      32,
      's is truncated',
    ],
    [
      'a non-INTEGER r',
      Uint8Array.from([0x30, 0x06, 0x03, 0x01, 0x01, 0x02, 0x01, 0x02]),
      32,
      'r is not an INTEGER',
    ],
    ['a missing s', Uint8Array.from([0x30, 0x03, 0x02, 0x01, 0x01]), 32, 's is not an INTEGER'],
    ['an empty r', der([], [2]), 32, 'r is truncated'],
    ['a negative r', der([0x80], [2]), 32, 'r is negative'],
    ['a negative s (no sign byte)', der([1], fill(31, 0xbb)), 32, 's is negative'],
    ['a non-minimal r', der([0x00, 0x01], [2]), 32, 'r is not minimally encoded'],
    [
      'a non-minimal long-form length',
      Uint8Array.from([0x30, 0x81, 0x06, ...der([1], [2]).subarray(2)]),
      32,
      'invalid length',
    ],
    [
      'an indefinite length',
      Uint8Array.from([0x30, 0x80, ...der([1], [2]).subarray(2), 0, 0]),
      32,
      'invalid length',
    ],
    [
      'a long-form length with a leading zero',
      Uint8Array.from([0x30, 0x82, 0x00, 0x90]),
      32,
      'invalid length',
    ],
    ['a long-form length past the end', Uint8Array.from([0x30, 0x82, 0x01]), 32, 'invalid length'],
    ['a truncated length', Uint8Array.from([0x30]), 32, 'truncated'],
    [
      'an r wider than 32 bytes',
      der([0x01, ...fill(32, 0xaa)], [2]),
      32,
      'r is wider than 32 bytes',
    ],
    [
      'an s wider than 48 bytes',
      der([1], [0x00, 0x80, ...fill(48, 0xdd)]),
      48,
      's is wider than 48 bytes',
    ],
    ['a 66-byte r on ES256', der([0x01, ...fill(65, 0xee)], [2]), 32, 'r is wider than 32 bytes'],
    [
      'a 49-byte r (with sign byte) on ES256',
      der([0x00, ...fill(48, 0xcc)], [2]),
      32,
      'r is wider than 32 bytes',
    ],
  ];

  it.each(rejected)('rejects %s', (_name, signature, size, reason) => {
    // Not a SigningError: a malformed signature is a plain Error, which
    // signQuote does not wrap.
    let caught: unknown;
    try {
      derToRaw(signature, size);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught).not.toBeInstanceOf(SigningError);
    expect((caught as Error).message).toBe(`Invalid DER ECDSA signature from KMS: ${reason}`);
  });
});
