/**
 * @x402/aws-agentic-pay - Agentic Pay x402 TypeScript Extension
 * 
 * This module provides the Agentic Pay (Federated Application Billing) implementation
 * for the x402 payment protocol.
 */

// Scheme implementations
export { AgenticPayClientScheme, AgenticPayServerScheme, AgenticPayFacilitatorScheme } from './agentic-pay';

// Pre-configured network schemes
export { AgenticPayAWSClientScheme, AgenticPayAWSServerScheme, AgenticPayAWSFacilitatorScheme } from './networks';

// Configuration types
export type {
  SigningKeysConfig,
  AgenticPayConfig,
  AgenticPayClientForClient,
  AgenticPayClientForFacilitator,
  AgenticPayClient,
  AgenticPayClientSchemeConfig,
  AgenticPayServerSchemeConfig,
  AgenticPayFacilitatorSchemeConfig,
  ServiceAgenticPaySigner as ServiceAgenticPaySignerInterface,
  DpopJwk,
  CreateAgentPaymentRequest,
  CreateAgentPaymentResponse,
  GetAgentPaymentResponse,
  ListAgentPaymentsRequest,
  ListAgentPaymentsResponse
} from './config';

// Agentic Pay client implementation
export { DefaultAgenticPayClient } from './agentic-pay-client';

// Facilitator client implementation
export { InProcessFacilitatorClient } from './facilitator-client';
export { AgenticPayFacilitatorClient } from './agentic-pay-facilitator-client';
export type { AgenticPayFacilitatorAuthConfig } from './agentic-pay-facilitator-client';

// Signers
export { toServiceAgenticPaySigner, toAgenticPaySigner } from './signer';
export type { ServiceAgenticPaySigner, AgenticPaySigner } from './signer';

// Types
export type {
  SettlementMethod,
  SettlementCycle,
  AgenticPaySettlement,
  AgenticPaySupport,
  AgenticPayTerms,
  AgenticPayPaymentExtra,
  QuoteTokenPrice,
  QuoteTokenPayload,
  PaymentContext,
  PaymentTokenPayload,
  AgenticPayPayloadV2,
  DPoPKeyPair,
  DPoPProofPayload,
  DPoPProofOptions,
  DPoPVerificationOptions,
  DPoPNonceStore
} from './types';

// Error classes
export {
  AgenticPayError,
  ValidationError,
  SignatureError,
  ExpiryError,
  MismatchError,
  DPoPError,
  IdempotencyConflictError
} from './types';

// Constants
export {
  AGENTIC_PAY_SCHEME,
  SETTLEMENT_METHODS,
  SETTLEMENT_CYCLES,
  DEFAULT_QUOTE_VALIDITY_SECONDS,
  DEFAULT_PAYMENT_VALIDITY_SECONDS,
  AGENTIC_PAY_CAIP_FAMILY,
  AGENTIC_PAY_SENTINEL_PAY_TO,
  DEFAULT_NETWORK
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
  clearServiceJWKSCache
} from './utils';

// Agentic Pay Discovery
export {
  getAgenticPayBaseUrl,
  discoverAgenticPayEndpoints,
  fetchAgenticPayPublicKeys,
  clearDiscoveryCache,
  clearJWKSCache
} from './discovery';
export type { AgenticPayDiscoveryMetadata } from './discovery';

// Security utilities
export { ALLOWED_ALGORITHMS, secureCompare, validateUrl } from './security';

// DPoP (Demonstrating Proof-of-Possession)
export {
  generateDPoPKeyPair,
  toDpopJwk,
  createDPoPProof,
  computeJWKThumbprint,
  verifyDPoPProof,
  extractDPoPThumbprint,
  type DPoPAlgorithm
} from './dpop';

// Express Middleware
export {
  agenticPayMiddleware,
  type AgenticPayMiddlewareConfig,
  type AgenticPayRouteConfig,
  type AgenticPayRoutesConfig,
  type PaymentInfo,
} from './middleware';

// Builders (network-aware facilitator routing)
export {
  createAgenticPayResourceServer,
  createAgenticPayClient,
  buildAgenticPayResourceServer,
  buildAgenticPayClient,
  registerAgenticPayNetworks
} from './builders';
export type {
  AgenticPayResourceServerOptions,
  AgenticPayResourceServer,
  NetworkOptions,
  InitializeOptions,
  AgenticPayClientOptions,
  AgenticPayClientBuilder,
  AgenticPayResourceServerConfig,
  AgenticPayClientConfig
} from './builders';
