// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Configuration types for Agent Pay scheme registration
 */

import type { KeyLike, JWK } from 'jose';
import type { AuthConfig } from './auth/types';

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
   * Base URL for Agent Pay provider (e.g., 'https://pay.aws.amazon.com')
   * 
   * Standardized endpoints:
   * - POST ${baseUrl}/CreateAgentPayment - create/authorize payment
   * - GET  ${baseUrl}/GetAgentPayment/{paymentId} - get payment detail
   * - POST ${baseUrl}/ListAgentPayments - list payments
   * - GET  ${baseUrl}/.well-known/jwks.json - public keys
   */
  baseUrl: string;
  
  /**
   * Optional authentication configuration for Agent Pay API calls
   * Supports API Key, AWS SigV4, OAuth2, and custom authentication
   */
  auth?: AuthConfig;
}

// ============================================================================
// Agent Pay API Request/Response Types
// ============================================================================

/**
 * DPoP public key in JWK format for proof-of-possession binding.
 * Only EC keys are supported (P-256, P-384, P-521).
 */
export interface DpopJwk {
  kty: 'EC';
  crv: 'P-256' | 'P-384' | 'P-521';
  x: string;
  y: string;
}

/**
 * Request body for CreateAgentPayment
 */
export interface CreateAgentPaymentRequest {
  /** The seller-signed quote token JWT from the HTTP 402 response */
  quoteToken: string;
  /** Client-provided idempotency key (1-128 chars). Auto-generated if omitted. */
  clientToken?: string;
  /** EC public key for DPoP binding */
  dpopJwk?: DpopJwk;
}

/**
 * Response from CreateAgentPayment (201)
 */
export interface CreateAgentPaymentResponse {
  /** Globally unique payment ID (format: awsmp-{UUIDv7}, 42 chars) */
  paymentId: string;
  /** Payment JWT signed by Agent Pay Service (ES384) */
  paymentToken: string;
  /** Authorization timestamp in ISO 8601 format */
  createdAt: string;
}

/**
 * Response from GetAgentPayment (200)
 */
export interface GetAgentPaymentResponse {
  payment: {
    paymentId: string;
    buyerAccountId: string;
    sellerInformation: {
      sellerProfileId: string;
      displayName: string;
    };
    listingId: string;
    quoteToken: string;
    paymentToken: string;
    createdAt: string;
    amount: {
      value: string;
      currency: string;
    };
    agreementId?: string;
  };
}

/**
 * Request body for ListAgentPayments
 */
export interface ListAgentPaymentsRequest {
  sort?: {
    sortBy?: 'CreatedAt';
    sortOrder?: 'Asc' | 'Desc';
  };
  maxResults?: number;
  nextToken?: string;
}

/**
 * Response from ListAgentPayments (200)
 */
export interface ListAgentPaymentsResponse {
  payments: Array<{
    paymentId: string;
    buyerAccountId: string;
    sellerInformation: {
      sellerProfileId: string;
      displayName: string;
    };
    listingId: string;
    createdAt: string;
    agreementId?: string;
  }>;
  nextToken?: string;
}

// ============================================================================
// Client Interfaces
// ============================================================================

/**
 * Client-side Agent Pay operations
 * Used by AgentPayClientScheme to create payments via the Agent Pay API
 */
export interface AgentPayClientForClient {
  /**
   * Create a payment with the Agent Pay Service.
   * Sends the seller-signed quote token; Agent Pay verifies, captures,
   * and returns a signed payment JWT.
   * 
   * @param request - CreateAgentPayment request
   * @returns Payment ID and signed payment token
   */
  createPayment(request: CreateAgentPaymentRequest): Promise<CreateAgentPaymentResponse>;
}

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
 * Combined interface for full Agent Pay client
 */
export interface AgentPayClient extends AgentPayClientForClient, AgentPayClientForFacilitator {}

/**
 * Client scheme configuration
 */
export type AgentPayClientSchemeConfig = 
  | { agentPayId: string; agentPay: AgentPayConfig }
  | { agentPayId: string; agentPayClient: AgentPayClientForClient; auth?: AuthConfig };

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
  | { agentPayId: string; agentPayClient: AgentPayClientForFacilitator; auth?: AuthConfig };

/**
 * Service signer interface (for custom implementations)
 */
export interface ServiceAgentPaySigner {
  signQuote(payload: unknown): Promise<string>;
  getPublicKey(): unknown;
  getServiceUrl(): string;
}
