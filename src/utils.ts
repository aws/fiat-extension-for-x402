// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Utility functions for Agent Pay x402 extension
 */

import { webcrypto } from 'node:crypto';
import * as jose from 'jose';
import { WELL_KNOWN_JWKS_PATH } from './constants';
import {
  QuoteTokenPayload,
  PaymentTokenPayload,
  ValidationError,
  SignatureError,
  ExpiryError
} from './types';

// Use Node.js crypto for UUID generation
const crypto = webcrypto;

/**
 * Decode a quote token without verification
 * @param token - Quote token JWT
 * @returns Decoded quote token payload
 */
export function decodeQuoteToken(token: string): QuoteTokenPayload {
  try {
    return jose.decodeJwt(token) as QuoteTokenPayload;
  } catch (error) {
    throw new ValidationError('Invalid quote token format', { error });
  }
}

/**
 * Verify a quote token signature
 * @param token - Quote token JWT
 * @param publicKey - Public key for verification
 * @returns Verified quote token payload
 */
export async function verifyQuoteToken(
  token: string,
  publicKey: jose.JWK | jose.KeyLike
): Promise<QuoteTokenPayload> {
  try {
    const { payload } = await jose.jwtVerify(token, publicKey);
    
    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new ExpiryError('Quote token expired', payload.exp, now);
    }
    
    return payload as unknown as QuoteTokenPayload;
  } catch (error) {
    if (error instanceof ExpiryError) throw error;
    throw new SignatureError('Quote token signature verification failed', 'quote');
  }
}

/**
 * Verify a payment token signature
 * @param token - Payment token JWT
 * @param publicKey - Public key for verification
 * @returns Verified payment token payload
 */
export async function verifyPaymentToken(
  token: string,
  publicKey: jose.JWK | jose.KeyLike
): Promise<PaymentTokenPayload> {
  try {
    const { payload } = await jose.jwtVerify(token, publicKey);
    
    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      throw new ExpiryError('Payment token expired', payload.exp, now);
    }
    
    return payload as unknown as PaymentTokenPayload;
  } catch (error) {
    if (error instanceof ExpiryError) throw error;
    throw new SignatureError('Payment token signature verification failed', 'payment');
  }
}

/**
 * Extract quote token from payment token
 * @param payment - Payment token payload
 * @returns Quote token JWT string
 */
export function extractQuoteFromPayment(payment: PaymentTokenPayload): string {
  // Agent Pay returns quote_token at top level; fallback to payment_context for backward compat
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- pre-existing `any` fallback, tracked with the no-explicit-any cleanup
  return (payment as any).quote_token || payment.payment_context?.quote_token;
}

/**
 * Generate a transaction ID
 * @param network - Network identifier (e.g., "aws:base")
 * @param agentPayId - Agent Pay identifier
 * @returns Transaction ID in format {network}:{uniqueId}
 */
export function generateTransactionId(network: string, agentPayId: string): string {
  const uniqueId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  return `${network}:${uniqueId}`;
}

/**
 * Parse money string/number to decimal amount and currency
 * @param money - Money value (e.g., "$1.50", "1.50 USD", 1.50)
 * @returns Parsed amount and currency
 */
export function parseMoneyToDecimal(
  money: string | number
): { amount: number; currency: string } {
  if (typeof money === 'number') {
    return { amount: money, currency: 'USD' };
  }

  // Handle formats like "$1.50", "1.50 USD", "1.50"
  const match = money.match(/^\$?(\d+\.?\d*)\s*([A-Z]{3})?$/);
  if (!match) {
    throw new ValidationError(`Invalid money format: ${money}`);
  }

  return {
    amount: parseFloat(match[1]),
    currency: match[2] || 'USD'
  };
}

/**
 * Parse transaction ID into components
 * @param transactionId - Transaction ID (format: {network}:{id})
 * @returns Network and ID components
 */
export function parseTransactionId(transactionId: string): { network: string; id: string } {
  const parts = transactionId.split(':');
  if (parts.length < 2) {
    throw new ValidationError(
      'Invalid transaction ID format. Expected {network}:{id}',
      { transactionId }
    );
  }
  
  const network = parts.slice(0, -1).join(':');
  const id = parts[parts.length - 1];
  
  if (!network || !id) {
    throw new ValidationError(
      'Invalid transaction ID format. Expected {network}:{id}',
      { transactionId }
    );
  }
  
  return { network, id };
}

/**
 * Format transaction ID from components
 * @param network - Network identifier
 * @param id - Transaction ID
 * @returns Formatted transaction ID
 */
export function formatTransactionId(network: string, id: string): string {
  if (!network || !network.includes(':')) {
    throw new ValidationError('Network must be in scheme:provider format', { network });
  }
  return `${network}:${id}`;
}

/**
 * Check if transaction ID is valid
 * @param transactionId - Transaction ID to validate
 * @returns True if valid, false otherwise
 */
export function isValidTransactionId(transactionId: string): boolean {
  try {
    parseTransactionId(transactionId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract network from transaction ID
 * @param transactionId - Transaction ID
 * @returns Network identifier
 */
export function extractNetworkFromTransactionId(transactionId: string): string {
  return parseTransactionId(transactionId).network;
}

// ============================================================================
// Service JWKS Cache
// ============================================================================

interface ServiceJWKSCacheEntry {
  jwks: ReturnType<typeof jose.createRemoteJWKSet>;
  expiresAt: number;
}

const serviceJWKSCache = new Map<string, ServiceJWKSCacheEntry>();
const SERVICE_JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Fetch service's JWKS for quote token signature verification.
 * Returns a jose remote JWK set function that can be passed to jwtVerify.
 * Results are cached for 1 hour.
 *
 * @param serviceUrl - Service URL (the quote token's `iss` claim)
 * @returns A function compatible with jose.jwtVerify's key argument
 */
export function fetchServiceJWKS(
  serviceUrl: string
): ReturnType<typeof jose.createRemoteJWKSet> {
  const jwksUrl = `${serviceUrl.replace(/\/$/, '')}${WELL_KNOWN_JWKS_PATH}`;
  const now = Date.now();

  const cached = serviceJWKSCache.get(jwksUrl);
  if (cached && cached.expiresAt > now) {
    return cached.jwks;
  }

  const jwks = jose.createRemoteJWKSet(new URL(jwksUrl));

  serviceJWKSCache.set(jwksUrl, {
    jwks,
    expiresAt: now + SERVICE_JWKS_CACHE_TTL_MS,
  });

  return jwks;
}

/**
 * Clear the service JWKS cache.
 * @param serviceUrl - Optional service URL to clear a specific entry. If omitted, clears all.
 */
export function clearServiceJWKSCache(serviceUrl?: string): void {
  if (serviceUrl) {
    const jwksUrl = `${serviceUrl.replace(/\/$/, '')}${WELL_KNOWN_JWKS_PATH}`;
    serviceJWKSCache.delete(jwksUrl);
  } else {
    serviceJWKSCache.clear();
  }
}

/**
 * Fetch service public key from OIDC discovery
 * @deprecated Use fetchServiceJWKS instead — it returns a JWKS set compatible with jose.jwtVerify
 * @param serviceUrl - Service URL
 * @returns Public key in JWK format
 */
export async function fetchServicePublicKey(serviceUrl: string): Promise<jose.JWK> {
  throw new Error(
    'fetchServicePublicKey is deprecated. Use fetchServiceJWKS() instead, ' +
    'which returns a JWKS set compatible with jose.jwtVerify.'
  );
}
