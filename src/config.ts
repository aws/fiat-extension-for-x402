/**
 * Configuration types for FAB scheme registration
 */

import type { KeyLike, JWK } from 'jose';
import type { AuthConfig } from './auth/types';

/**
 * Signing key configuration for service quote tokens
 */
export interface SigningKeysConfig {
  publicKey: JWK;
  privateKey: KeyLike;
  alg: 'RS256' | 'ES256';
}

/**
 * Wallet endpoint configuration
 * All endpoints are standardized and derived from baseUrl
 */
export interface WalletConfig {
  /**
   * Base URL for wallet provider (e.g., 'https://wallet.aws.com')
   * 
   * Standardized endpoints:
   * - POST ${baseUrl}/transactions - authorize payment
   * - POST ${baseUrl}/capture - capture payment
   * - GET ${baseUrl}/.well-known/jwks.json - public keys
   */
  baseUrl: string;
  
  /**
   * Optional authentication configuration for wallet API calls
   * Supports API Key, AWS SigV4, OAuth2, and custom authentication
   */
  auth?: AuthConfig;
}

/**
 * Client-side wallet operations
 * Used by FABClientScheme to authorize payments
 */
export interface WalletClientForClient {
  /**
   * Authorize a payment with the wallet provider
   * Calls wallet's POST /transactions endpoint
   * 
   * @param payload - Payment authorization request
   * @returns Transaction ID and signed payment token from wallet
   */
  authorize(payload: {
    network: string;
    amount: string;
    currency: string;
    payTo: string;
    quoteToken: string;
    walletId: string;
  }): Promise<{
    transactionId: string;
    paymentToken: string; // JWT signed by wallet provider
  }>;
}

/**
 * Facilitator-side wallet operations
 * Used by FABFacilitatorScheme to verify and settle payments
 */
export interface WalletClientForFacilitator {
  /**
   * Verify a payment token's signature
   * Fetches wallet's public keys from JWKS endpoint and verifies
   * 
   * @param token - Payment token JWT to verify
   * @returns Decoded and verified payment token payload
   */
  verifyPaymentToken(token: string): Promise<{
    iss: string;
    sub: string;
    aud: string;
    iat: number;
    exp: number;
    payment_context: {
      transaction_id: string;
      quote_token: string;
    };
  }>;
  
  /**
   * Capture/settle a payment with the wallet provider
   * Calls wallet's POST /capture endpoint
   * 
   * @param transactionId - Transaction ID from payment token
   * @param amount - Amount to capture
   * @param currency - Currency code
   * @returns Capture result with confirmation
   */
  capturePayment(
    transactionId: string,
    amount: string,
    currency: string
  ): Promise<{
    success: boolean;
    captureId: string;
    timestamp: number;
  }>;
}

/**
 * Combined interface for full wallet client
 * Used when implementing a complete wallet client
 */
export interface WalletClient extends WalletClientForClient, WalletClientForFacilitator {}

/**
 * Client scheme configuration
 */
export type FABClientSchemeConfig = 
  | { walletId: string; wallet: WalletConfig }
  | { walletId: string; walletClient: WalletClientForClient; auth?: AuthConfig };

/**
 * Server scheme configuration
 */
export type FABServerSchemeConfig = 
  | { signingKeys: SigningKeysConfig; serviceUrl: string; wallet?: WalletConfig }
  | { signer: ServiceFABSigner };

/**
 * Facilitator scheme configuration
 */
export type FABFacilitatorSchemeConfig = 
  | { walletId: string; wallet: WalletConfig }
  | { walletId: string; walletClient: WalletClientForFacilitator; auth?: AuthConfig };

/**
 * Service signer interface (for custom implementations)
 */
export interface ServiceFABSigner {
  signQuote(payload: unknown): Promise<string>;
  getPublicKey(): unknown;
  getServiceUrl(): string;
}
