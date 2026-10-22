// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agentic Commerce-specific types for the x402 protocol
 *
 * This module contains all type definitions for the Agentic Commerce payment scheme,
 * including settlement types, payment structures, and error classes.
 */

// ============================================================================
// Settlement Types
// ============================================================================

/**
 * Settlement method codes (Agentic Commerce-specific, with ISO 20022 mapping intent)
 *
 * Note: These are Agentic Commerce conceptual codes, not official ISO 20022 settlement method codes.
 * The actual ISO 20022 settlement methods are: INDA, INGA, COVE, CLRG.
 *
 * - INST: Instant settlement (maps to immediate fund transfer via FedNow/SEPA)
 * - CLRG: Clearing/batch settlement (maps to deferred ACH/Wire transfer)
 * - CRDT: Credit/invoice settlement (maps to monthly invoice with Net-30 terms)
 */
export type SettlementMethod = 'INST' | 'CLRG' | 'CRDT';

/**
 * Settlement cycle codes
 * - MNTH: Monthly settlement
 * - WEEK: Weekly settlement
 * - QRTR: Quarterly settlement
 */
export type SettlementCycle = 'MNTH' | 'WEEK' | 'QRTR';

/**
 * Settlement terms for a payment
 */
export interface AgenticCommerceSettlement {
  /** Settlement method (required) */
  method: SettlementMethod;
  /** Settlement cycle (optional) */
  cycle?: SettlementCycle;
}

/**
 * Support contact information for disputes
 */
export interface AgenticCommerceSupport {
  /** URI for support/dispute resolution */
  uri: string;
  /** Support method type */
  method: 'human' | 'agent';
}

/**
 * Terms and conditions reference
 */
export interface AgenticCommerceTerms {
  /** Human-readable description of the terms */
  description: string;
  /** URI to the full terms document */
  uri: string;
}

// ============================================================================
// Payment Types
// ============================================================================

/**
 * Agentic Commerce-specific payment extra data
 * This is stored in the `extra` field of x402 PaymentRequirements
 */
export interface AgenticCommercePaymentExtra {
  /** Quote token (signed JWT from service) - REQUIRED */
  quoteToken: string;
  /** Product/service reference identifier - OPTIONAL */
  reference?: string;
  /** Settlement terms - OPTIONAL */
  settlement?: AgenticCommerceSettlement;
  /** Support/dispute contact information - OPTIONAL */
  support?: AgenticCommerceSupport;
  /** Terms and conditions references - OPTIONAL */
  terms?: AgenticCommerceTerms[];
}

/**
 * Price information in quote token
 */
export interface QuoteTokenPrice {
  /** Amount as string (e.g., "0.15") */
  amount: string;
  /** Currency code (e.g., "USD") */
  currency: string;
}

/**
 * Quote token JWT payload
 * This is the structure of the signed JWT in AgenticCommercePaymentExtra.quoteToken
 */
export interface QuoteTokenPayload {
  /** Issuer - service identity */
  iss: string;
  /** Audience - target Agentic Commerce provider(s) */
  aud: string | string[];
  /** Issued at timestamp */
  iat: number;
  /** Expiry timestamp */
  exp: number;
  /** JWT ID - unique quote identifier */
  jti: string;
  /** Price (single or multiple currency options) */
  price: QuoteTokenPrice | QuoteTokenPrice[];
  /** Payment recipient - seller's Agentic Commerce ID */
  payTo: string;
  /** Product/service reference identifier */
  reference: string;
  /** Human-readable description of what is being charged for - OPTIONAL */
  description?: string;
  /** Key-value dimensions describing units consumed (e.g., { tokens: 1500, model: "claude-4" }) - OPTIONAL */
  dimensions?: Record<string, string | number>;
  /** Settlement terms - OPTIONAL */
  settlement?: AgenticCommerceSettlement;
  /** Support/dispute contact information - OPTIONAL */
  support?: AgenticCommerceSupport;
  /** Terms and conditions references - OPTIONAL */
  terms?: AgenticCommerceTerms[];
}

