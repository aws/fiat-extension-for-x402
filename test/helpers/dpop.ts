// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Test-only DPoP helpers
 * Build the buyer-side key pairs and proofs that the seller-side verifier checks.
 */

import * as jose from 'jose';
import * as crypto from 'crypto';

export type DPoPAlgorithm = 'ES256' | 'ES384' | 'ES512' | 'RS256';

export interface DPoPKeyPair {
  privateKey: jose.KeyLike;
  publicKey: jose.JWK;
}

export interface DPoPProofOptions {
  method: string;
  url: string;
  accessToken?: string;
  nonce?: string;
}

/**
 * Generate a DPoP key pair whose public JWK carries `alg` and `use`.
 */
export async function generateDPoPKeyPair(
  algorithm: DPoPAlgorithm = 'ES256'
): Promise<DPoPKeyPair> {
  const { privateKey, publicKey } = await jose.generateKeyPair(
    algorithm,
    algorithm === 'RS256' ? { modulusLength: 2048 } : undefined
  );
  const jwk = await jose.exportJWK(publicKey);
  jwk.alg = algorithm;
  jwk.use = 'sig';
  return { privateKey, publicKey: jwk };
}

/**
 * Create a signed DPoP proof JWT (typ dpop+jwt, public JWK in the header).
 */
export async function createDPoPProof(
  keyPair: DPoPKeyPair,
  options: DPoPProofOptions
): Promise<string> {
  const payload: Record<string, unknown> = {
    jti: crypto.randomUUID(),
    htm: options.method.toUpperCase(),
    htu: options.url,
    iat: Math.floor(Date.now() / 1000),
  };
  if (options.accessToken) {
    payload.ath = jose.base64url.encode(
      crypto.createHash('sha256').update(options.accessToken).digest()
    );
  }
  if (options.nonce) {
    payload.nonce = options.nonce;
  }
  return new jose.SignJWT(payload)
    .setProtectedHeader({
      alg: keyPair.publicKey.alg || 'ES256',
      typ: 'dpop+jwt',
      jwk: keyPair.publicKey,
    })
    .sign(keyPair.privateKey);
}
