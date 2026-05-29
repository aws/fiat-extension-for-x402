// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Constants for the Agent Pay x402 extension
 */

/**
 * Agent Pay scheme identifier
 */
export const AGENT_PAY_SCHEME = 'agent-pay';

/**
 * Agent Pay settlement method codes (Agent Pay-specific, not official ISO 20022)
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
 * CAIP family for Agent Pay (used in facilitator)
 */
export const AGENT_PAY_CAIP_FAMILY = 'aws:*';

/**
 * Default network identifier for AWS Marketplace Agent Pay.
 * Use this constant instead of hardcoding the network string.
 */
export const DEFAULT_NETWORK = 'aws:base';

/**
 * Payment JWT issuer claim value used by the AWS Marketplace Agent Pay Service.
 * This is the `iss` field in Payment JWTs signed by Agent Pay.
 */
export const PAYMENT_JWT_ISSUER = 'awsmp-agentpay.amazonaws.com';

/**
 * Sentinel value for PaymentRequirements.payTo in Agent Pay.
 * 
 * In Agent Pay, the signed quote token is the authoritative source for the payment
 * recipient. The outer PaymentRequirements.payTo field is required by @x402/core
 * but semantically redundant — the quote token's payTo is signed by the service
 * and cannot be tampered with, whereas the outer field is unsigned.
 * 
 * This URN signals to any consumer that the quote token should be consulted
 * for the real payment recipient.
 */
export const AGENT_PAY_SENTINEL_PAY_TO = 'urn:x402:agent-pay:see-quote';

// ============================================================================
// Well-Known Paths
// ============================================================================

/**
 * Path to the JWKS endpoint for public key discovery.
 * Used to verify payment token and quote token signatures.
 */
export const WELL_KNOWN_JWKS_PATH = '/.well-known/jwks.json';

/**
 * Path to the x402 supported kinds endpoint.
 * Used during facilitator routing to discover which schemes/networks are supported.
 */
export const WELL_KNOWN_X402_SUPPORTED_PATH = '/.well-known/x402-supported';

/**
 * Path to the OIDC discovery endpoint.
 * Used for wallet/provider endpoint discovery (optional — not required by Agent Pay).
 */
export const WELL_KNOWN_OIDC_PATH = '/.well-known/openid-configuration';

/**
 * The audience identifier for the AWS Marketplace Agent Pay Service.
 * This is the `aud` claim in quote tokens — it identifies WHO processes the token,
 * not which network/rail is used. A single audience (the Agent Pay service) can
 * support multiple networks.
 */
export const AGENT_PAY_AUDIENCE = 'aws:marketplace';

/**
 * Default base URL for Agent Pay's JWKS (signing key) endpoint.
 * The SDK appends /.well-known/jwks.json to this automatically.
 * Override via the jwksBaseUrl constructor parameter for beta/testing.
 */
export const AGENT_PAY_JWKS_BASE_URL = 'https://d3aeb2cjjowogc.cloudfront.net';

/**
/**
 * Default base URL for the Agent Pay service endpoint.
 * Used when `agentPayBaseUrl` is not provided in client options.
 * Override for beta testing: 'https://beta.agentpay.marketplace.aws.dev'
 */
export const DEFAULT_AGENT_PAY_BASE_URL = 'https://prod.agentpay.marketplace.aws.dev';
