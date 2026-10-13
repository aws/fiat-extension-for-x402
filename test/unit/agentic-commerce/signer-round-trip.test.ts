// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Sign then verify, for every quote signer: the server scheme's quote
 * (enhancePaymentRequirements) is signed by the signer, embedded in a payment
 * token, and verified by AgenticCommerceVerifier with the seller key resolver
 * that matches the signer.
 *
 * KMS is mocked: Sign signs locally, GetPublicKey returns the local public key.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import * as jose from 'jose';
import type { PaymentRequirements } from '@x402/core/types';

const { kmsKey } = vi.hoisted(() => ({
  kmsKey: { current: undefined as undefined | { privateKey: KeyObject; publicKey: KeyObject } },
}));

vi.mock('@aws-sdk/client-kms', () => {
  class SignCommand {
    constructor(readonly input: { Message: Uint8Array; SigningAlgorithm: string }) {}
  }
  class GetPublicKeyCommand {
    constructor(readonly input: { KeyId: string }) {}
  }
  const hashes: Record<string, string> = {
    ECDSA_SHA_256: 'sha256',
    ECDSA_SHA_384: 'sha384',
    ECDSA_SHA_512: 'sha512',
  };
  return {
    SignCommand,
    GetPublicKeyCommand,
    KMSClient: class {
      send(command: SignCommand | GetPublicKeyCommand) {
        const key = kmsKey.current!;
        if (command instanceof SignCommand) {
          const { Message, SigningAlgorithm } = command.input;
          return Promise.resolve({
            Signature: sign(hashes[SigningAlgorithm]!, Message, {
              key: key.privateKey,
              dsaEncoding: 'der',
            }),
          });
        }
        return Promise.resolve({
          PublicKey: new Uint8Array(key.publicKey.export({ type: 'spki', format: 'der' })),
        });
      }
    },
  };
});

import { AgenticCommerceVerifier } from '../../../src/agentic-commerce/verifier';
import { jwksDocument, type SellerKeyResolver } from '../../../src/agentic-commerce/keys';
import { enhancePaymentRequirements } from '../../../src/agentic-commerce/exact/quote';
import { KmsQuoteSigner, createKmsQuoteSigner } from '../../../src/signers/kms';
import { LocalQuoteSigner } from '../../../src/signers/local';
import { toQuoteSigner, type QuoteSigner } from '../../../src/signers/protocol';
import {
  FakePaymentService,
  SELLER_URL,
  SERVICE_JWKS_BASE_URL,
  SERVICE_JWKS_URL,
  jwksFetch,
  requestUrl,
} from '../../helpers/fake-payment-service';

const SELLER_JWKS_URL = `${SELLER_URL}/.well-known/jwks.json`;
const ARN = 'arn:aws:kms:us-east-1:111122223333:alias/quote-key';

let service: FakePaymentService;

