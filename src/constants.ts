/**
 * Constants for the Agentic Pay x402 extension
 */

/**
 * Agentic Pay scheme identifier
 */
export const AGENTIC_PAY_SCHEME = 'aws:marketplace';

/**
 * Agentic Pay settlement method codes (Agentic Pay-specific, not official ISO 20022)
 */
export const SETTLEMENT_METHODS = {
  INST: 'INST', // Instant settlement
  CLRG: 'CLRG', // Clearing/batch settlement
  CRDT: 'CRDT', // Credit/invoice settlement
} as const;

/**
 * Settlement cycle codes
 */
export const SETTLEMENT_CYCLES = {
  MNTH: 'MNTH', // Monthly
  WEEK: 'WEEK', // Weekly
  QRTR: 'QRTR', // Quarterly
} as const;

/**
 * Default quote token validity (5 minutes)
 */
export const DEFAULT_QUOTE_VALIDITY_SECONDS = 300;

/**
 * Default payment token validity (1 hour)
 */
export const DEFAULT_PAYMENT_VALIDITY_SECONDS = 3600;

/**
 * CAIP family for Agentic Pay (used in facilitator)
 */
export const AGENTIC_PAY_CAIP_FAMILY = 'aws:*';

/**
 * Default network identifier for AWS Marketplace Agent Pay.
 * Use this constant instead of hardcoding the network string.
 */
export const DEFAULT_NETWORK = 'aws:marketplace';

/**
 * Sentinel value for PaymentRequirements.payTo in Agentic Pay.
 * 
 * In Agentic Pay, the signed quote token is the authoritative source for the payment
 * recipient. The outer PaymentRequirements.payTo field is required by @x402/core
 * but semantically redundant — the quote token's payTo is signed by the service
 * and cannot be tampered with, whereas the outer field is unsigned.
 * 
 * This URN signals to any consumer that the quote token should be consulted
 * for the real payment recipient.
 */
export const AGENTIC_PAY_SENTINEL_PAY_TO = 'urn:x402:agentic-pay:see-quote';
