// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Where the verifier finds the seller's quote-signing public key.
 *
 * Follows the Python SDK's `fiat_extension_x402/agentic_commerce/keys.py`
 * (commit 62230e6). The key is always configured by the seller; it is never
 * discovered from the quote token itself.
 */

import { createPublicKey } from 'node:crypto';
import type { GetPublicKeyCommand, GetPublicKeyCommandOutput } from '@aws-sdk/client-kms';
import type { JWK } from 'jose';
import { ALLOWED_ALGORITHMS } from '../security';
import { MIN_RSA_KEY_BITS } from '../signers/local';
import { privateJwkMembers } from '../signers/protocol';
import { ValidationError } from '../types';
import { stripPythonWhitespace } from '../utils';
import { base64urlDecode, bigIntOf, isPlainObject, pyRepr } from './python';

// JWS algorithm required for each supported EC curve, and its coordinate size.
const EC_CURVE_ALGORITHMS: Record<string, string> = {
  'P-256': 'ES256',
  'P-384': 'ES384',
  'P-521': 'ES512',
};
const EC_COORDINATE_BYTES: Record<string, number> = { 'P-256': 32, 'P-384': 48, 'P-521': 66 };

/** Credentials for the KMS `GetPublicKey` call */
export interface KmsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/** The part of a KMS client the verifier uses */
export interface KmsPublicKeyClient {
  send(command: GetPublicKeyCommand): Promise<Pick<GetPublicKeyCommandOutput, 'PublicKey'>>;
}

/** Resolve the seller's public key from KMS with `kms:GetPublicKey`. */
export interface KmsSellerKeyResolver {
  type: 'kms';
  /** ARN of the seller's signing key */
  kmsKeyArn: string;
  /** Region hosting the key */
  region: string;
  /** Credentials for the KMS call. Omit to use the default AWS credential chain. */
  credentials?: () => Promise<KmsCredentials>;
  /** A pre-configured KMS client, used instead of creating one (useful for testing). */
  kmsClient?: KmsPublicKeyClient;
}

/** Resolve the seller's public key from the seller's own JWKS. */
export interface JwksSellerKeyResolver {
  type: 'jwks';
  /** Base URL. `/.well-known/jwks.json` is appended. */
  jwksUrl: string;
}

/** Use a public key the seller already holds. */
export interface StaticSellerKeyResolver {
  type: 'static';
  /** The seller's public key as a JWK */
  publicJwk: JWK;
}

/**
 * Strategy for locating the seller's quote-signing key. The key is always
 * configured by the seller, never discovered from the quote token itself.
 */
export type SellerKeyResolver =
  KmsSellerKeyResolver | JwksSellerKeyResolver | StaticSellerKeyResolver;

/**
 * Build the JWKS a seller serves at `/.well-known/jwks.json`.
 *
 * Pass the current key and, during a rotation, the previous one, so quotes
 * signed with either still verify. Each key needs a unique `kid`: verifiers
 * select the key by the `kid` in the quote token's header.
 *
 * Follows the Python SDK's `jwks_document` (agentic_commerce/keys.py:63-124
 * at 62230e6), with the same rules and messages.
 *
 * @param publicJwks - Public keys as JWKs, for example
 *   {@link LocalQuoteSigner.publicJwk}
 * @returns `{ keys: [...] }`, ready to serialize as JSON. Each key is a copy.
 * @throws ValidationError if no key is given, a `kid` is missing or repeats,
 *   or a key is not a valid public key that verifiers accept: EC on
 *   P-256/P-384/P-521 or RSA of at least 2048 bits, with an allowed `alg` that
 *   matches the key and no private key material
 *
 * @example
 * ```typescript
 * const jwks = jwksDocument(signer.publicJwk); // once, at startup
 * app.get('/.well-known/jwks.json', (_req, res) => res.json(jwks));
 * ```
 */
export function jwksDocument(...publicJwks: JWK[]): { keys: JWK[] } {
  if (publicJwks.length === 0) {
    throw new ValidationError('At least one public key is required');
  }
  const keys: JWK[] = [];
  const seen = new Set<string>();
  for (const jwk of publicJwks) {
    // Not a Python SDK message: Python fails with an AttributeError.
    if (!isPlainObject(jwk)) {
      throw new ValidationError('Every JWK must be an object');
    }
    const kid: unknown = jwk.kid;
    if (typeof kid !== 'string' || !stripPythonWhitespace(kid)) {
      throw new ValidationError("Every JWK needs a non-empty string 'kid'");
    }
    if (seen.has(kid)) {
      throw new ValidationError(`Duplicate kid: ${kid}`);
    }
    validatePublicJwk(jwk, kid);
    seen.add(kid);
    keys.push({ ...jwk });
  }
  return { keys };
}

