/**
 * FAB-specific types for the x402 protocol
 * 
 * This module contains all type definitions for the FAB payment scheme,
 * including settlement types, payment structures, and error classes.
 */

// ============================================================================
// Settlement Types
// ============================================================================

/**
 * Capture mode for payment settlement
 * - manual: Payment must be explicitly captured by the service
 * - auto: Payment is automatically captured when authorized
 */
export type CaptureMode = 'manual' | 'auto';

/**
 * Settlement method codes (FAB-specific, with ISO 20022 mapping intent)
 * 
 * Note: These are FAB conceptual codes, not official ISO 20022 settlement method codes.
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
export interface FABSettlement {
  /** Settlement method (required) */
  method: SettlementMethod;
  /** Settlement cycle (optional) */
  cycle?: SettlementCycle;
}

/**
 * Support contact information for disputes
 */
export interface FABSupport {
  /** URI for support/dispute resolution */
  uri: string;
  /** Support method type */
  method: 'human' | 'agent';
}

/**
 * Terms and conditions reference
 */
export interface FABTerms {
  /** Human-readable description of the terms */
  description: string;
  /** URI to the full terms document */
  uri: string;
}

// ============================================================================
// Payment Types
// ============================================================================

/**
 * FAB-specific payment extra data
 * This is stored in the `extra` field of x402 PaymentRequirements
 */
export interface FABPaymentExtra {
  /** Quote token (signed JWT from service) - REQUIRED */
  quoteToken: string;
  /** Capture mode - OPTIONAL */
  capture?: CaptureMode;
  /** Product/service reference identifier - OPTIONAL */
  reference?: string;
  /** Settlement terms - OPTIONAL */
  settlement?: FABSettlement;
  /** Support/dispute contact information - OPTIONAL */
  support?: FABSupport;
  /** Terms and conditions references - OPTIONAL */
  terms?: FABTerms[];
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
 * This is the structure of the signed JWT in FABPaymentExtra.quoteToken
 */
export interface QuoteTokenPayload {
  /** Issuer - service identity */
  iss: string;
  /** Audience - target Agentic Pay provider(s) */
  aud: string | string[];
  /** Issued at timestamp */
  iat: number;
  /** Expiry timestamp */
  exp: number;
  /** JWT ID - unique quote identifier */
  jti: string;
  /** Price (single or multiple currency options) */
  price: QuoteTokenPrice | QuoteTokenPrice[];
  /** Payment recipient - seller's Agentic Pay ID */
  payTo: string;
  /** Capture mode */
  capture: CaptureMode;
  /** Product/service reference identifier */
  reference: string;
  /** Settlement terms - OPTIONAL */
  settlement?: FABSettlement;
  /** Support/dispute contact information - OPTIONAL */
  support?: FABSupport;
  /** Terms and conditions references - OPTIONAL */
  terms?: FABTerms[];
}

/**
 * Payment context embedded in payment token
 */
export interface PaymentContext {
  /** Transaction ID from Agentic Pay (format: {network}:{id}) */
  transaction_id: string;
  /** Original quote token (signed JWT from service) */
  quote_token: string;
}

/**
 * Payment token JWT payload
 * This is the structure of the signed JWT from Agentic Pay
 */
export interface PaymentTokenPayload {
  /** Issuer - Agentic Pay provider identity */
  iss: string;
  /** Subject - client/buyer identity */
  sub: string;
  /** Audience - service identity */
  aud: string;
  /** Issued at timestamp */
  iat: number;
  /** Expiry timestamp */
  exp: number;
  /** Payment context (transaction ID and quote token) */
  payment_context: PaymentContext;
  /** Confirmation claim for DPoP (optional) */
  cnf?: {
    /** JWK thumbprint of DPoP public key */
    jkt: string;
  };
}

/**
 * FAB payload for x402 PaymentPayload
 */
export interface FABPayloadV2 {
  /** Payment token (signed JWT from Agentic Pay) */
  paymentToken: string;
  /** Transaction ID from Agentic Pay */
  transactionId: string;
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
 * Base error class for all FAB-related errors
 */
export class FABError extends Error {
  /**
   * Create a new FAB error
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
    this.name = 'FABError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, FABError);
    }
  }
}

/**
 * Error thrown when validation fails
 */
export class ValidationError extends FABError {
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
export class SignatureError extends FABError {
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
export class ExpiryError extends FABError {
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
export class MismatchError extends FABError {
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
export class DPoPError extends FABError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'DPOP_ERROR', details);
    this.name = 'DPoPError';
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, DPoPError);
    }
  }
}
