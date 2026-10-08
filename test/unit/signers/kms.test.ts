// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
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

import { createKmsQuoteSigner } from '../../../src/signers/kms';

const keyArn = 'arn:aws:kms:us-east-1:123456789012:alias/quote-key';
const serviceUrl = 'https://api.example.com';

const CURVES = {
  ECDSA_SHA_256: { namedCurve: 'P-256', hash: 'sha256', alg: 'ES256' },
  ECDSA_SHA_384: { namedCurve: 'P-384', hash: 'sha384', alg: 'ES384' },
  ECDSA_SHA_512: { namedCurve: 'P-521', hash: 'sha512', alg: 'ES512' },
} as const;

function signLocallyWith(privateKey: KeyObject, hash: string) {
  sendMock.mockImplementation((command: { input: { Message: Uint8Array } }) =>
    Promise.resolve({
      Signature: sign(hash, command.input.Message, { key: privateKey, dsaEncoding: 'der' }),
    })
  );
}

/** DER SEQUENCE { INTEGER r, INTEGER s } with short-form lengths. */
function der(r: number[], s: number[]): Uint8Array {
  const body = [0x02, r.length, ...r, 0x02, s.length, ...s];
  return Uint8Array.from([0x30, body.length, ...body]);
}

describe('createKmsQuoteSigner', () => {
  beforeEach(() => {
    sendMock.mockReset();
    clientConfigs.length = 0;
  });

  for (const algorithm of Object.keys(CURVES) as (keyof typeof CURVES)[]) {
    it(`signs a JWT that verifies with the ${CURVES[algorithm].namedCurve} public key (${algorithm})`, async () => {
      const { namedCurve, hash, alg } = CURVES[algorithm];
      const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve });
      signLocallyWith(privateKey, hash);

      const signer = createKmsQuoteSigner({ keyArn, region: 'us-east-1', serviceUrl, algorithm });
      // Several tokens, so r and s of varying DER lengths go through the conversion.
      for (let i = 0; i < 8; i++) {
        const token = await signer.signQuote({ iss: serviceUrl, n: i });
        const { payload, protectedHeader } = await jose.jwtVerify(token, publicKey);
        expect(protectedHeader).toEqual({ alg, typ: 'JWT', kid: 'quote-key' });
        expect(payload).toEqual({ iss: serviceUrl, n: i });
      }

      const input = sendMock.mock.calls[0][0].input;
      expect(input).toMatchObject({
        KeyId: keyArn,
        MessageType: 'RAW',
        SigningAlgorithm: algorithm,
      });
    });
  }

  it('defaults to ECDSA_SHA_384', async () => {
    sendMock.mockResolvedValue({ Signature: der([1], [2]) });
    const token = await createKmsQuoteSigner({ keyArn, region: 'us-east-1', serviceUrl }).signQuote(
      {}
    );

    expect(jose.decodeProtectedHeader(token).alg).toBe('ES384');
    expect(sendMock.mock.calls[0][0].input.SigningAlgorithm).toBe('ECDSA_SHA_384');
  });

  it('left-pads short components and drops the DER sign byte from long ones', async () => {
    const r = [0x00, ...Array<number>(32).fill(0xaa)]; // 33 bytes: sign byte + 32
    const s = Array<number>(31).fill(0xbb); // 31 bytes: one short
    sendMock.mockResolvedValue({ Signature: der(r, s) });

    const signer = createKmsQuoteSigner({
      keyArn,
      region: 'us-east-1',
      serviceUrl,
      algorithm: 'ECDSA_SHA_256',
    });
    const token = await signer.signQuote({});
    const raw = Buffer.from(token.split('.')[2], 'base64url');

    expect(raw).toHaveLength(64);
    expect([...raw.subarray(0, 32)]).toEqual(Array(32).fill(0xaa));
    expect([...raw.subarray(32, 33)]).toEqual([0x00]);
    expect([...raw.subarray(33)]).toEqual(Array(31).fill(0xbb));
  });

  it('uses an explicit kid, and the key id from a key ARN', async () => {
    sendMock.mockResolvedValue({ Signature: der([1], [2]) });

    const explicit = createKmsQuoteSigner({
      keyArn,
      region: 'us-east-1',
      serviceUrl,
      kid: 'kid-1',
    });
    expect(jose.decodeProtectedHeader(await explicit.signQuote({})).kid).toBe('kid-1');

    const byKey = createKmsQuoteSigner({
      keyArn: 'arn:aws:kms:us-east-1:123456789012:key/abc-123',
      region: 'us-east-1',
      serviceUrl,
    });
    expect(jose.decodeProtectedHeader(await byKey.signQuote({})).kid).toBe('key/abc-123');
  });

  it('passes credentials to the KMS client only when given', () => {
    const credentials = vi.fn();
    createKmsQuoteSigner({ keyArn, region: 'us-west-2', serviceUrl });
    createKmsQuoteSigner({ keyArn, region: 'us-west-2', serviceUrl, credentials });

    expect(clientConfigs).toEqual([{ region: 'us-west-2' }, { region: 'us-west-2', credentials }]);
  });

  it('throws when KMS returns no signature', async () => {
    sendMock.mockResolvedValue({});
    const signer = createKmsQuoteSigner({ keyArn, region: 'us-east-1', serviceUrl });

    await expect(signer.signQuote({})).rejects.toThrow('KMS Sign returned no signature');
  });

  it('rejects an unsupported algorithm', () => {
    expect(() =>
      createKmsQuoteSigner({
        keyArn,
        region: 'us-east-1',
        serviceUrl,
        algorithm: 'RSASSA_PSS_SHA_256' as never,
      })
    ).toThrow('Unsupported algorithm: RSASSA_PSS_SHA_256');
  });

  it('exposes the service URL and an empty public key', () => {
    const signer = createKmsQuoteSigner({ keyArn, region: 'us-east-1', serviceUrl });

    expect(signer.getServiceUrl()).toBe(serviceUrl);
    expect(signer.getPublicKey()).toEqual({});
  });
});
