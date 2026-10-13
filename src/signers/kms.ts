// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * AWS KMS Signer for Agentic Commerce quote tokens.
 *
 * Provides a production-ready QuoteSigner that signs quote tokens
 * using an AWS KMS asymmetric key (EC P-256, P-384, or P-521).
 *
 * Usage:
 * ```typescript
 * import { KmsQuoteSigner, ExactAgenticCommerceServerScheme } from '@aws/fiat-extension-for-x402';
 *
 * const server = new ExactAgenticCommerceServerScheme({
 *   signer: new KmsQuoteSigner({
 *     keyArn: 'arn:aws:kms:us-east-1:123456789012:alias/my-quote-signing-key',
 *     region: 'us-east-1',
 *     serviceUrl: 'https://api.myservice.com',
 *   }),
 * });
 * ```
 */

import { KMSClient, SignCommand, type SigningAlgorithmSpec } from '@aws-sdk/client-kms';
import type { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { displayText } from '../agentic-commerce/json-value';
import { SigningError } from '../types';
import { assertServiceUrl, type QuoteSigner } from './protocol';

/**
 * Configuration for the KMS signer.
 */
export interface KmsQuoteSignerConfig {
  /** KMS key ARN or alias ARN (e.g., 'arn:aws:kms:us-east-1:...:alias/my-key') */
  keyArn: string;
  /** AWS region where the KMS key lives */
  region: string;
  /** Service URL used as the `iss` claim in quote tokens */
  serviceUrl: string;
  /** Optional: AWS credentials provider. Defaults to the default credential chain. */
  credentials?: AwsCredentialIdentityProvider;
  /** Optional: Signing algorithm. Defaults to ECDSA_SHA_384 (for P-384 keys). */
  algorithm?: 'ECDSA_SHA_256' | 'ECDSA_SHA_384' | 'ECDSA_SHA_512';
  /** Optional: Key ID to include in the JWT `kid` header. Defaults to the alias or key ID from the ARN. */
  kid?: string;
}

/** Maps KMS algorithm to JWT alg header */
const ALG_MAP: Record<string, string> = {
  ECDSA_SHA_256: 'ES256',
  ECDSA_SHA_384: 'ES384',
  ECDSA_SHA_512: 'ES512',
};

/** Maps KMS algorithm to the fixed-width byte length of each r/s component */
const COMPONENT_LENGTH: Record<string, number> = {
  ECDSA_SHA_256: 32,
  ECDSA_SHA_384: 48,
  ECDSA_SHA_512: 66,
};

/**
 * Quote signer backed by an AWS KMS asymmetric EC key.
 *
 * The private key never leaves KMS: signing happens server-side via the KMS
 * `Sign` API.
 *
 * @example
 * ```typescript
 * const signer = new KmsQuoteSigner({
 *   keyArn: 'arn:aws:kms:us-east-1:123456789012:alias/my-quote-key',
 *   region: 'us-east-1',
 *   serviceUrl: 'https://api.myservice.com',
 * });
 *
 * const server = new ExactAgenticCommerceServerScheme({ signer });
 * ```
 */
export class KmsQuoteSigner implements QuoteSigner {
  private readonly keyArn: string;
  private readonly serviceUrl: string;
  private readonly algorithm: string;
  private readonly jwtAlg: string;
  private readonly componentLength: number;
  private readonly kid: string;
  private readonly kmsClient: KMSClient;

  /**
   * @param config - KMS signer configuration
   * @throws SigningError if the algorithm is
   *   not supported or `serviceUrl` is empty
   */
  constructor(config: KmsQuoteSignerConfig) {
    const { keyArn, region, serviceUrl, credentials, algorithm = 'ECDSA_SHA_384', kid } = config;
    assertServiceUrl(serviceUrl);
    if (!Object.hasOwn(ALG_MAP, algorithm)) {
      throw new SigningError(`Unsupported algorithm: ${displayText(algorithm)}`, {
        supported: Object.keys(ALG_MAP),
      });
    }
    this.keyArn = keyArn;
    this.serviceUrl = serviceUrl;
    this.algorithm = algorithm;
    this.jwtAlg = ALG_MAP[algorithm]!;
    this.componentLength = COMPONENT_LENGTH[algorithm]!;

    // Derive kid from ARN if not explicitly provided
    // e.g., 'arn:aws:kms:us-east-1:123:alias/my-key' -> 'my-key'
    // e.g., 'arn:aws:kms:us-east-1:123:key/abc-123'  -> 'key/abc-123'
    const arnLastSegment = keyArn.split(':').pop() ?? keyArn;
    this.kid =
      kid ?? (arnLastSegment.startsWith('alias/') ? arnLastSegment.slice(6) : arnLastSegment);

    this.kmsClient = new KMSClient({
      region,
      ...(credentials && { credentials }),
    });
  }

  /**
   * Sign a quote token payload via KMS and return the compact JWT.
   *
   * @param payload - Quote token claims to sign
   * @returns The compact JWS
   * @throws SigningError if the KMS call fails or returns no signature
   * @throws Error if the DER signature from KMS is malformed (not a
   *   SigningError: the KMS call succeeded, but its output is unusable)
   */
  async signQuote(payload: object): Promise<string> {
    const header = Buffer.from(
      JSON.stringify({ alg: this.jwtAlg, typ: 'JWT', kid: this.kid })
    ).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const message = Buffer.from(`${header}.${body}`);

    let signature: Uint8Array | undefined;
    try {
      ({ Signature: signature } = await this.kmsClient.send(
        new SignCommand({
          KeyId: this.keyArn,
          Message: message,
          MessageType: 'RAW',
          SigningAlgorithm: this.algorithm as SigningAlgorithmSpec,
        })
      ));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new SigningError(`KMS Sign API call failed: ${detail}`, undefined, { cause: error });
    }

    if (!signature?.length) {
      throw new SigningError('KMS Sign returned no signature');
    }

    const raw = derToRaw(signature, this.componentLength);
    return `${header}.${body}.${Buffer.from(raw).toString('base64url')}`;
  }

  /** The service URL (issuer) */
  getServiceUrl(): string {
    return this.serviceUrl;
  }
}

/**
 * Create a QuoteSigner backed by AWS KMS.
 *
 * @deprecated Use `new KmsQuoteSigner(config)`.
 * @param config - KMS signer configuration
 * @returns A {@link KmsQuoteSigner} whose methods are bound, with the former
 *   factory's `getPublicKey()`, which returns `{}`
 */
export function createKmsQuoteSigner(
  config: KmsQuoteSignerConfig
): KmsQuoteSigner & { getPublicKey(): Record<string, never> } {
  // Bound own methods, so the object can be destructured or spread as the
  // factory's former object literal could, and its getPublicKey().
  const signer = new KmsQuoteSigner(config);
  return Object.assign(signer, {
    signQuote: signer.signQuote.bind(signer),
    getServiceUrl: signer.getServiceUrl.bind(signer),
    getPublicKey: (): Record<string, never> => ({}),
  });
}

/** Read a DER length at `offset`: short form, or minimal long form. */
function readDerLength(der: Uint8Array, offset: number): { length: number; next: number } {
  const first = der[offset];
  if (first === undefined) throw new Error('truncated');
  if (first < 0x80) return { length: first, next: offset + 1 };
  const count = first & 0x7f;
  // More than 2 length bytes cannot occur here. BER's indefinite length (0x80,
  // no length bytes) reads as 0 and fails the minimal-form check below.
  if (count > 2 || offset + 1 + count > der.length) {
    throw new Error('invalid length');
  }
  let length = 0;
  for (let i = 0; i < count; i++) length = length * 256 + der[offset + 1 + i];
  // DER: the shortest form, so long form only for lengths of 128 or more,
  // without leading zero bytes.
  if (length < 0x80 || der[offset + 1] === 0) throw new Error('invalid length');
  return { length, next: offset + 1 + count };
}

/** Read a DER INTEGER at `offset` as a non-negative, minimally encoded big-endian value. */
function readDerUnsignedInteger(
  der: Uint8Array,
  offset: number,
  end: number,
  name: string
): { value: Uint8Array; next: number } {
  if (der[offset] !== 0x02) throw new Error(`${name} is not an INTEGER`);
  const { length, next } = readDerLength(der, offset + 1);
  if (length === 0 || next + length > end) throw new Error(`${name} is truncated`);
  const content = der.subarray(next, next + length);
  if (content[0] & 0x80) throw new Error(`${name} is negative`);
  if (content.length > 1 && content[0] === 0 && !(content[1] & 0x80)) {
    throw new Error(`${name} is not minimally encoded`);
  }
  return { value: content[0] === 0 ? content.subarray(1) : content, next: next + length };
}

/**
 * Convert a DER-encoded ECDSA signature to fixed-width raw `r||s` format.
 *
 * KMS returns signatures in DER (ASN.1) format, `SEQUENCE { INTEGER r,
 * INTEGER s }`. JWTs require raw concatenation: r (fixed-length) || s
 * (fixed-length). Parsed strictly: malformed DER, a negative or non-minimal
 * integer, trailing bytes, or an r or s wider than `componentLength` are
 * rejected.
 *
 * @internal
 * @throws Error on a malformed signature (a plain Error, not a SigningError)
 */
export function derToRaw(derSignature: Uint8Array, componentLength: number): Uint8Array {
  try {
    const der = derSignature;
    if (der[0] !== 0x30) throw new Error('not a SEQUENCE');
    const { length, next } = readDerLength(der, 1);
    if (next + length !== der.length) throw new Error('SEQUENCE length does not match');
    const r = readDerUnsignedInteger(der, next, der.length, 'r');
    const s = readDerUnsignedInteger(der, r.next, der.length, 's');
    if (s.next !== der.length) throw new Error('trailing data in SEQUENCE');

    const raw = new Uint8Array(componentLength * 2);
    for (const [index, { value }] of [r, s].entries()) {
      if (value.length > componentLength) {
        throw new Error(`${index === 0 ? 'r' : 's'} is wider than ${componentLength} bytes`);
      }
      raw.set(value, (index + 1) * componentLength - value.length);
    }
    return raw;
  } catch (error) {
    throw new Error(`Invalid DER ECDSA signature from KMS: ${(error as Error).message}`);
  }
}
