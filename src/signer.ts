/**
 * Signer interfaces and adapters for Agentic Pay JWT operations
 * 
 * Agentic Pay uses JWT signing instead of crypto Agentic Pay signing.
 * This module provides interfaces and adapter functions for both
 * service-side (quote token signing) and Agentic Pay-side (payment token signing).
 */

import * as jose from 'jose';
import { QuoteTokenPayload, PaymentTokenPayload } from './types';

/**
 * Signer for service-side operations (quote token signing)
 */
export interface ServiceAgenticPaySigner {
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
 * Signer for Agentic Pay-side operations (payment token signing)
 */
export interface AgenticPaySigner {
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
   * Get Agentic Pay addresses (for facilitator supported endpoint)
   * @returns Array of Agentic Pay IDs
   */
  getAddresses(): string[];
}

/**
 * Convert a jose KeyLike to a ServiceAgenticPaySigner
 * 
 * @param privateKey - Private key for signing (RS256 or ES256)
 * @param publicKey - Public key in JWK format
 * @param serviceUrl - Service URL (issuer)
 * @returns ServiceAgenticPaySigner instance
 * 
 * @example
 * ```typescript
 * import { generateKeyPair, exportJWK } from 'jose';
 * 
 * const { privateKey, publicKey } = await generateKeyPair('RS256');
 * const publicJWK = await exportJWK(publicKey);
 * 
 * const signer = toServiceAgenticPaySigner(
 *   privateKey,
 *   publicJWK,
 *   'https://api.service.com'
 * );
 * ```
 */
export function toServiceAgenticPaySigner(
  privateKey: jose.KeyLike,
  publicKey: jose.JWK,
  serviceUrl: string
): ServiceAgenticPaySigner {
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
    }
  };
}

/**
 * Convert a jose KeyLike to a AgenticPaySigner
 * 
 * @param privateKey - Private key for signing (RS256 or ES256)
 * @param publicKey - Public key in JWK format
 * @param agenticPayId - Agentic Pay identifier
 * @returns AgenticPaySigner instance
 * 
 * @example
 * ```typescript
 * import { generateKeyPair, exportJWK } from 'jose';
 * 
 * const { privateKey, publicKey } = await generateKeyPair('RS256');
 * const publicJWK = await exportJWK(publicKey);
 * 
 * const signer = toAgenticPaySigner(
 *   privateKey,
 *   publicJWK,
 *   'agentic-pay-provider-id'
 * );
 * ```
 */
export function toAgenticPaySigner(
  privateKey: jose.KeyLike,
  publicKey: jose.JWK,
  agenticPayId: string
): AgenticPaySigner {
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
      return [agenticPayId];
    }
  };
}
