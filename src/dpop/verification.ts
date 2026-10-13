// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * DPoP proof JWT verification per RFC 9449.
 */

import * as crypto from 'crypto';
import { compactVerify, decodeProtectedHeader, type JWK } from 'jose';
import { isPlainObject, isTruthy, toInteger, displayText } from '../agentic-commerce/json-value';
import {
  JwtError,
  importJwk,
  parseClaims,
  validateRegisteredClaims,
} from '../agentic-commerce/verifier';
import { DPoPProofPayload, DPoPVerificationOptions, DPoPError } from '../types';

/** Default maximum age (seconds) for DPoP proofs. */
const DEFAULT_MAX_AGE = 60;

/** Clock skew tolerance (seconds). */
const CLOCK_SKEW = 5;

/** DPoP proofs must be signed with an asymmetric key (RFC 9449 section 4.2). */
const ALLOWED_DPOP_ALGORITHMS: readonly string[] = ['ES256', 'ES384', 'ES512', 'RS256', 'PS256'];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The protected header of a compact JWS, read without verifying it. */
function unverifiedHeader(proof: unknown): Record<string, unknown> {
  if (typeof proof !== 'string' || proof.split('.').length < 3) {
    throw new JwtError('Not enough segments');
  }
  let header: Record<string, unknown>;
  try {
    header = decodeProtectedHeader(proof);
  } catch (error) {
    throw new JwtError(errorMessage(error));
  }
  if (Object.hasOwn(header, 'kid') && typeof header.kid !== 'string') {
    throw new JwtError('Key ID header parameter must be a string');
  }
  return header;
}

/** Compact JSON with object members sorted by name, and every non-ASCII character escaped. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (isPlainObject(value)) {
    const members = Object.keys(value)
      .sort()
      .map((key) => `${canonicalJson(key)}:${canonicalJson(value[key])}`);
    return `{${members.join(',')}}`;
  }
  // Every non-ASCII code unit is written as \uXXXX.
  const json = JSON.stringify(value) ?? 'null';
  let ascii = '';
  for (let i = 0; i < json.length; i++) {
    const code = json.charCodeAt(i);
    ascii += code < 0x80 ? json[i] : `\\u${code.toString(16).padStart(4, '0')}`;
  }
  return ascii;
}

function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}

/** base64url without padding of SHA-256 over `data` */
function sha256Base64url(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('base64url');
}

/**
 * Compute the RFC 7638 SHA-256 thumbprint of a public JWK (`EC` or `RSA`).
 *
 * The thumbprint input is the required members that are present, sorted, as
 * compact JSON.
 *
 * @param jwk - Public key in JWK format
 * @returns Base64url-encoded (no padding) SHA-256 thumbprint
 * @throws {DPoPError} If the key type is unsupported
 *
 * @example
 * ```typescript
 * const thumbprint = await computeJWKThumbprint(publicJwk);
 * ```
 */
export async function computeJWKThumbprint(jwk: JWK): Promise<string> {
  const members: Record<string, unknown> = isPlainObject(jwk) ? jwk : {};
  const kty = members.kty ?? '';
  let required: string[];
  if (kty === 'EC') {
    required = ['crv', 'kty', 'x', 'y'];
  } else if (kty === 'RSA') {
    required = ['e', 'kty', 'n'];
  } else {
    throw new DPoPError(`Unsupported key type in DPoP proof: ${displayText(kty)}`);
  }
  const canonical: Record<string, unknown> = {};
  for (const name of required) {
    if (Object.hasOwn(members, name)) canonical[name] = members[name];
  }
  return Promise.resolve(sha256Base64url(canonicalJson(canonical)));
}

/**
 * Verify a DPoP proof JWT and return its claims.
 *
 * Verification steps, in this order:
 * 1. Decode the header and check `typ` is `dpop+jwt` (case-insensitive).
 * 2. Take the `jwk` from the header, check `alg` is an allowed asymmetric
 *    algorithm, and verify the signature.
 * 3. Check freshness (`iat` within `maxAge` + 5 seconds of clock skew).
 * 4. Verify the HTTP method (`htm`) and URL (`htu`) binding: exact matches.
 * 5. Verify `ath` (access token hash) if `accessToken` is provided.
 * 6. Check replay via `nonceStore` if provided.
 *
 * @param proof - DPoP proof JWT
 * @param options - Verification options
 * @returns Verified DPoP proof payload
 * @throws {DPoPError} If verification fails. Errors thrown by `nonceStore` are
 *   passed through.
 *
 * @example
 * ```typescript
 * const payload = await verifyDPoPProof(proofJWT, {
 *   method: 'GET',
 *   url: 'https://api.example.com/resource',
 *   accessToken: 'payment-token-xyz',
 *   maxAge: 60,
 *   nonceStore: myNonceStore,
 * });
 * ```
 */
