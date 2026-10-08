// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * DPoP Proof Creation
 *
 * Create DPoP proof JWTs and compute JWK thumbprints.
 */

import * as jose from 'jose';
import * as crypto from 'crypto';
import { DPoPKeyPair, DPoPProofPayload, DPoPProofOptions, DPoPError } from '../types';

/**
 * Compute JWK thumbprint (SHA-256 hash)
 *
 * @param jwk - Public key in JWK format
 * @returns Base64url-encoded thumbprint
 *
 * @example
 * ```typescript
 * const thumbprint = await computeJWKThumbprint(keyPair.publicKey);
 * ```
 */
export async function computeJWKThumbprint(jwk: jose.JWK): Promise<string> {
  try {
    return await jose.calculateJwkThumbprint(jwk, 'sha256');
  } catch (error) {
    throw new DPoPError('Failed to compute JWK thumbprint', { error });
  }
}

/**
 * Compute access token hash for DPoP binding
 *
 * @param accessToken - Access token to hash
 * @returns Base64url-encoded SHA-256 hash
 */
function computeAccessTokenHash(accessToken: string): string {
  const hash = crypto.createHash('sha256').update(accessToken).digest();
  return jose.base64url.encode(hash);
}

/**
 * Create a DPoP proof JWT
 *
 * @param keyPair - DPoP key pair
 * @param options - Proof options (method, url, accessToken, nonce)
 * @returns Signed DPoP proof JWT
 *
 * @example
 * ```typescript
 * const proof = await createDPoPProof(keyPair, {
 *   method: 'GET',
 *   url: 'https://api.example.com/resource',
 *   accessToken: 'payment-token-xyz',
 * });
 * ```
 */
export async function createDPoPProof(
  keyPair: DPoPKeyPair,
  options: DPoPProofOptions
): Promise<string> {
  try {
    // Validate inputs
    if (!options.method || !options.url) {
      throw new DPoPError('Method and URL are required for DPoP proof');
    }

    // Build payload
    const payload: DPoPProofPayload = {
      jti: crypto.randomUUID(),
      htm: options.method.toUpperCase(),
      htu: options.url,
      iat: Math.floor(Date.now() / 1000),
    };

    // Add access token hash if provided
    if (options.accessToken) {
      payload.ath = computeAccessTokenHash(options.accessToken);
    }

    // Add nonce if provided
    if (options.nonce) {
      (payload as any).nonce = options.nonce;
    }

    // Create JWT with jwk header
    const jwt = await new jose.SignJWT(payload)
      .setProtectedHeader({
        alg: keyPair.publicKey.alg || 'ES256',
        typ: 'dpop+jwt',
        jwk: keyPair.publicKey,
      })
      .sign(keyPair.privateKey);

    return jwt;
  } catch (error) {
    if (error instanceof DPoPError) throw error;
    throw new DPoPError('Failed to create DPoP proof', { error });
  }
}
