// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The quote signer interface, and the key checks the quote signers share.
 */

import { KeyObject } from 'node:crypto';
import { quotedLiteral } from '../agentic-commerce/json-value';
import { stripWhitespace } from '../utils';
import { QuoteTokenPayload, SigningError } from '../types';

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

/** JWK members that only private keys carry (RFC 7518 section 6). */
const PRIVATE_JWK_MEMBERS: readonly string[] = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'];

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
