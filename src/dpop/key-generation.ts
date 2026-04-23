/**
 * DPoP Key Generation
 * 
 * Generate ephemeral key pairs for DPoP proof-of-possession.
 */

import * as jose from 'jose';
import { DPoPKeyPair, DPoPError } from '../types';

/**
 * Supported DPoP algorithms
 */
export type DPoPAlgorithm = 'ES256' | 'RS256';

/**
 * Generate a DPoP key pair
 * 
 * @param algorithm - Algorithm to use (ES256 for EC P-256, RS256 for RSA 2048)
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
      // Generate EC P-256 key pair
      const { privateKey: privKey, publicKey: pubKey } = await jose.generateKeyPair('ES256');
      privateKey = privKey;
      publicKey = await jose.exportJWK(pubKey);
      publicKey.alg = 'ES256';
      publicKey.use = 'sig';
    } else if (algorithm === 'RS256') {
      // Generate RSA 2048 key pair
      const { privateKey: privKey, publicKey: pubKey } = await jose.generateKeyPair('RS256', {
        modulusLength: 2048,
      });
      privateKey = privKey;
      publicKey = await jose.exportJWK(pubKey);
      publicKey.alg = 'RS256';
      publicKey.use = 'sig';
    } else {
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
