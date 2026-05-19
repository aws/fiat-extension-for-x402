// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agent Pay-specific types for the x402 protocol
 * 
 * This module contains all type definitions for the Agent Pay payment scheme,
 * including settlement types, payment structures, and error classes.
 */

// ============================================================================
// Settlement Types
// ============================================================================

/**
 * Settlement method codes (Agent Pay-specific, with ISO 20022 mapping intent)
 * 
 * Note: These are Agent Pay conceptual codes, not official ISO 20022 settlement method codes.
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
export interface AgentPaySettlement {
  /** Settlement method (required) */
  method: SettlementMethod;
  /** Settlement cycle (optional) */
  cycle?: SettlementCycle;
}

/**
 * Support contact information for disputes
 */
export interface AgentPaySupport {
  /** URI for support/dispute resolution */
  uri: string;
  /** Support method type */
  method: 'human' | 'agent';
}

/**
 * Terms and conditions reference
 */
export interface AgentPayTerms {
  /** Human-readable description of the terms */
  description: string;
  /** URI to the full terms document */
  uri: string;
}

// ============================================================================
// Payment Types
// ============================================================================

/**
 * Agent Pay-specific payment extra data
 * This is stored in the `extra` field of x402 PaymentRequirements
 */
export interface AgentPayPaymentExtra {
  /** Quote token (signed JWT from service) - REQUIRED */
  quoteToken: string;
  /** Product/service reference identifier - OPTIONAL */
  reference?: string;
  /** Settlement terms - OPTIONAL */
  settlement?: AgentPaySettlement;
  /** Support/dispute contact information - OPTIONAL */
  support?: AgentPaySupport;
  /** Terms and conditions references - OPTIONAL */
  terms?: AgentPayTerms[];
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
 * This is the structure of the signed JWT in AgentPayPaymentExtra.quoteToken
 */
export interface QuoteTokenPayload {
  /** Issuer - service identity */
  iss: string;
  /** Audience - target Agent Pay provider(s) */
  aud: string | string[];
  /** Issued at timestamp */
  iat: number;
  /** Expiry timestamp */
  exp: number;
  /** JWT ID - unique quote identifier */
  jti: string;
  /** Price (single or multiple currency options) */
  price: QuoteTokenPrice | QuoteTokenPrice[];
  /** Payment recipient - seller's Agent Pay ID */
  payTo: string;
  /** Product/service reference identifier */
  reference: string;
  /** Human-readable description of what is being charged for - OPTIONAL */
  description?: string;
  /** Key-value dimensions describing units consumed (e.g., { tokens: 1500, model: "claude-4" }) - OPTIONAL */
  dimensions?: Record<string, string | number>;
  /** Settlement terms - OPTIONAL */
  settlement?: AgentPaySettlement;
  /** Support/dispute contact information - OPTIONAL */
  support?: AgentPaySupport;
  /** Terms and conditions references - OPTIONAL */
  terms?: AgentPayTerms[];
}

/**
 * Payment context embedded in payment token
 */
export interface PaymentContext {
  /** Transaction ID from Agent Pay (format: {network}:{id}) */
  transaction_id: string;
  /** Original quote token (signed JWT from service) */
  quote_token: string;
}

/**
 * Payment token JWT payload
 * This is the structure of the signed JWT from Agent Pay
 */
export interface PaymentTokenPayload {
  /** Issuer - Agent Pay provider identity (awsmp-agentpay.amazonaws.com) */
  iss: string;
  /** Subject - client/buyer identity (optional — Agent Pay may not include) */
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
  /** @deprecated Legacy payment context — Agent Pay now uses top-level fields */
  payment_context?: PaymentContext;
  /** Confirmation claim for DPoP (optional) */
  cnf?: {
    /** JWK thumbprint of DPoP public key */
    jkt: string;
  };
}

/**
 * Agent Pay payload for x402 PaymentPayload
 */
export interface AgentPayPayloadV2 {
  /** Payment token (signed JWT from Agent Pay) */
  paymentToken: string;
  /** Payment ID from Agent Pay (format: awsmp-{UUIDv7}) */
  paymentId: string;
  /** @deprecated Use paymentId. Kept for backward compatibility. */
  transactionId?: string;
}

// ============================================================================
// DPoP Types
// ============================================================================

/**
 * DPoP key pair (ephemeral keys for proof-of-possession)
 */
export interface DPoPKeyPair {
  /** Private key for signing */
  privateKey: any; // jose.KeyLike
  /** Public key in JWK format */
  publicKey: any; // jose.JWK
}

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
 * Options for creating DPoP proof
 */
export interface DPoPProofOptions {
  /** HTTP method */
  method: string;
  /** HTTP URL */
  url: string;
  /** Access token to bind (optional) */
  accessToken?: string;
  /** Nonce value (optional) */
  nonce?: string;
}

/**
 * Options for verifying DPoP proof
 */
export interface DPoPVerificationOptions {
  /** HTTP method to verify */
  method: string;
  /** HTTP URL to verify */
  url: string;
  /** Access token to verify binding (optional) */
  accessToken?: string;
  /** Maximum age in seconds (default: 60) */
  maxAge?: number;
  /** Nonce store for replay protection (optional) */
  nonceStore?: DPoPNonceStore;
}

/**
 * Store for tracking used nonces (replay protection)
 */
export interface DPoPNonceStore {
  /** Check if nonce has been used */
  has(jti: string): Promise<boolean> | boolean;
  /** Add nonce with expiry */
  add(jti: string, expiresAt: number): Promise<void> | void;
}

// ============================================================================
// Error Types
// ============================================================================

/**
 * Base error class for all Agent Pay-related errors
 */
export class AgentPayError extends Error {
  /**
   * Create a new Agent Pay error
   * @param message - Human-readable error message
   * @param code - Machine-readable error code
   * @param details - Additional error context
   */
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'AgentPayError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AgentPayError);
    }
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends AgentPayError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ValidationError);
    }
  }
}