/**
 * Payment token JWT payload
 * This is the structure of the signed JWT from Agentic Commerce
 */
export interface PaymentTokenPayload {
  /** Issuer - Agentic Commerce provider identity (awsmp-agentpay.amazonaws.com) */
  iss: string;
  /** Subject - client/buyer identity (optional — Agentic Commerce may not include) */
  sub?: string;
  /** Audience - seller service URL */
  aud: string;
  /** Issued at timestamp */
  iat: number;
  /** Expiry timestamp */
  exp: number;
  /** Payment ID (top-level, format: awsmp-{UUID}) */
  payment_id?: string;
  /** Quote token (top-level — the original seller-signed quote) */
  quote_token?: string;
  /** JWT ID (same as payment_id) */
  jti?: string;
  /** Confirmation claim for DPoP (optional) */
  cnf?: {
    /** JWK thumbprint of DPoP public key */
    jkt: string;
  };
}

// ============================================================================
// DPoP Types
// ============================================================================

/**
 * DPoP proof JWT payload
 */
export interface DPoPProofPayload {
  /** Unique nonce */
  jti: string;
  /** HTTP method */
  htm: string;
  /** HTTP URI */
  htu: string;
  /** Issued at timestamp */
  iat: number;
  /** Access token hash (optional) */
  ath?: string;
  /** Allow additional properties for extensibility */
  [key: string]: unknown;
}

/**
 * Options for verifying DPoP proof
 */
export interface DPoPVerificationOptions {
  /** Expected `htm`, compared exactly (pass it upper-cased); empty skips the check */
  method: string;
  /** Expected `htu`, compared exactly; empty skips the check */
  url: string;
  /** Access token the proof must be bound to (`ath`) (optional) */
  accessToken?: string;
  /** Maximum age in seconds (default: 60) */
  maxAge?: number;
  /** Nonce store for replay protection (optional) */
  nonceStore?: DPoPNonceStore;
}

/**
 * Store of seen DPoP proof ids (`jti`), for replay protection.
 *
 * `has` is called, then `add` if the id is new. A synchronous store is checked
 * and updated with no await in between. An asynchronous store (for example one
 * shared by several seller instances) is not: two concurrent requests with the
 * same proof can both pass unless `has` itself records the id atomically.
 */
export interface DPoPNonceStore {
  /** Check if nonce has been used */
  has(jti: string): Promise<boolean> | boolean;
  /**
   * Record a proof id as used until `expiresAt` (Unix time, seconds).
   *
   * `has` must return `true` for the id while the time is before `expiresAt`;
   * the store may forget the id from then on. `expiresAt` is
   * `iat + floor(maxAge + 5) + 1`, the first second at which the proof is no
   * longer accepted.
   */
  add(jti: string, expiresAt: number): Promise<void> | void;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for all Agentic Commerce-related errors
 */
export class AgenticCommerceError extends Error {
  /**
   * Create a new Agentic Commerce error
   * @param message - Human-readable error message
   * @param code - Machine-readable error code
   * @param details - Additional error context
   * @param options - `cause`: the error this one wraps
   */
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = 'AgenticCommerceError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AgenticCommerceError);
    }
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends AgenticCommerceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
  }
}

/**
 * Error thrown when quote token signing fails, or a quote signer is
 * misconfigured
 */
export class SigningError extends AgenticCommerceError {
  /**
   * @param message - Human-readable error message
   * @param details - Additional error context
   * @param options - `cause`: the error this one wraps
   */
  constructor(message: string, details?: Record<string, unknown>, options?: ErrorOptions) {
    super(message, 'SIGNING_ERROR', details, options);
    this.name = 'SigningError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SigningError);
    }
  }
}

/**
 * Error thrown when DPoP proof verification fails
 */
export class DPoPError extends AgenticCommerceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DPOP_ERROR', details);
    this.name = 'DPoPError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DPoPError);
    }
  }
}
