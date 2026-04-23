/**
 * Constants for the FAB x402 extension
 */

/**
 * FAB scheme identifier
 */
export const FAB_SCHEME = 'fab';

/**
 * FAB settlement method codes (FAB-specific, not official ISO 20022)
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
 * CAIP family for FAB (used in facilitator)
 */
export const FAB_CAIP_FAMILY = 'fab:*';

/**
 * Sentinel value for PaymentRequirements.payTo in FAB.
 * 
 * In FAB, the signed quote token is the authoritative source for the payment
 * recipient. The outer PaymentRequirements.payTo field is required by @x402/core
 * but semantically redundant — the quote token's payTo is signed by the service
 * and cannot be tampered with, whereas the outer field is unsigned.
 * 
 * This URN signals to any consumer that the quote token should be consulted
 * for the real payment recipient.
 */
export const FAB_SENTINEL_PAY_TO = 'urn:x402:fab:see-quote';
