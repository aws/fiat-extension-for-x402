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
 * Agentic Pay endpoint configuration
 * All endpoints are standardized and derived from baseUrl
 */
export interface AgenticPayConfig {
  /**
   * Base URL for Agentic Pay provider (e.g., 'https://pay.aws.amazon.com')
   * 
   * Standardized endpoints:
   * - POST ${baseUrl}/transactions - authorize payment
   * - POST ${baseUrl}/capture - capture payment
   * - GET ${baseUrl}/.well-known/jwks.json - public keys
   */
  baseUrl: string;
  
  /**
   * Optional authentication configuration for Agentic Pay API calls
   * Supports API Key, AWS SigV4, OAuth2, and custom authentication
   */
  auth?: AuthConfig;
}

/**
 * Client-side Agentic Pay operations
 * Used by FABClientScheme to authorize payments
 */
export interface AgenticPayClientForClient {
  /**
   * Authorize a payment with the Agentic Pay provider
   * Calls Agentic Pay's POST /transactions endpoint
   * 
   * @param payload - Payment authorization request
   * @returns Transaction ID and signed payment token from Agentic Pay
   */
  authorize(payload: {
    network: string;
    amount: string;
    currency: string;
    payTo: string;
    quoteToken: string;
    agenticPayId: string;
  }): Promise<{
    transactionId: string;
    paymentToken: string; // JWT signed by Agentic Pay provider
  }>;
}

/**
 * Facilitator-side Agentic Pay operations
 * Used by FABFacilitatorScheme to verify and settle payments
 */
export interface AgenticPayClientForFacilitator {
  /**
   * Verify a payment token's signature
   * Fetches Agentic Pay's public keys from JWKS endpoint and verifies
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
   * Capture/settle a payment with the Agentic Pay provider
   * Calls Agentic Pay's POST /capture endpoint
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
 * Combined interface for full Agentic Pay client
 * Used when implementing a complete Agentic Pay client
 */
export interface AgenticPayClient extends AgenticPayClientForClient, AgenticPayClientForFacilitator {}

/**
 * Client scheme configuration
 */
export type FABClientSchemeConfig = 
  | { agenticPayId: string; agenticPay: AgenticPayConfig }
  | { agenticPayId: string; agenticPayClient: AgenticPayClientForClient; auth?: AuthConfig };

/**
 * Server scheme configuration
 */
export type FABServerSchemeConfig = 
  | { signingKeys: SigningKeysConfig; serviceUrl: string; agenticPay?: AgenticPayConfig }
  | { signer: ServiceFABSigner };

/**
 * Facilitator scheme configuration
 */
export type FABFacilitatorSchemeConfig = 
  | { agenticPayId: string; agenticPay: AgenticPayConfig }
  | { agenticPayId: string; agenticPayClient: AgenticPayClientForFacilitator; auth?: AuthConfig };

/**
 * Service signer interface (for custom implementations)
 */
export interface ServiceFABSigner {
  signQuote(payload: unknown): Promise<string>;
  getPublicKey(): unknown;
  getServiceUrl(): string;
}