export async function verifyDPoPProof(
  proof: string,
  options: DPoPVerificationOptions
): Promise<DPoPProofPayload> {
  let header: Record<string, unknown>;
  try {
    header = unverifiedHeader(proof);
  } catch (error) {
    throw new DPoPError('Invalid DPoP proof: cannot decode header', {
      error: errorMessage(error),
    });
  }

  // 1. Check typ
  const typ = header.typ ?? '';
  if (typeof typ !== 'string' || typ.toLowerCase() !== 'dpop+jwt') {
    throw new DPoPError(`Invalid DPoP proof type: expected 'dpop+jwt', got '${displayText(typ)}'`);
  }

  // 2. Extract JWK and verify signature
  const jwk = header.jwk;
  if (!isTruthy(jwk)) {
    throw new DPoPError("DPoP proof header missing 'jwk'");
  }

  const alg = header.alg;
  if (!isTruthy(alg)) {
    throw new DPoPError("DPoP proof header missing 'alg'");
  }
  if (typeof alg !== 'string' || !ALLOWED_DPOP_ALGORITHMS.includes(alg)) {
    throw new DPoPError(`DPoP proof algorithm not allowed: ${displayText(alg)}`);
  }

  let claims: Record<string, unknown>;
  try {
    const key = importJwk(isPlainObject(jwk) ? { ...jwk, alg } : jwk);
    let payload: Uint8Array;
    try {
      ({ payload } = await compactVerify(proof, key, { algorithms: [alg] }));
    } catch (error) {
      const signatureFailed =
        (error as { code?: unknown }).code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED';
      throw new JwtError(signatureFailed ? 'Signature verification failed' : errorMessage(error));
    }
    claims = parseClaims(payload);
    // The generic iat check is off, so the clock-skew-tolerant freshness check
    // below is authoritative.
    validateRegisteredClaims(claims, { verifyIat: false });
  } catch (error) {
    throw new DPoPError(`DPoP proof signature verification failed: ${errorMessage(error)}`);
  }

  // Validate required claims are present.
  if (!['jti', 'htm', 'htu', 'iat'].every((name) => isTruthy(claims[name]))) {
    throw new DPoPError('Missing required DPoP claims');
  }

  // 3. Check freshness
  const maxAge = options.maxAge ?? DEFAULT_MAX_AGE;
  const iat = toInteger(claims.iat);
  if (iat === undefined) {
    // An iat that is not an integer makes the proof invalid.
    throw new DPoPError(`Invalid DPoP proof iat: ${displayText(claims.iat)}`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (iat > now + CLOCK_SKEW) {
    throw new DPoPError('DPoP proof issued in the future');
  }
  if (now - iat > maxAge + CLOCK_SKEW) {
    throw new DPoPError('DPoP proof expired');
  }

  // 4. Verify HTTP method and URL binding
  const expectedHtm = options.method;
  if (expectedHtm && claims.htm !== expectedHtm) {
    throw new DPoPError(
      `DPoP proof htm mismatch: expected '${expectedHtm}', got '${displayText(claims.htm)}'`
    );
  }

  const expectedHtu = options.url;
  if (expectedHtu && claims.htu !== expectedHtu) {
    throw new DPoPError(
      `DPoP proof htu mismatch: expected '${expectedHtu}', got '${displayText(claims.htu)}'`
    );
  }

  // 5. Verify access token hash
  const accessToken = options.accessToken;
  if (accessToken) {
    // The hash is over the token's ASCII bytes; a token with any other character
    // cannot match.
    if (!isAscii(accessToken) || claims.ath !== sha256Base64url(accessToken)) {
      throw new DPoPError('DPoP proof access token hash (ath) mismatch');
    }
  }

  // 6. Replay prevention via nonce store, keyed on the unique proof id (jti).
  const nonceStore = options.nonceStore;
  if (nonceStore != null) {
    const jti = claims.jti as string;
    // With a synchronous store, has() and add() run with no await between them,
    // so concurrent requests with the same proof cannot both pass. With an
    // asynchronous store the pair is not atomic.
    const seen = nonceStore.has(jti);
    if (isTruthy(seen instanceof Promise ? await seen : seen)) {
      throw new DPoPError('DPoP proof replay detected', { jti });
    }
    await nonceStore.add(jti, iat + maxAge);
  }

  return claims as DPoPProofPayload;
}

/**
 * Extract the JWK thumbprint (jkt) from a DPoP proof JWT: the RFC 7638 SHA-256
 * thumbprint of the public key in the proof header. The proof is not verified.
 *
 * @param proof - DPoP proof JWT
 * @returns Base64url-encoded (no padding) SHA-256 thumbprint
 * @throws {DPoPError} If the header cannot be decoded or has no supported `jwk`
 */
export async function extractDPoPThumbprint(proof: string): Promise<string> {
  let header: Record<string, unknown>;
  try {
    header = unverifiedHeader(proof);
  } catch (error) {
    throw new DPoPError('Cannot extract thumbprint: invalid DPoP proof', {
      error: errorMessage(error),
    });
  }

  const jwk = header.jwk;
  if (!isTruthy(jwk)) {
    throw new DPoPError("DPoP proof header missing 'jwk'");
  }

  return computeJWKThumbprint(jwk as JWK);
}
