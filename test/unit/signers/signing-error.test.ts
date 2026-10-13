// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * SigningError, imported from the package entry point, is what the quote
 * signers throw: an AgenticCommerceError with code SIGNING_ERROR and optional
 * details. KMS is mocked.
 */

import { describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { JWK } from 'jose';

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('@aws-sdk/client-kms', () => ({
  KMSClient: class {
    send = send;
  },
  SignCommand: class {
    constructor(readonly input: unknown) {}
  },
}));

import {
  AgenticCommerceError,
  KmsQuoteSigner,
  LocalQuoteSigner,
  SigningError,
  ValidationError,
  createKmsQuoteSigner,
  jwksDocument,
} from '../../../src/index';

const SELLER_URL = 'https://seller.example.com';
const KMS = { keyArn: 'alias/quote-key', region: 'us-east-1', serviceUrl: SELLER_URL };

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('SigningError', () => {
  it('has the SIGNING_ERROR code, the message and details, and is an AgenticCommerceError', () => {
    const error = new SigningError('KMS failed', { supported: ['ECDSA_SHA_384'] });
    expect(error).toBeInstanceOf(SigningError);
    expect(error).toBeInstanceOf(AgenticCommerceError);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(ValidationError);
    expect(error.name).toBe('SigningError');
    expect(error.message).toBe('KMS failed');
    expect(error.code).toBe('SIGNING_ERROR');
    expect(error.details).toEqual({ supported: ['ECDSA_SHA_384'] });
    expect(new SigningError('KMS failed').details).toBeUndefined();
  });

  it('is thrown by LocalQuoteSigner and LocalQuoteSigner.fromPem', () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'ES256', kid: 'k' } as JWK;
    for (const error of [
      thrown(() => new LocalQuoteSigner(privateKey, jwk, ' ')),
      thrown(() => new LocalQuoteSigner(privateKey, { ...jwk, d: 'x' }, SELLER_URL)),
      thrown(() => LocalQuoteSigner.fromPem('not a key', { kid: 'k', serviceUrl: SELLER_URL })),
      thrown(() => LocalQuoteSigner.fromPem('x', { kid: '', serviceUrl: SELLER_URL })),
    ]) {
      expect(error).toBeInstanceOf(SigningError);
      expect(error).toMatchObject({ name: 'SigningError', code: 'SIGNING_ERROR' });
    }
  });

  it('is thrown by KmsQuoteSigner and createKmsQuoteSigner, on construction and signing', async () => {
    const unsupported = thrown(() => new KmsQuoteSigner({ ...KMS, algorithm: 'RSA' as never }));
    expect(unsupported).toBeInstanceOf(SigningError);
    expect((unsupported as SigningError).details).toEqual({
      supported: ['ECDSA_SHA_256', 'ECDSA_SHA_384', 'ECDSA_SHA_512'],
    });
    expect(thrown(() => createKmsQuoteSigner({ ...KMS, serviceUrl: '' }))).toBeInstanceOf(
      SigningError
    );

    send.mockRejectedValueOnce(new Error('AccessDeniedException'));
    await expect(new KmsQuoteSigner(KMS).signQuote({} as never)).rejects.toBeInstanceOf(
      SigningError
    );
    send.mockResolvedValueOnce({});
    await expect(new KmsQuoteSigner(KMS).signQuote({} as never)).rejects.toBeInstanceOf(
      SigningError
    );
  });

  it('keeps the error it wraps as the cause', () => {
    const cause = new Error('inner');
    expect(new SigningError('outer', undefined, { cause }).cause).toBe(cause);
  });

  it('is not what jwksDocument throws: that is a ValidationError', () => {
    const error = thrown(() => jwksDocument());
    expect(error).toBeInstanceOf(ValidationError);
    expect(error).not.toBeInstanceOf(SigningError);
  });
});
