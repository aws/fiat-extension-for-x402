// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Signer interfaces and adapters for Agentic Commerce JWT operations
 *
 * Agentic Commerce uses JWT signing instead of crypto Agentic Commerce signing.
 * This module provides interfaces and adapter functions for both
 * service-side (quote token signing) and Agentic Commerce-side (payment token signing).
 */

import { KeyObject } from 'node:crypto';
import * as jose from 'jose';
import { quotedLiteral } from '../agentic-commerce/json-value';
import { ALLOWED_ALGORITHMS } from '../security';
import { stripWhitespace } from '../utils';
import { QuoteTokenPayload, PaymentTokenPayload, SigningError, ValidationError } from '../types';

/**
 * The JWS alg of each EC curve, by JWK `crv` and by Node.js / WebCrypto curve name.
 *
 * @internal
 */
export const EC_CURVE_ALGORITHMS: Record<string, string> = {
  'P-256': 'ES256',
  'P-384': 'ES384',
  'P-521': 'ES512',
  prime256v1: 'ES256',
  secp384r1: 'ES384',
  secp521r1: 'ES512',
};

/**
 * JWK members that only private keys carry (RFC 7518 section 6).
 *
 * @internal
 */
export const PRIVATE_JWK_MEMBERS: readonly string[] = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];

/**
 * The private members of a JWK, sorted and written as a quoted list, for
 * example `['d', 'p']`; an empty string when there are none.
 *
 * @internal
 */
export function privateJwkMembers(jwk: object): string {
  const leaked = PRIVATE_JWK_MEMBERS.filter((member) => Object.hasOwn(jwk, member)).sort();
  return leaked.length ? `[${leaked.map((member) => quotedLiteral(member)).join(', ')}]` : '';
}

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

/**
 * The quote signers' service URL check: it becomes the quote's `iss` claim.
 *
 * @internal
 * @throws SigningError if `serviceUrl` is empty or only whitespace
 */
export function assertServiceUrl(serviceUrl: unknown): void {
  if (typeof serviceUrl !== 'string' || !stripWhitespace(serviceUrl)) {
    throw new SigningError(
      "serviceUrl is required and must be non-empty. It becomes the quote token's " +
        "'iss' claim, which the service requires."
    );
  }
}

/** The alg of a public JWK: ES* by curve, RS256 for RSA. */
function algorithmOfJwk(jwk: jose.JWK): string | undefined {
  if (jwk.kty === 'EC') return EC_CURVE_ALGORITHMS[String(jwk.crv)];
  if (jwk.kty === 'RSA') return 'RS256';
  return undefined;
}

/** @internal */
export interface PrivateKeyInfo {
  kty: 'EC' | 'RSA';
  /** The JWS alg the key signs with, or undefined for an unsupported curve */
  alg?: string;
  /** Curve name, for EC keys */
  curve?: string;
  /** Modulus length, for RSA keys */
  bits?: number;
}

// WebCrypto algorithms whose keys sign JWTs this package accepts.
const SIGNING_CRYPTO_KEY_ALGORITHMS = ['ECDSA', 'RSASSA-PKCS1-v1_5'];

/**
 * A private signing key as a Node.js KeyObject, or undefined. A WebCrypto
 * CryptoKey must be an ECDSA or RSASSA-PKCS1-v1_5 key (a private one always
 * has the `sign` usage: WebCrypto refuses empty usages). It is converted, so
 * it signs as its key type does whatever hash it was made for (an
 * RSASSA-PKCS1-v1_5 CryptoKey made for SHA-512 still signs RS256).
 *
 * @internal
 */
export function privateKeyObject(key: unknown): KeyObject | undefined {
  if (key instanceof KeyObject) return key.type === 'private' ? key : undefined;
  const cryptoKey = key as { type?: unknown; algorithm?: { name?: unknown } };
  if (
    typeof key !== 'object' ||
    key === null ||
    cryptoKey.type !== 'private' ||
    !SIGNING_CRYPTO_KEY_ALGORITHMS.includes(String(cryptoKey.algorithm?.name))
  ) {
    return undefined;
  }
  try {
    return KeyObject.from(key as Parameters<typeof KeyObject.from>[0]);
  } catch {
    return undefined;
  }
}

/**
 * The key type, curve and size of a private KeyObject; undefined unless EC or RSA.
 *
 * @internal
 */
export function describePrivateKey(key: KeyObject): PrivateKeyInfo | undefined {
  if (key.asymmetricKeyType === 'ec') {
    const curve = String(key.asymmetricKeyDetails?.namedCurve);
    return { kty: 'EC', alg: EC_CURVE_ALGORITHMS[curve], curve };
  }
  if (key.asymmetricKeyType === 'rsa') {
    return { kty: 'RSA', alg: 'RS256', bits: key.asymmetricKeyDetails?.modulusLength };
  }
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
 * Signs the seller's quote tokens: the one quote-signer interface of this
 * package. `signQuote` is async, so a signer can call a remote key service.
 *
 * Implement it to keep the key elsewhere, for example in an HSM that signs
 * remotely. {@link KmsQuoteSigner} and {@link LocalQuoteSigner} implement it.
 */
export interface QuoteSigner {
  /**
   * Sign quote token claims.
   * @param payload - Quote token claims to sign
   * @returns Signed compact JWS (`header.payload.signature`)
   */
  signQuote(payload: QuoteTokenPayload): Promise<string>;

  /**
   * The service URL used as the `iss` claim in quote tokens.
   * @returns Service URL
   */
  getServiceUrl(): string;
}

/**
 * @deprecated Use {@link QuoteSigner}. The former loose signer interface,
 * now the same type.
 */
export type QuoteSignerInterface = QuoteSigner;

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
      return await new jose.SignJWT(payload as any).setProtectedHeader(header).sign(privateKey);
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
  assertPublicJwk(publicKey);
  const header = protectedHeader(signingAlgorithm(privateKey, publicKey), publicKey);
  return {
    async signPayment(payload: PaymentTokenPayload): Promise<string> {
      return await new jose.SignJWT(payload as any).setProtectedHeader(header).sign(privateKey);
    },
    getPublicKey(): jose.JWK {
      return publicKey;
    },
    getAddresses(): string[] {
      return [agenticCommerceId];
    },
  };
}
