// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Constants for the Agentic Commerce x402 extension
 */

/**
 * x402 scheme identifier of Agentic Commerce payments
 */
export const SCHEME_EXACT = 'exact';

/**
 * Default asset: prices are fiat amounts identified by ISO 4217 currency code.
 */
export const DEFAULT_ASSET = 'iso4217:USD';

/**
 * Asset transfer method the `exact` server scheme declares to x402 core. Core
 * reads it only when `extra.assetTransferMethod` is absent, so it never appears
 * on the wire.
 */
export const ASSET_TRANSFER_METHOD = 'payment-token';

/**
 * Requirement `extra` fields that change on every 402 and are therefore excluded
 * when x402 core matches a buyer's `accepted` requirements against the route's.
 */
export const DYNAMIC_EXTRA_FIELDS: readonly string[] = Object.freeze(['quoteToken']);

/**
 * Default quote token validity (5 minutes)
 */
export const DEFAULT_QUOTE_VALIDITY_SECONDS = 300;

/**
 * CAIP family for Agentic Commerce (used in facilitator)
 */
export const AGENTIC_COMMERCE_CAIP_FAMILY = 'aws:*';

/**
 * Default network identifier for AWS Marketplace Agentic Commerce.
 * Use this constant instead of hardcoding the network string.
 */
export const DEFAULT_NETWORK = 'aws:base';

/**
 * `iss` claim of every payment token issued by the AWS Marketplace Agentic
 * Commerce service. The value is set by the service and is the only service
 * literal in this package.
 */
export const PAYMENT_TOKEN_ISSUER = 'awsmp-agentpay.amazonaws.com';

/**
 * Sentinel value for PaymentRequirements.payTo in Agentic Commerce.
 *
 * In Agentic Commerce, the signed quote token is the authoritative source for the payment
 * recipient. The outer PaymentRequirements.payTo field is required by @x402/core
 * but semantically redundant — the quote token's payTo is signed by the service
 * and cannot be tampered with, whereas the outer field is unsigned.
 *
 * This URN signals to any consumer that the quote token should be consulted
 * for the real payment recipient.
 */
export const SENTINEL_PAY_TO = 'urn:x402:agentic-commerce:see-quote';

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
 * The audience identifier for the AWS Marketplace Agentic Commerce Service.
 * This is the `aud` claim in quote tokens — it identifies WHO processes the token,
 * not which network/rail is used. A single audience (the Agentic Commerce service) can
 * support multiple networks.
 */
export const QUOTE_TOKEN_AUDIENCE = 'aws:marketplace';

/**
 * Default base URL for Agentic Commerce's JWKS (signing key) endpoint.
 * The SDK appends /.well-known/jwks.json to this automatically.
 * Override it with the verifier's paymentTokenJwksUrl option.
 */
export const DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL =
  'https://agenticcommerce-marketplace.us-east-1.api.aws';
