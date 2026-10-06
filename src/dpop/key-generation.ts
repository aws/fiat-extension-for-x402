// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * DPoP Key Generation
 * 
 * Generate ephemeral key pairs for DPoP proof-of-possession.
 */

import * as jose from 'jose';
import { DPoPKeyPair, DPoPError } from '../types';

/**
 * Supported DPoP algorithms
 * Agent Pay only supports EC keys for DPoP (P-256, P-384, P-521)
 */
export type DPoPAlgorithm = 'ES256' | 'ES384' | 'ES512' | 'RS256';

/**
 * Generate a DPoP key pair
 * 
 * For Agent Pay integration, use EC algorithms (ES256, ES384, ES512).
 * RS256 is supported for backward compatibility but not recommended for DPoP.
 * 
 * @param algorithm - Algorithm to use (ES256 for P-256, ES384 for P-384, ES512 for P-521, RS256 for RSA)
 * @returns Key pair with private key and public JWK
 * 
 * @example
 * ```typescript
 * const keyPair = await generateDPoPKeyPair('ES256');
 * ```
 */
export async function generateDPoPKeyPair(
  algorithm: DPoPAlgorithm = 'ES256'
): Promise<DPoPKeyPair> {
  try {
    let privateKey: jose.KeyLike;
    let publicKey: jose.JWK;

    if (algorithm === 'ES256') {
      const { privateKey: privKey, publicKey: pubKey } = await jose.generateKeyPair('ES256');
      privateKey = privKey;
      publicKey = await jose.exportJWK(pubKey);
      publicKey.alg = 'ES256';
      publicKey.use = 'sig';
    } else if (algorithm === 'ES384') {
      const { privateKey: privKey, publicKey: pubKey } = await jose.generateKeyPair('ES384');
      privateKey = privKey;
      publicKey = await jose.exportJWK(pubKey);
      publicKey.alg = 'ES384';
      publicKey.use = 'sig';
    } else if (algorithm === 'ES512') {
      const { privateKey: privKey, publicKey: pubKey } = await jose.generateKeyPair('ES512');
      privateKey = privKey;
      publicKey = await jose.exportJWK(pubKey);
      publicKey.alg = 'ES512';
      publicKey.use = 'sig';
    } else if (algorithm === 'RS256') {
      const { privateKey: privKey, publicKey: pubKey } = await jose.generateKeyPair('RS256', {
        modulusLength: 2048,
      });
      privateKey = privKey;
      publicKey = await jose.exportJWK(pubKey);
      publicKey.alg = 'RS256';
      publicKey.use = 'sig';
    } else {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- reached only for an unsupported runtime value
      throw new DPoPError(`Unsupported algorithm: ${algorithm}`, { algorithm });
    }

    return {
      privateKey,
      publicKey,
    };
  } catch (error) {
    if (error instanceof DPoPError) throw error;
    throw new DPoPError('Failed to generate DPoP key pair', { error });
  }
}

/**
 * Convert a DPoP key pair's public key to the DpopJwk format expected by Agent Pay.
 * Agent Pay only accepts EC keys (P-256, P-384, P-521) with kty, crv, x, y fields.
 * 
 * @param keyPair - DPoP key pair from generateDPoPKeyPair
 * @returns DpopJwk suitable for CreateAgentPayment request
 * @throws DPoPError if the key is not an EC key
 */
export function toDpopJwk(keyPair: DPoPKeyPair): import('../config').DpopJwk {
  const jwk = keyPair.publicKey;
  if (jwk.kty !== 'EC') {
    throw new DPoPError('Agent Pay only supports EC keys for DPoP binding. Use ES256, ES384, or ES512.', {
      kty: jwk.kty,
    });
  }
  if (!jwk.crv || !jwk.x || !jwk.y) {
    throw new DPoPError('Invalid EC key: missing crv, x, or y', { jwk });
  }
  return {
    kty: 'EC',
    crv: jwk.crv as 'P-256' | 'P-384' | 'P-521',
    x: jwk.x,
    y: jwk.y,
  };
}
