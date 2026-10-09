// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Signer interfaces and adapters for Agentic Commerce JWT operations
 *
 * Agentic Commerce uses JWT signing instead of crypto Agentic Commerce signing.
 * This module provides interfaces and adapter functions for both
 * service-side (quote token signing) and Agentic Commerce-side (payment token signing).
 */

import type { KeyObject } from 'node:crypto';
import * as jose from 'jose';
import { ALLOWED_ALGORITHMS } from '../security';
import { QuoteTokenPayload, PaymentTokenPayload, ValidationError } from '../types';

// The JWS alg of each EC curve, by JWK `crv` and by Node.js / WebCrypto curve name.
const EC_CURVE_ALGORITHMS: Record<string, string> = {
  'P-256': 'ES256',
  'P-384': 'ES384',
  'P-521': 'ES512',
  prime256v1: 'ES256',
  secp384r1: 'ES384',
  secp521r1: 'ES512',
};

/** The alg of a public JWK: ES* by curve, RS256 for RSA. */
function algorithmOfJwk(jwk: jose.JWK): string | undefined {
  if (jwk.kty === 'EC') return EC_CURVE_ALGORITHMS[String(jwk.crv)];
  if (jwk.kty === 'RSA') return 'RS256';
  return undefined;
}

/** The alg of a Node.js KeyObject or a WebCrypto CryptoKey: ES* by curve, RS256 for RSA. */
function algorithmOfPrivateKey(key: jose.KeyLike): string | undefined {
  if (typeof key !== 'object' || key === null) return undefined;
  const keyObject = key as Partial<KeyObject>;
  if (keyObject.asymmetricKeyType === 'ec') {
    return EC_CURVE_ALGORITHMS[String(keyObject.asymmetricKeyDetails?.namedCurve)];
  }
  if (keyObject.asymmetricKeyType === 'rsa') return 'RS256';
  // A WebCrypto CryptoKey
  const { algorithm } = key as { algorithm?: { name?: string; namedCurve?: string } };
  if (algorithm?.name === 'ECDSA') return EC_CURVE_ALGORITHMS[String(algorithm.namedCurve)];
  if (algorithm?.name === 'RSASSA-PKCS1-v1_5') return 'RS256';
  return undefined;
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
 * Signer for service-side operations (quote token signing)
 */
export interface QuoteSigner {
  /**
   * Sign a quote token JWT
   * @param payload - Quote token payload to sign
   * @returns Signed JWT string
   */
  signQuote(payload: QuoteTokenPayload): Promise<string>;

  /**
   * Get the public key for verification (JWK format)
   * @returns Public key in JWK format
   */
  getPublicKey(): jose.JWK;

  /**
   * Get the service URL (issuer)
   * @returns Service URL
   */
  getServiceUrl(): string;
}

/**
 * Signer for Agentic Commerce-side operations (payment token signing)
 */
export interface PaymentTokenSigner {
  /**
   * Sign a payment token JWT
   * @param payload - Payment token payload to sign
   * @returns Signed JWT string
   */
  signPayment(payload: PaymentTokenPayload): Promise<string>;

  /**
   * Get the public key for verification (JWK format)
   * @returns Public key in JWK format
   */
  getPublicKey(): jose.JWK;

  /**
   * Get Agentic Commerce addresses (for facilitator supported endpoint)
   * @returns Array of Agentic Commerce IDs
   */
  getAddresses(): string[];
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
 * @returns QuoteSigner instance
 * @throws ValidationError if the key's alg is not one of ALLOWED_ALGORITHMS
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
): QuoteSigner {
  const alg = signingAlgorithm(privateKey, publicKey);
  return {
    async signQuote(payload: QuoteTokenPayload): Promise<string> {
      return await new jose.SignJWT(payload as any)
        .setProtectedHeader({ alg, typ: 'JWT' })
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

/**
 * Convert a jose KeyLike to a PaymentTokenSigner
 *
 * Tokens are signed with the key's own alg, as in {@link toQuoteSigner}.
 *
 * @param privateKey - Private key for signing (RS256, ES256, ES384 or ES512)
 * @param publicKey - Public key in JWK format
 * @param agenticCommerceId - Agentic Commerce identifier
 * @returns PaymentTokenSigner instance
 * @throws ValidationError if the key's alg is not one of ALLOWED_ALGORITHMS
 *
 * @example
 * ```typescript
 * import { generateKeyPair, exportJWK } from 'jose';
 *
 * const { privateKey, publicKey } = await generateKeyPair('RS256');
 * const publicJWK = await exportJWK(publicKey);
 *
 * const signer = toPaymentTokenSigner(
 *   privateKey,
 *   publicJWK,
 *   'agentic-commerce-provider-id'
 * );
 * ```
 */
export function toPaymentTokenSigner(
  privateKey: jose.KeyLike,
  publicKey: jose.JWK,
  agenticCommerceId: string
): PaymentTokenSigner {
  const alg = signingAlgorithm(privateKey, publicKey);
  return {
    async signPayment(payload: PaymentTokenPayload): Promise<string> {
      return await new jose.SignJWT(payload as any)
        .setProtectedHeader({ alg, typ: 'JWT' })
        .sign(privateKey);
    },
    getPublicKey(): jose.JWK {
      return publicKey;
    },
    getAddresses(): string[] {
      return [agenticCommerceId];
    },
  };
}
