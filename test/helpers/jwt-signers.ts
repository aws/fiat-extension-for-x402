// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Test-only quote signer for a jose key pair. The package's own quote
 * signers are LocalQuoteSigner and KmsQuoteSigner.
 */

import * as jose from 'jose';
import { ALLOWED_ALGORITHMS } from '../../src/security';
import {
  EC_CURVE_ALGORITHMS,
  describePrivateKey,
  privateJwkMembers,
  privateKeyObject,
  type QuoteSigner,
} from '../../src/signers/protocol';
import { ValidationError, type QuoteTokenPayload } from '../../src/types';

/** Refuse a public JWK that carries private key material. */
function assertPublicJwk(publicKey: jose.JWK): void {
  const leaked =
    typeof publicKey === 'object' && publicKey !== null ? privateJwkMembers(publicKey) : '';
  if (leaked) {
    throw new ValidationError(
      `publicKey contains private key members: ${leaked}. Pass only the public key.`
    );
  }
}

/** The alg of a public JWK: ES* by curve, RS256 for RSA. */
function algorithmOfJwk(jwk: jose.JWK): string | undefined {
  if (jwk.kty === 'EC') return EC_CURVE_ALGORITHMS[String(jwk.crv)];
  if (jwk.kty === 'RSA') return 'RS256';
  return undefined;
}

/** The alg of a Node.js KeyObject or a WebCrypto CryptoKey: ES* by curve, RS256 for RSA. */
function algorithmOfPrivateKey(key: jose.KeyLike): string | undefined {
  const keyObject = privateKeyObject(key);
  return keyObject && describePrivateKey(keyObject)?.alg;
}

/**
 * The JWS alg a key pair signs with: the public JWK's `alg` when set, else the
 * alg its key type and curve imply (P-256 ES256, P-384 ES384, P-521 ES512, RSA
 * RS256), read from the public JWK or, when it is not a JWK, the private key.
 *
 * @throws ValidationError if the alg is unknown or not in ALLOWED_ALGORITHMS
 */
function signingAlgorithm(privateKey: jose.KeyLike, publicKey: jose.JWK): string {
  const alg =
    publicKey?.alg ??
    (publicKey?.kty ? algorithmOfJwk(publicKey) : algorithmOfPrivateKey(privateKey));
  if (!alg || !ALLOWED_ALGORITHMS.includes(alg)) {
    throw new ValidationError(
      `Unsupported signing key: alg ${alg ?? 'unknown'} is not one of ${ALLOWED_ALGORITHMS.join(', ')}`
    );
  }
  return alg;
}

/**
 * The JWS header: the alg, and the public JWK's `kid` when it has one, so
 * verifiers can pick the key from a JWKS that holds several (key rotation).
 */
function protectedHeader(alg: string, publicKey: jose.JWK): jose.JWTHeaderParameters {
  return typeof publicKey.kid === 'string' && publicKey.kid
    ? { alg, typ: 'JWT', kid: publicKey.kid }
    : { alg, typ: 'JWT' };
}

/**
 * Convert a jose KeyLike to a QuoteSigner
 *
 * Tokens are signed with the key's own alg: the public JWK's `alg` when set,
 * else ES256, ES384 or ES512 for a P-256, P-384 or P-521 key and RS256 for RSA.
 *
 * @param privateKey - Private key for signing (RS256, ES256, ES384 or ES512)
 * @param publicKey - Public key in JWK format
 * @param serviceUrl - Service URL (issuer)
 * @returns QuoteSigner instance, with `getPublicKey()` returning `publicKey`
 * @throws ValidationError if `publicKey` carries private key members, or the
 *   key's alg is not one of ALLOWED_ALGORITHMS
 *
 * @example
 * ```typescript
 * import { generateKeyPair, exportJWK } from 'jose';
 *
 * const { privateKey, publicKey } = await generateKeyPair('RS256');
 * const publicJWK = await exportJWK(publicKey);
 *
 * const signer = toQuoteSigner(
 *   privateKey,
 *   publicJWK,
 *   'https://api.service.com'
 * );
 * ```
 */
export function toQuoteSigner(
  privateKey: jose.KeyLike,
  publicKey: jose.JWK,
  serviceUrl: string
): QuoteSigner & { getPublicKey(): jose.JWK } {
  assertPublicJwk(publicKey);
  const header = protectedHeader(signingAlgorithm(privateKey, publicKey), publicKey);
  return {
    async signQuote(payload: QuoteTokenPayload): Promise<string> {
      return await new jose.SignJWT(payload as unknown as jose.JWTPayload)
        .setProtectedHeader(header)
        .sign(privateKey);
    },
    getPublicKey(): jose.JWK {
      return publicKey;
    },
    getServiceUrl(): string {
      return serviceUrl;
    },
  };
}
