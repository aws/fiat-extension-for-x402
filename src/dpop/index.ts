/**
 * DPoP (Demonstrating Proof-of-Possession) Module
 * 
 * Provides key generation, proof creation, and proof verification
 * for DPoP token binding as specified in RFC 9449.
 */

export { generateDPoPKeyPair, toDpopJwk, type DPoPAlgorithm } from './key-generation';
export { createDPoPProof, computeJWKThumbprint } from './proof-creation';
export { verifyDPoPProof, extractDPoPThumbprint } from './proof-verification';

// Re-export types
export type {
  DPoPKeyPair,
  DPoPProofPayload,
  DPoPProofOptions,
  DPoPVerificationOptions,
  DPoPNonceStore,
} from '../types';
