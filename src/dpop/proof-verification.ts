// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * DPoP Proof Verification
 * 
 * Verify DPoP proof JWTs with security checks.
 */

import * as jose from 'jose';
import * as crypto from 'crypto';
import {
  DPoPProofPayload,
  DPoPVerificationOptions,
  DPoPError
} from '../types';

/**
 * Compute access token hash for verification
 */
function computeAccessTokenHash(accessToken: string): string {
  const hash = crypto.createHash('sha256').update(accessToken).digest();
  return jose.base64url.encode(hash);
}

/**
 * Verify a DPoP proof JWT
 * 
 * Performs comprehensive security checks:
 * - Signature verification using embedded JWK
 * - Freshness check (iat within maxAge seconds)
 * - HTTP method and URL binding
 * - Access token hash verification (if provided)
 * - Replay protection via nonce store (if provided)
 * 
 * @param proof - DPoP proof JWT
 * @param options - Verification options
 * @returns Verified DPoP proof payload
 * @throws {DPoPError} If verification fails
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
  try {
    // Decode header to get JWK
    const header = jose.decodeProtectedHeader(proof);
    
    // Validate header
    if (header.typ !== 'dpop+jwt') {
      throw new DPoPError('Invalid DPoP proof type', { typ: header.typ });
    }

    if (!header.jwk) {
      throw new DPoPError('Missing JWK in DPoP proof header');
    }

    // Import public key from JWK
    const publicKey = await jose.importJWK(header.jwk, header.alg);

    // Verify signature
    const { payload } = await jose.jwtVerify(proof, publicKey, {
      typ: 'dpop+jwt',
    });

    const dpopPayload = payload as unknown as DPoPProofPayload;

    // Validate required claims
    if (!dpopPayload.jti || !dpopPayload.htm || !dpopPayload.htu || !dpopPayload.iat) {
      throw new DPoPError('Missing required DPoP claims', { payload: dpopPayload });
    }

    // Check freshness
    const maxAge = options.maxAge ?? 60; // Default 60 seconds
    const now = Math.floor(Date.now() / 1000);
    const age = now - dpopPayload.iat;
    
    if (age > maxAge) {
      throw new DPoPError('DPoP proof is stale', {
        iat: dpopPayload.iat,
        now,
        age,
        maxAge,
      });
    }

    if (age < -5) {
      // Allow 5 seconds clock skew
      throw new DPoPError('DPoP proof is from the future', {
        iat: dpopPayload.iat,
        now,
      });
    }

    // Verify HTTP method binding
    if (dpopPayload.htm !== options.method.toUpperCase()) {
      throw new DPoPError('DPoP proof HTTP method mismatch', {
        expected: options.method.toUpperCase(),
        actual: dpopPayload.htm,
      });
    }

    // Verify HTTP URL binding
    if (dpopPayload.htu !== options.url) {
      throw new DPoPError('DPoP proof HTTP URL mismatch', {
        expected: options.url,
        actual: dpopPayload.htu,
      });
    }

    // Verify access token hash if provided
    if (options.accessToken) {
      const expectedHash = computeAccessTokenHash(options.accessToken);
      if (dpopPayload.ath !== expectedHash) {
        throw new DPoPError('DPoP proof access token hash mismatch', {
          expected: expectedHash,
          actual: dpopPayload.ath,
        });
      }
    }

    // Check replay protection if nonce store provided
    if (options.nonceStore) {
      const used = await options.nonceStore.has(dpopPayload.jti);
      if (used) {
        throw new DPoPError('DPoP proof replay detected', {
          jti: dpopPayload.jti,
        });
      }

      // Add to nonce store with expiry
      const expiresAt = dpopPayload.iat + maxAge;
      await options.nonceStore.add(dpopPayload.jti, expiresAt);
    }

    return dpopPayload;
  } catch (error) {
    if (error instanceof DPoPError) throw error;
    throw new DPoPError('DPoP proof verification failed', { error });
  }
}

/**
 * Extract JWK thumbprint from DPoP proof
 * 
 * @param proof - DPoP proof JWT
 * @returns JWK thumbprint (jkt)
 */
export async function extractDPoPThumbprint(proof: string): Promise<string> {
  try {
    const header = jose.decodeProtectedHeader(proof);
    
    if (!header.jwk) {
      throw new DPoPError('Missing JWK in DPoP proof header');
    }

    return await jose.calculateJwkThumbprint(header.jwk, 'sha256');
  } catch (error) {
    if (error instanceof DPoPError) throw error;
    throw new DPoPError('Failed to extract DPoP thumbprint', { error });
  }
}
