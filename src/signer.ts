/**
 * Signer interfaces and adapters for FAB JWT operations
 * 
 * FAB uses JWT signing instead of crypto wallet signing.
 * This module provides interfaces and adapter functions for both
 * service-side (quote token signing) and wallet-side (payment token signing).
 */

import * as jose from 'jose';
import { QuoteTokenPayload, PaymentTokenPayload } from './types';

/**
 * Signer for service-side operations (quote token signing)
 */
export interface ServiceFABSigner {
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
 * Signer for wallet-side operations (payment token signing)
 */
export interface WalletFABSigner {
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
   * Get wallet addresses (for facilitator supported endpoint)
   * @returns Array of wallet IDs
   */
  getAddresses(): string[];
}

/**
 * Convert a jose KeyLike to a ServiceFABSigner
 * 
 * @param privateKey - Private key for signing (RS256 or ES256)
 * @param publicKey - Public key in JWK format
 * @param serviceUrl - Service URL (issuer)
 * @returns ServiceFABSigner instance
 * 
 * @example
 * ```typescript
 * import { generateKeyPair, exportJWK } from 'jose';
 * 
 * const { privateKey, publicKey } = await generateKeyPair('RS256');
 * const publicJWK = await exportJWK(publicKey);
 * 
 * const signer = toServiceFABSigner(
 *   privateKey,
 *   publicJWK,
 *   'https://api.service.com'
 * );
 * ```
 */
export function toServiceFABSigner(
  privateKey: jose.KeyLike,
  publicKey: jose.JWK,
  serviceUrl: string
): ServiceFABSigner {
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
 * Convert a jose KeyLike to a WalletFABSigner
 * 
 * @param privateKey - Private key for signing (RS256 or ES256)
 * @param publicKey - Public key in JWK format
 * @param walletId - Wallet identifier
 * @returns WalletFABSigner instance
 * 
 * @example
 * ```typescript
 * import { generateKeyPair, exportJWK } from 'jose';
 * 
 * const { privateKey, publicKey } = await generateKeyPair('RS256');
 * const publicJWK = await exportJWK(publicKey);
 * 
 * const signer = toWalletFABSigner(
 *   privateKey,
 *   publicJWK,
 *   'wallet-provider-id'
 * );
 * ```
 */
export function toWalletFABSigner(
  privateKey: jose.KeyLike,
  publicKey: jose.JWK,
  walletId: string
): WalletFABSigner {
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
      return [walletId];
    }
  };
}
