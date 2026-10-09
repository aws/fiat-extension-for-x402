// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * @aws/fiat-extension-for-x402 - Agentic Commerce x402 TypeScript Extension
 *
 * This module provides the Agentic Commerce (Federated Application Billing) implementation
 * for the x402 payment protocol.
 */

// Scheme implementations
export {
  ExactAgenticCommerceServerScheme,
  registerExactAgenticCommerceServer,
  AgenticCommerceFacilitatorScheme,
} from './agentic-commerce';
export type {
  ExactAgenticCommerceServerSchemeConfig,
  RegisterExactAgenticCommerceServerOptions,
} from './agentic-commerce';

// Configuration types
export type {
  AgenticCommerceConfig,
  AgenticCommerceClientForFacilitator,
  AgenticCommerceFacilitatorSchemeConfig,
  QuoteSigner as QuoteSignerInterface,
} from './config';

// Facilitator client implementation
export { InProcessFacilitatorClient } from './facilitator-client';
export { AgenticCommerceFacilitatorClient } from './agentic-commerce/facilitator-client';
export type {
  AgenticCommerceFacilitatorAuthConfig,
  SellerKeyResolver,
  VerifyRequestContext,
} from './agentic-commerce/facilitator-client';

// Signers
export {
  createKmsQuoteSigner,
  toQuoteSigner,
  toPaymentTokenSigner,
  type KmsQuoteSignerConfig,
} from './signers';
export type { QuoteSigner, PaymentTokenSigner } from './signers';

// Types
export type {
  SettlementMethod,
  SettlementCycle,
  AgenticCommerceSettlement,
  AgenticCommerceSupport,
  AgenticCommerceTerms,
  AgenticCommercePaymentExtra,
  QuoteTokenPrice,
  QuoteTokenPayload,
  PaymentContext,
  PaymentTokenPayload,
  AgenticCommercePayloadV2,
  DPoPProofPayload,
  DPoPVerificationOptions,
  DPoPNonceStore,
} from './types';

// Error classes
export {
  AgenticCommerceError,
  ValidationError,
  SignatureError,
  ExpiryError,
  MismatchError,
  DPoPError,
} from './types';

// Constants
export {
  SCHEME_EXACT,
  SETTLEMENT_METHODS,
  SETTLEMENT_CYCLES,
  DEFAULT_QUOTE_VALIDITY_SECONDS,
  DEFAULT_PAYMENT_VALIDITY_SECONDS,
  AGENTIC_COMMERCE_CAIP_FAMILY,
  SENTINEL_PAY_TO,
  DEFAULT_NETWORK,
  PAYMENT_TOKEN_ISSUER,
  WELL_KNOWN_JWKS_PATH,
  WELL_KNOWN_X402_SUPPORTED_PATH,
  QUOTE_TOKEN_AUDIENCE,
  DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL,
} from './constants';

// Utilities
export {
  decodeQuoteToken,
  verifyQuoteToken,
  verifyPaymentToken,
  extractQuoteFromPayment,
  generateTransactionId,
  parseMoneyToDecimal,
  parseTransactionId,
  formatTransactionId,
  isValidTransactionId,
  extractNetworkFromTransactionId,
  fetchServiceJWKS,
  clearServiceJWKSCache,
} from './utils';

// Security utilities
export { ALLOWED_ALGORITHMS, secureCompare, validateUrl } from './security';

// Zod Schemas (runtime validation)
export {
  QuoteTokenPayloadSchema,
  QuoteTokenPriceSchema,
  AgenticCommerceSettlementSchema,
  AgenticCommerceSupportSchema,
  AgenticCommerceTermsSchema,
  AgenticCommercePaymentExtraSchema,
  AgenticCommercePayloadV2Schema,
  parseQuoteToken,
  safeParseQuoteToken,
  parsePaymentPayload,
} from './schemas';

// DPoP (Demonstrating Proof-of-Possession)
export { computeJWKThumbprint, verifyDPoPProof, extractDPoPThumbprint } from './dpop';