/**
 * Error thrown when JWT signature verification fails
 */
export class SignatureError extends AgentPayError {
  constructor(message: string, public tokenType: 'quote' | 'payment') {
    super(message, 'SIGNATURE_ERROR', { tokenType });
    this.name = 'SignatureError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SignatureError);
    }
  }
}

/**
 * Error thrown when a token has expired
 */
export class ExpiryError extends AgentPayError {
  constructor(
    message: string,
    public expiry: number,
    public currentTime: number
  ) {
    super(message, 'EXPIRY_ERROR', { expiry, currentTime });
    this.name = 'ExpiryError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ExpiryError);
    }
  }
}

/**
 * Error thrown when data values don't match expected values
 */
export class MismatchError extends AgentPayError {
  constructor(
    message: string,
    public expected: unknown,
    public actual: unknown
  ) {
    super(message, 'MISMATCH_ERROR', { expected, actual });
    this.name = 'MismatchError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MismatchError);
    }
  }
}

/**
 * Error thrown when DPoP proof verification fails
 */
export class DPoPError extends AgentPayError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DPOP_ERROR', details);
    this.name = 'DPoPError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DPoPError);
    }
  }
}

/**
 * Error thrown when a clientToken is reused with different request parameters (HTTP 409).
 * The same clientToken with the same parameters returns the cached response (idempotency).
 * A different set of parameters triggers this error.
 */
export class IdempotencyConflictError extends AgentPayError {
  /** The clientToken that caused the conflict */
  readonly clientToken: string;

  constructor(clientToken: string, message?: string) {
    super(
      message || `Idempotency conflict: clientToken "${clientToken}" was used with different parameters`,
      'IDEMPOTENCY_CONFLICT',
      { clientToken }
    );
    this.name = 'IdempotencyConflictError';
    this.clientToken = clientToken;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, IdempotencyConflictError);
    }
  }
}
