// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Configuration types for Agent Pay scheme registration
 */

import type { KeyLike, JWK } from 'jose';

/**
 * Signing key configuration for service quote tokens
 */
export interface SigningKeysConfig {
  publicKey: JWK;
  privateKey: KeyLike;
  alg: 'RS256' | 'ES256' | 'ES384';
}

/**
 * Agent Pay endpoint configuration
 * All endpoints are standardized and derived from baseUrl
 */
export interface AgentPayConfig {
  /**
   * Base URL for Agent Pay provider (e.g., 'https://pay.example.com')
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
 * Facilitator-side Agent Pay operations
 * Used by AgentPayFacilitatorScheme to verify payments
 *
 * Note: Agent Pay auto-captures on creation — there is no separate capture/settle step.
 */
export interface AgentPayClientForFacilitator {
  /**
   * Verify a payment token's signature
   * Fetches Agent Pay's public keys from JWKS endpoint and verifies
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
 * Server scheme configuration
 */
export type AgentPayServerSchemeConfig =
  | { signingKeys: SigningKeysConfig; serviceUrl: string; agentPay?: AgentPayConfig }
  | { signer: ServiceAgentPaySigner };

/**
 * Facilitator scheme configuration
 */
export type AgentPayFacilitatorSchemeConfig =
  | { agentPayId: string; agentPay: AgentPayConfig }
  | { agentPayId: string; agentPayClient: AgentPayClientForFacilitator };

/**
 * Service signer interface (for custom implementations)
 */
export interface ServiceAgentPaySigner {
  signQuote(payload: unknown): Promise<string>;
  getPublicKey(): unknown;
  getServiceUrl(): string;
}
