// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Configuration types for Agentic Commerce scheme registration
 */

/**
 * Agentic Commerce endpoint configuration
 * All endpoints are standardized and derived from baseUrl
 */
export interface AgenticCommerceConfig {
  /**
   * Base URL for Agentic Commerce provider (e.g., 'https://pay.example.com')
   *
   * Standardized endpoints:
   * - GET  ${baseUrl}/.well-known/jwks.json - public keys
   */
  baseUrl: string;
}

// ============================================================================
// Client Interfaces
// ============================================================================

/**
 * Facilitator-side Agentic Commerce operations
 * Used by AgenticCommerceFacilitatorScheme to verify payments
 *
 * Note: Agentic Commerce auto-captures on creation — there is no separate capture/settle step.
 */
export interface AgenticCommerceClientForFacilitator {
  /**
   * Verify a payment token's signature
   * Fetches Agentic Commerce's public keys from JWKS endpoint and verifies
   *
   * @param token - Payment token JWT to verify
   * @returns Decoded and verified payment token payload
   */
  verifyPaymentToken(token: string): Promise<{
    iss: string;
    sub?: string;
    aud?: string;
    iat: number;
    exp: number;
    payment_id: string;
    payment_context?: {
      transaction_id: string;
      quote_token: string;
    };
    cnf?: {
      jkt: string;
    };
  }>;
}

/**
 * Facilitator scheme configuration
 */
export type AgenticCommerceFacilitatorSchemeConfig =
  | { agenticCommerceId: string; agenticCommerce: AgenticCommerceConfig }
  | { agenticCommerceId: string; agenticCommerceClient: AgenticCommerceClientForFacilitator };

/**
 * Service signer interface (for custom implementations)
 */
export interface QuoteSigner {
  signQuote(payload: unknown): Promise<string>;
  getPublicKey(): unknown;
  getServiceUrl(): string;
}
