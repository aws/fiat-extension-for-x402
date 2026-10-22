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
  ExactAgenticCommerceFacilitatorScheme,
  registerExactAgenticCommerceServer,
  AgenticCommerceVerifier,
  jwksDocument,
} from './agentic-commerce';
export type {
  ExactAgenticCommerceServerSchemeConfig,
  ExactAgenticCommerceFacilitatorSchemeConfig,
  RegisterExactAgenticCommerceServerOptions,
  AgenticCommerceInvalidReason,
  AgenticCommerceVerifierConfig,
  JwksRequestHeaders,
  VerificationRequirements,
  VerificationResult,
  SellerKeyResolver,
  KmsSellerKeyResolver,
  JwksSellerKeyResolver,
  StaticSellerKeyResolver,
  KmsCredentials,
  KmsPublicKeyClient,
} from './agentic-commerce';

// Facilitator client implementation
export { InProcessFacilitatorClient } from './facilitator-client';
export { AgenticCommerceFacilitatorClient } from './agentic-commerce/facilitator-client';
export type {
  AgenticCommerceFacilitatorAuthConfig,
  AgenticCommerceFacilitatorClientConfig,
} from './agentic-commerce/facilitator-client';

// Signers
export {
  KmsQuoteSigner,
  LocalQuoteSigner,
  type KmsQuoteSignerConfig,
  type FromPemOptions,
} from './signers';
export type { QuoteSigner } from './signers';

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
  SigningError,
  ExpiryError,
  MismatchError,
  DPoPError,
} from './types';

// Constants
export {
  SCHEME_EXACT,
  AGENTIC_COMMERCE_CAIP_FAMILY,
  SENTINEL_PAY_TO,
  DEFAULT_NETWORK,
  PAYMENT_TOKEN_ISSUER,
} from './constants';

// Utilities
export { decodeQuoteToken, parseMoneyToDecimal } from './utils';

// Security utilities
export { ALLOWED_ALGORITHMS, secureCompare, validateUrl } from './security';

// DPoP (Demonstrating Proof-of-Possession)
export { computeJWKThumbprint, verifyDPoPProof, extractDPoPThumbprint } from './dpop';
