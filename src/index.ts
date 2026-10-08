// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * @aws/fiat-extension-for-x402 - Agent Pay x402 TypeScript Extension
 *
 * This module provides the Agent Pay (Federated Application Billing) implementation
 * for the x402 payment protocol.
 */

// Scheme implementations
export { AgentPayServerScheme, AgentPayFacilitatorScheme } from './agent-pay';

// Pre-configured network schemes
export { AgentPayAWSServerScheme, AgentPayAWSFacilitatorScheme } from './networks';

// Configuration types
export type {
  SigningKeysConfig,
  AgentPayConfig,
  AgentPayClientForFacilitator,
  AgentPayServerSchemeConfig,
  AgentPayFacilitatorSchemeConfig,
  ServiceAgentPaySigner as ServiceAgentPaySignerInterface,
} from './config';

// Facilitator client implementation
export { InProcessFacilitatorClient } from './facilitator-client';
export { AgentPayFacilitatorClient } from './agent-pay-facilitator-client';
export type {
  AgentPayFacilitatorAuthConfig,
  SellerKeyResolver,
  VerifyRequestContext,
} from './agent-pay-facilitator-client';

// Signers
export { toServiceAgentPaySigner, toAgentPaySigner } from './signer';
export { createKmsSigner, type KmsSignerConfig } from './signers';
export type { ServiceAgentPaySigner, AgentPaySigner } from './signer';

// Types
export type {
  SettlementMethod,
  SettlementCycle,
  AgentPaySettlement,
  AgentPaySupport,
  AgentPayTerms,
  AgentPayPaymentExtra,
  QuoteTokenPrice,
  QuoteTokenPayload,
  PaymentContext,
  PaymentTokenPayload,
  AgentPayPayloadV2,
  DPoPProofPayload,
  DPoPVerificationOptions,
  DPoPNonceStore,
} from './types';

// Error classes
export {
  AgentPayError,
  ValidationError,
  SignatureError,
  ExpiryError,
  MismatchError,
  DPoPError,
} from './types';

// Constants
export {
  AGENT_PAY_SCHEME,
  SETTLEMENT_METHODS,
  SETTLEMENT_CYCLES,
  DEFAULT_QUOTE_VALIDITY_SECONDS,
  DEFAULT_PAYMENT_VALIDITY_SECONDS,
  AGENT_PAY_CAIP_FAMILY,
  AGENT_PAY_SENTINEL_PAY_TO,
  DEFAULT_NETWORK,
  PAYMENT_JWT_ISSUER,
  WELL_KNOWN_JWKS_PATH,
  WELL_KNOWN_X402_SUPPORTED_PATH,
  AGENT_PAY_AUDIENCE,
  AGENT_PAY_JWKS_BASE_URL,
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
  AgentPaySettlementSchema,
  AgentPaySupportSchema,
  AgentPayTermsSchema,
  AgentPayPaymentExtraSchema,
  AgentPayPayloadV2Schema,
  parseQuoteToken,
  safeParseQuoteToken,
  parsePaymentPayload,
} from './schemas';

// DPoP (Demonstrating Proof-of-Possession)
export { computeJWKThumbprint, verifyDPoPProof, extractDPoPThumbprint } from './dpop';

// Express Middleware
export {
  agentPayMiddleware,
  type AgentPayMiddlewareConfig,
  type AgentPayRouteConfig,
  type AgentPayRoutesConfig,
  type PaymentInfo,
} from './middleware';

// Builders (network-aware facilitator routing)
export {
  createAgentPayResourceServer,
  buildAgentPayResourceServer,
  registerAgentPayNetworks,
} from './builders';
export type {
  AgentPayResourceServerOptions,
  AgentPayResourceServer,
  NetworkOptions,
  InitializeOptions,
  AgentPayResourceServerConfig,
} from './builders';
