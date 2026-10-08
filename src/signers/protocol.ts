// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Signer interfaces and adapters for Agentic Commerce JWT operations
 *
 * Agentic Commerce uses JWT signing instead of crypto Agentic Commerce signing.
 * This module provides interfaces and adapter functions for both
 * service-side (quote token signing) and Agentic Commerce-side (payment token signing).
 */

import * as jose from 'jose';
import { QuoteTokenPayload, PaymentTokenPayload } from '../types';

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
 * @param privateKey - Private key for signing (RS256 or ES256)
 * @param publicKey - Public key in JWK format
 * @param serviceUrl - Service URL (issuer)
 * @returns QuoteSigner instance
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
  return {
    async signQuote(payload: QuoteTokenPayload): Promise<string> {
      return await new jose.SignJWT(payload as any)
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
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
 * @param privateKey - Private key for signing (RS256 or ES256)
 * @param publicKey - Public key in JWK format
 * @param agenticCommerceId - Agentic Commerce identifier
 * @returns PaymentTokenSigner instance
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
  return {
    async signPayment(payload: PaymentTokenPayload): Promise<string> {
      return await new jose.SignJWT(payload as any)
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
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
