/**
 * @x402/fab - FAB x402 TypeScript Extension
 * 
 * This module provides the FAB (Federated Application Billing) implementation
 * for the x402 payment protocol.
 */

// Scheme implementations
export { FABClientScheme, FABServerScheme, FABFacilitatorScheme } from './fab';

// Pre-configured network schemes
export { FABAWSClientScheme, FABAWSServerScheme, FABAWSFacilitatorScheme } from './networks';

// Configuration types
export type {
  SigningKeysConfig,
  WalletConfig,
  WalletClientForClient,
  WalletClientForFacilitator,
  WalletClient,
  FABClientSchemeConfig,
  FABServerSchemeConfig,
  FABFacilitatorSchemeConfig,
  ServiceFABSigner as ServiceFABSignerInterface
} from './config';

// Wallet client implementation
export { DefaultWalletClient } from './wallet-client';

// Facilitator client implementation
export { InProcessFacilitatorClient } from './facilitator-client';
export { WalletFacilitatorClient } from './wallet-facilitator-client';
export type { WalletFacilitatorAuthConfig } from './wallet-facilitator-client';

// Signers
export { toServiceFABSigner, toWalletFABSigner } from './signer';
export type { ServiceFABSigner, WalletFABSigner } from './signer';

// Types
export type {
  CaptureMode,
  SettlementMethod,
  SettlementCycle,
  FABSettlement,
  FABSupport,
  FABTerms,
  FABPaymentExtra,
  QuoteTokenPrice,
  QuoteTokenPayload,
  PaymentContext,
  PaymentTokenPayload,
  FABPayloadV2,
  DPoPKeyPair,
  DPoPProofPayload,
  DPoPProofOptions,
  DPoPVerificationOptions,
  DPoPNonceStore
} from './types';

// Error classes
export {
  FABError,
  ValidationError,
  SignatureError,
  ExpiryError,
  MismatchError,
  DPoPError
} from './types';

// Constants
export {
  FAB_SCHEME,
  SETTLEMENT_METHODS,
  SETTLEMENT_CYCLES,
  DEFAULT_QUOTE_VALIDITY_SECONDS,
  DEFAULT_PAYMENT_VALIDITY_SECONDS,
  FAB_CAIP_FAMILY,
  FAB_SENTINEL_PAY_TO
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

// Wallet Discovery
export {
  getWalletBaseUrl,
  discoverWalletEndpoints,
  fetchWalletPublicKeys,
  clearDiscoveryCache,
  clearJWKSCache
} from './discovery';
export type { WalletDiscoveryMetadata } from './discovery';

// DPoP (Demonstrating Proof-of-Possession)
export {
  generateDPoPKeyPair,
  createDPoPProof,
  computeJWKThumbprint,
  verifyDPoPProof,
  extractDPoPThumbprint,
  type DPoPAlgorithm
} from './dpop';

// Express Middleware
export {
  fabPaymentMiddleware,
  type FABMiddlewareConfig,
  type FABRouteConfig,
  type FABRoutesConfig,
  type PaymentInfo,
} from './middleware';

// Builders (network-aware facilitator routing)
export {
  createFABResourceServer,
  createFABClient,
  buildFABResourceServer,
  buildFABClient,
  registerFABNetworks
} from './builders';
export type {
  FABResourceServerOptions,
  FABResourceServer,
  NetworkOptions,
  InitializeOptions,
  FABClientOptions,
  FABClient,
  FABResourceServerConfig,
  FABClientConfig
} from './builders';
