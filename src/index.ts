/**
 * aws-agent-pay-x402 - Agent Pay x402 TypeScript Extension
 * 
 * This module provides the Agent Pay (Federated Application Billing) implementation
 * for the x402 payment protocol.
 */

// Scheme implementations
export { AgentPayClientScheme, AgentPayServerScheme, AgentPayFacilitatorScheme } from './agent-pay';

// Pre-configured network schemes
export { AgentPayAWSClientScheme, AgentPayAWSServerScheme, AgentPayAWSFacilitatorScheme } from './networks';

// Configuration types
export type {
  SigningKeysConfig,
  AgentPayConfig,
  AgentPayClientForClient,
  AgentPayClientForFacilitator,
  AgentPayClient,
  AgentPayClientSchemeConfig,
  AgentPayServerSchemeConfig,
  AgentPayFacilitatorSchemeConfig,
  ServiceAgentPaySigner as ServiceAgentPaySignerInterface,
  DpopJwk,
  CreateAgentPaymentRequest,
  CreateAgentPaymentResponse,
  GetAgentPaymentResponse,
  ListAgentPaymentsRequest,
  ListAgentPaymentsResponse
} from './config';

// Agent Pay client implementation
export { DefaultAgentPayClient } from './agent-pay-client';

// Facilitator client implementation
export { InProcessFacilitatorClient } from './facilitator-client';
export { AgentPayFacilitatorClient } from './agent-pay-facilitator-client';
export type { AgentPayFacilitatorAuthConfig } from './agent-pay-facilitator-client';

// Signers
export { toServiceAgentPaySigner, toAgentPaySigner } from './signer';
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
  DPoPKeyPair,
  DPoPProofPayload,
  DPoPProofOptions,
  DPoPVerificationOptions,
  DPoPNonceStore
} from './types';

// Error classes
export {
  AgentPayError,
  ValidationError,
  SignatureError,
  ExpiryError,
  MismatchError,
  DPoPError,
  IdempotencyConflictError
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

// Agent Pay Discovery
export {
  getAgentPayBaseUrl,
  discoverAgentPayEndpoints,
  fetchAgentPayPublicKeys,
  clearDiscoveryCache,
  clearJWKSCache
} from './discovery';
export type { AgentPayDiscoveryMetadata } from './discovery';

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
  agentPayMiddleware,
  type AgentPayMiddlewareConfig,
  type AgentPayRouteConfig,
  type AgentPayRoutesConfig,
  type PaymentInfo,
} from './middleware';

// Builders (network-aware facilitator routing)
export {
  createAgentPayResourceServer,
  createAgentPayClient,
  buildAgentPayResourceServer,
  buildAgentPayClient,
  registerAgentPayNetworks
} from './builders';
export type {
  AgentPayResourceServerOptions,
  AgentPayResourceServer,
  NetworkOptions,
  InitializeOptions,
  AgentPayClientOptions,
  AgentPayClientBuilder,
  AgentPayResourceServerConfig,
  AgentPayClientConfig
} from './builders';