/** Check a JWK is a public signing key that verifiers accept (keys.py:95-124). */
function validatePublicJwk(jwk: Record<string, unknown>, kid: string): void {
  const leaked = privateJwkMembers(jwk);
  if (leaked) {
    throw new ValidationError(`JWK ${kid}: contains private key members ${leaked}`);
  }
  const kty = jwk.kty;
  let expectedAlg: string | undefined;
  if (kty === 'EC') {
    const crv = jwk.crv;
    expectedAlg =
      typeof crv === 'string' && Object.hasOwn(EC_CURVE_ALGORITHMS, crv)
        ? EC_CURVE_ALGORITHMS[crv]
        : undefined;
    if (expectedAlg === undefined) {
      throw new ValidationError(`JWK ${kid}: unsupported EC curve ${pyRepr(crv)}`);
    }
  } else if (kty === 'RSA') {
    expectedAlg = 'RS256';
  } else {
    throw new ValidationError(`JWK ${kid}: kty must be 'EC' or 'RSA', got ${pyRepr(kty)}`);
  }
  const alg = jwk.alg === undefined ? expectedAlg : jwk.alg;
  if (typeof alg !== 'string' || !ALLOWED_ALGORITHMS.includes(alg) || alg !== expectedAlg) {
    throw new ValidationError(
      `JWK ${kid}: alg ${pyRepr(alg)} does not match the key (use ${expectedAlg})`
    );
  }
  if ((jwk.use === undefined ? 'sig' : jwk.use) !== 'sig') {
    throw new ValidationError(`JWK ${kid}: use must be 'sig', got ${pyRepr(jwk.use)}`);
  }
  let rsaBits = 0;
  try {
    if (kty === 'EC') parseEcKey(jwk);
    else rsaBits = parseRsaKey(jwk);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ValidationError(`JWK ${kid}: invalid key material: ${message}`);
  }
  if (kty === 'RSA' && rsaBits < MIN_RSA_KEY_BITS) {
    throw new ValidationError(
      `JWK ${kid}: RSA keys must be at least ${MIN_RSA_KEY_BITS} bits, got ${rsaBits}`
    );
  }
}

type JsonWebKeyInput = Extract<Parameters<typeof createPublicKey>[0], { format: 'jwk' }>;

/** base64urlDecode inside PyJWK: a ValueError becomes "Unable to construct key from JWK". */
function decodeJwkMember(value: unknown): Buffer {
  try {
    return base64urlDecode(value);
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new Error(`Unable to construct key from JWK: ${(error as Error).message}`);
  }
}

function constructKey(jwk: JsonWebKeyInput['key']): void {
  try {
    createPublicKey({ key: jwk, format: 'jwk' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to construct key from JWK: ${message}`);
  }
}

/** PyJWT's `ECAlgorithm.from_jwk` on a public JWK: coordinate sizes, then the point is on the curve. */
function parseEcKey(jwk: Record<string, unknown>): void {
  if (!Object.hasOwn(jwk, 'x') || !Object.hasOwn(jwk, 'y')) {
    throw new Error('Not an Elliptic curve key');
  }
  const x = decodeJwkMember(jwk.x);
  const y = decodeJwkMember(jwk.y);
  const crv = jwk.crv as string;
  const size = EC_COORDINATE_BYTES[crv];
  if (x.length !== size || y.length !== size) {
    throw new Error(`Coords should be ${size} bytes for curve ${crv}`);
  }
  try {
    createPublicKey({
      key: { kty: 'EC', crv, x: x.toString('base64url'), y: y.toString('base64url') },
      format: 'jwk',
    });
  } catch {
    // The coordinates have the curve's size, so the point is not on the curve.
    throw new Error(
      'Unable to construct key from JWK: Invalid EC key. Point is not on the curve specified.'
    );
  }
}

/**
 * PyJWT's `RSAAlgorithm.from_jwk` on a public JWK, with `cryptography`'s
 * checks of the public numbers.
 *
 * @returns The modulus length in bits
 */
function parseRsaKey(jwk: Record<string, unknown>): number {
  if (!Object.hasOwn(jwk, 'n') || !Object.hasOwn(jwk, 'e')) {
    throw new Error('Not a public or private key');
  }
  // PyJWT builds RSAPublicNumbers(e, n), so e is decoded first.
  const eBytes = decodeJwkMember(jwk.e);
  const nBytes = decodeJwkMember(jwk.n);
  const e = bigIntOf(eBytes);
  const n = bigIntOf(nBytes);
  if (n < 3n) throw new Error('Unable to construct key from JWK: n must be >= 3.');
  if (e < 3n || e >= n)
    throw new Error('Unable to construct key from JWK: e must be >= 3 and < n.');
  if ((e & 1n) === 0n) throw new Error('Unable to construct key from JWK: e must be odd.');
  const bits = n.toString(2).length;
  constructKey({ kty: 'RSA', n: nBytes.toString('base64url'), e: eBytes.toString('base64url') });
  return bits;
}
