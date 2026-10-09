// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * DPoP (Demonstrating Proof-of-Possession) Module
 *
 * Provides proof verification and JWK thumbprints for DPoP token binding
 * as specified in RFC 9449.
 */

export { verifyDPoPProof, extractDPoPThumbprint, computeJWKThumbprint } from './verification';

// Re-export types
export type { DPoPProofPayload, DPoPVerificationOptions, DPoPNonceStore } from '../types';