beforeEach(async () => {
  service = await FakePaymentService.create();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function requirements(): PaymentRequirements {
  return {
    scheme: 'exact',
    network: 'aws:base',
    asset: 'iso4217:USD',
    amount: '0.10',
    payTo: 'prod-abc123',
    maxTimeoutSeconds: 300,
    extra: {},
  };
}

/** Sign a quote with `signer`, pay for it, and verify the payment. */
async function signThenVerify(
  signer: QuoteSigner,
  sellerKeyResolver: SellerKeyResolver,
  sellerJwks?: unknown
) {
  const fetchStub = jwksFetch({
    [SERVICE_JWKS_URL]: service.jwks,
    ...(sellerJwks === undefined ? {} : { [SELLER_JWKS_URL]: sellerJwks }),
  });
  vi.stubGlobal('fetch', fetchStub);
  const enhanced = await enhancePaymentRequirements(requirements(), signer);
  const quoteToken = enhanced.extra.quoteToken as string;
  const verifier = new AgenticCommerceVerifier({
    sellerKeyResolver,
    paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
    jwksRequestHeaders: { 'x-access': 'onboarding-key' },
  });
  const result = await verifier.verify(await service.issue(quoteToken), {
    amount: '0.10',
    asset: 'iso4217:USD',
    extra: enhanced.extra,
  });
  return { result, quoteToken, fetchStub };
}

function pkcs8(key: KeyObject): string {
  return key.export({ type: 'pkcs8', format: 'pem' }) as string;
}

const LOCAL_KEYS = [
  ['P-256', () => generateKeyPairSync('ec', { namedCurve: 'P-256' }), 'ES256'],
  ['P-384', () => generateKeyPairSync('ec', { namedCurve: 'P-384' }), 'ES384'],
  ['P-521', () => generateKeyPairSync('ec', { namedCurve: 'P-521' }), 'ES512'],
  ['RSA 2048', () => generateKeyPairSync('rsa', { modulusLength: 2048 }), 'RS256'],
] as const;

describe('LocalQuoteSigner', () => {
  it.each(LOCAL_KEYS)(
    '%s: verifies through the JWKS resolver serving jwksDocument, with no extra headers',
    async (_name, generate, alg) => {
      const signer = LocalQuoteSigner.fromPem(pkcs8(generate().privateKey), {
        kid: 'current',
        serviceUrl: SELLER_URL,
      });
      const previous = LocalQuoteSigner.fromPem(pkcs8(generate().privateKey), {
        kid: 'previous',
        serviceUrl: SELLER_URL,
      });
      const { result, quoteToken, fetchStub } = await signThenVerify(
        signer,
        { type: 'jwks', jwksUrl: SELLER_URL },
        jwksDocument(previous.publicJwk, signer.publicJwk)
      );

      expect(result).toMatchObject({ isValid: true });
      expect(jose.decodeProtectedHeader(quoteToken)).toEqual({ alg, kid: 'current', typ: 'JWT' });
      const sellerCalls = fetchStub.mock.calls.filter(
        ([url]) => requestUrl(url) === SELLER_JWKS_URL
      );
      expect(sellerCalls).toHaveLength(1);
      expect(sellerCalls[0]![1]?.headers).toEqual({});
    }
  );

  it.each(LOCAL_KEYS)('%s: verifies through the static resolver', async (_name, generate) => {
    const signer = LocalQuoteSigner.fromPem(pkcs8(generate().privateKey), {
      kid: 'k',
      serviceUrl: SELLER_URL,
    });
    const { result } = await signThenVerify(signer, {
      type: 'static',
      publicJwk: signer.publicJwk,
    });
    expect(result).toMatchObject({ isValid: true });
  });

  it('fails when the JWKS does not hold the signing key', async () => {
    const signer = LocalQuoteSigner.fromPem(pkcs8(LOCAL_KEYS[0][1]().privateKey), {
      kid: 'current',
      serviceUrl: SELLER_URL,
    });
    const other = LocalQuoteSigner.fromPem(pkcs8(LOCAL_KEYS[0][1]().privateKey), {
      kid: 'other',
      serviceUrl: SELLER_URL,
    });
    const { result } = await signThenVerify(
      signer,
      { type: 'jwks', jwksUrl: SELLER_URL },
      jwksDocument(other.publicJwk)
    );
    expect(result).toEqual({
      isValid: false,
      invalidReason: 'invalid_quote',
      invalidMessage: 'Quote token signature invalid: No matching key found in JWKS',
    });
  });

  it('verifies when constructed from a key pair, as in local development', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const publicJwk = {
      ...publicKey.export({ format: 'jwk' }),
      alg: 'ES256',
      kid: 'dev',
    } as jose.JWK;
    const signer = new LocalQuoteSigner(privateKey, publicJwk, SELLER_URL);
    const { result } = await signThenVerify(signer, { type: 'static', publicJwk });
    expect(result).toMatchObject({ isValid: true });
  });
});

describe.each([
  [
    'KmsQuoteSigner',
    (algorithm: 'ECDSA_SHA_256' | 'ECDSA_SHA_384' | 'ECDSA_SHA_512') =>
      new KmsQuoteSigner({ keyArn: ARN, region: 'us-east-1', serviceUrl: SELLER_URL, algorithm }),
  ],
  [
    'createKmsQuoteSigner',
    (algorithm: 'ECDSA_SHA_256' | 'ECDSA_SHA_384' | 'ECDSA_SHA_512') =>
      createKmsQuoteSigner({ keyArn: ARN, region: 'us-east-1', serviceUrl: SELLER_URL, algorithm }),
  ],
] as const)('%s', (_name, create) => {
  it.each([
    ['ECDSA_SHA_256', 'P-256'],
    ['ECDSA_SHA_384', 'P-384'],
    ['ECDSA_SHA_512', 'P-521'],
  ] as const)('%s: verifies through the KMS resolver', async (algorithm, namedCurve) => {
    kmsKey.current = generateKeyPairSync('ec', { namedCurve });
    // Several quotes, so r and s of varying DER lengths are converted.
    for (let i = 0; i < 4; i++) {
      const { result, quoteToken } = await signThenVerify(create(algorithm), {
        type: 'kms',
        kmsKeyArn: ARN,
        region: 'us-east-1',
      });
      expect(result).toMatchObject({ isValid: true });
      expect(jose.decodeProtectedHeader(quoteToken).kid).toBe('quote-key');
    }
  });
});

describe('toQuoteSigner', () => {
  it.each(LOCAL_KEYS)('%s: verifies through the static resolver', async (_name, generate) => {
    const { privateKey, publicKey } = generate();
    const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k' } as jose.JWK;
    const { result } = await signThenVerify(toQuoteSigner(privateKey, publicJwk, SELLER_URL), {
      type: 'static',
      publicJwk,
    });
    expect(result).toMatchObject({ isValid: true });
  });
});
