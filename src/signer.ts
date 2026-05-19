// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Signer interfaces and adapters for Agent Pay JWT operations
 * 
 * Agent Pay uses JWT signing instead of crypto Agent Pay signing.
 * This module provides interfaces and adapter functions for both
 * service-side (quote token signing) and Agent Pay-side (payment token signing).
 */

import * as jose from 'jose';
import { QuoteTokenPayload, PaymentTokenPayload } from './types';

/**
 * Signer for service-side operations (quote token signing)
 */
export interface ServiceAgentPaySigner {
  /**
   * Sign a quote token JWT
   * @param payload - Quote token payload to sign
   * @returns Signed JWT string
   */
  signQuote(payload: QuoteTokenPayload): Promise<string>;
  
  /**
   * Get the public key for verification (JWK format)
   * @returns Public key in JWK format
   */
  getPublicKey(): jose.JWK;
  
  /**
   * Get the service URL (issuer)
   * @returns Service URL
   */
  getServiceUrl(): string;
}

/**
 * Signer for Agent Pay-side operations (payment token signing)
 */
export interface AgentPaySigner {
  /**
   * Sign a payment token JWT
   * @param payload - Payment token payload to sign
   * @returns Signed JWT string
   */
  signPayment(payload: PaymentTokenPayload): Promise<string>;
  
  /**
   * Get the public key for verification (JWK format)
   * @returns Public key in JWK format
   */
  getPublicKey(): jose.JWK;
  
  /**
   * Get Agent Pay addresses (for facilitator supported endpoint)
   * @returns Array of Agent Pay IDs
   */
  getAddresses(): string[];
}

/**
 * Convert a jose KeyLike to a ServiceAgentPaySigner
 * 
 * @param privateKey - Private key for signing (RS256 or ES256)
 * @param publicKey - Public key in JWK format
 * @param serviceUrl - Service URL (issuer)
 * @returns ServiceAgentPaySigner instance
 * 
 * @example
 * ```typescript
 * import { generateKeyPair, exportJWK } from 'jose';
 * 
 * const { privateKey, publicKey } = await generateKeyPair('RS256');
 * const publicJWK = await exportJWK(publicKey);
 * 
 * const signer = toServiceAgentPaySigner(
 *   privateKey,
 *   publicJWK,
 *   'https://api.service.com'
 * );
 * ```
 */
export function toServiceAgentPaySigner(
  privateKey: jose.KeyLike,
  publicKey: jose.JWK,
  serviceUrl: string
): ServiceAgentPaySigner {
  return {
    async signQuote(payload: QuoteTokenPayload): Promise<string> {
      return await new jose.SignJWT(payload as any)
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .sign(privateKey);
    },
    getPublicKey(): jose.JWK {
      return publicKey;
    },
    getServiceUrl(): string {
      return serviceUrl;
    }
  };
}

/**
 * Convert a jose KeyLike to a AgentPaySigner
 * 
 * @param privateKey - Private key for signing (RS256 or ES256)
 * @param publicKey - Public key in JWK format
 * @param agentPayId - Agent Pay identifier
 * @returns AgentPaySigner instance
 * 
 * @example
 * ```typescript
 * import { generateKeyPair, exportJWK } from 'jose';
 * 
 * const { privateKey, publicKey } = await generateKeyPair('RS256');
 * const publicJWK = await exportJWK(publicKey);
 * 
 * const signer = toAgentPaySigner(
 *   privateKey,
 *   publicJWK,
 *   'agent-pay-provider-id'
 * );
 * ```
 */
export function toAgentPaySigner(
  privateKey: jose.KeyLike,
  publicKey: jose.JWK,
  agentPayId: string
): AgentPaySigner {
  return {
    async signPayment(payload: PaymentTokenPayload): Promise<string> {
      return await new jose.SignJWT(payload as any)
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
        .sign(privateKey);
    },
    getPublicKey(): jose.JWK {
      return publicKey;
    },
    getAddresses(): string[] {
      return [agentPayId];
    }
  };
}
