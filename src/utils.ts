// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Utility functions for Agentic Commerce x402 extension
 */

import { webcrypto } from 'node:crypto';
import * as jose from 'jose';
import { WELL_KNOWN_JWKS_PATH } from './constants';
import {
  QuoteTokenPayload,
  PaymentTokenPayload,
  ValidationError,
  SignatureError,
  ExpiryError,
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
  // Agentic Commerce returns quote_token at top level; fallback to payment_context for backward compat
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- pre-existing `any` fallback, tracked with the no-explicit-any cleanup
  return (payment as any).quote_token || payment.payment_context?.quote_token;
}

/**
 * Generate a transaction ID
 * @param network - Network identifier (e.g., "aws:base")
 * @param agenticCommerceId - Agentic Commerce identifier
 * @returns Transaction ID in format {network}:{uniqueId}
 */
export function generateTransactionId(network: string, agenticCommerceId: string): string {
  const uniqueId = crypto.randomUUID().replace(/-/g, '').substring(0, 16);
  return `${network}:${uniqueId}`;
}

// Money amounts in route prices: a string such as "$1.50" or "1.50 USD", or a
// number (AssetAmount objects are handled by the server scheme). Only ASCII
// digits are accepted.

// The whitespace prices and identifiers may be padded with: the Unicode
// White_Space characters plus the separators U+001C to U+001F. JavaScript's `\s`
// also matches U+FEFF and misses U+001C to U+001F and U+0085.
const WHITESPACE_CLASS = String.raw`[\t-\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`;
const WHITESPACE = new RegExp(WHITESPACE_CLASS);

// "$1.50", "1.50 USD", "1.50": a non-negative decimal with an optional leading
// "$" and an optional trailing ISO 4217 code. Every quantifier is
// followed by a disjoint character class, so matching is linear in the input length.
const MONEY_PATTERN = new RegExp(
  String.raw`^\$?(\d+(?:\.(\d+))?)` + WHITESPACE_CLASS + String.raw`*([A-Z]{3})?$`
);

// The payment service rejects prices with more decimal places than this.
const MAX_PRICE_DECIMAL_PLACES = 8;

/** Trims the same whitespace as MONEY_PATTERN from both ends, without a regex. */
export function stripWhitespace(value: string): string {
  let start = 0;
  let end = value.length;
  while (start < end && WHITESPACE.test(value[start])) start++;
  while (end > start && WHITESPACE.test(value[end - 1])) end--;
  return value.slice(start, end);
}

/**
 * Write a finite, non-negative number in plain decimal notation, never exponent
 * form: 1e-7 becomes "0.0000001". A number has no trailing-zero or sign-of-zero
 * information, so 1.0 gives "1" and -0 gives "0".
 */
function toPlainDecimal(value: number): { amount: string; decimalPlaces: number } {
  // String() gives the shortest digits that round-trip to the same number.
  const [mantissa, exponent = '0'] = String(value).split('e');
  const [integerPart, fractionPart = ''] = mantissa.split('.');
  const digits = integerPart + fractionPart;
  const point = integerPart.length + Number(exponent);
  const decimalPlaces = Math.max(0, digits.length - point);
  if (point <= 0) {
    return { amount: `0.${'0'.repeat(-point)}${digits}`, decimalPlaces };
  }
  if (point >= digits.length) {
    return { amount: digits + '0'.repeat(point - digits.length), decimalPlaces };
  }
  return { amount: `${digits.slice(0, point)}.${digits.slice(point)}`, decimalPlaces };
}

/**
 * Parse a route price into a decimal amount string and an ISO 4217 currency code.
 *
 * A string amount is kept verbatim ("$01.50" gives "01.50"); a number is written
 * in plain notation. A missing currency code means USD.
 *
 * @param money - Money value (e.g., "$1.50", "1.50 USD", 1.50)
 * @returns Parsed amount and currency
 * @throws ValidationError if the price does not match the pattern, is negative or
 * not finite, or has more than 8 decimal places
 */
export function parseMoney(money: string | number): { amount: string; currency: string } {
  const shown = () => (typeof money === 'string' ? JSON.stringify(money) : String(money));
  let amount: string;
  let currency = 'USD';
  let decimalPlaces: number;
  if (typeof money === 'number') {
    // A number price must be finite and non-negative.
    if (!Number.isFinite(money) || money < 0) {
      throw new ValidationError(`Price must be a finite, non-negative amount: ${shown()}`);
    }
    ({ amount, decimalPlaces } = toPlainDecimal(money));
  } else {
    // A matched decimal is always finite and non-negative. A non-string (an
    // array, a bigint) is rejected rather than stringified.
    const match = typeof money === 'string' && MONEY_PATTERN.exec(stripWhitespace(money));
    if (!match) {
      throw new ValidationError(`Invalid price: ${shown()}`);
    }
    amount = match[1];
    decimalPlaces = match[2]?.length ?? 0;
    currency = match[3] ?? currency;
  }
  // At most MAX_PRICE_DECIMAL_PLACES decimal places, whatever the form.
  if (decimalPlaces > MAX_PRICE_DECIMAL_PLACES) {
    throw new ValidationError(
      `Price may have at most ${MAX_PRICE_DECIMAL_PLACES} decimal places: ${shown()}`
    );
  }
  return { amount, currency };
}

/**
 * Parse money string/number to decimal amount and currency
 *
 * Accepts and rejects the same prices as the server scheme's `parsePrice`, but
 * returns the amount as a number, so a long amount can lose precision.
 *
 * @param money - Money value (e.g., "$1.50", "1.50 USD", 1.50)
 * @returns Parsed amount and currency
 * @throws ValidationError if the price is malformed, negative or not finite, or
 * has more than 8 decimal places
 */
export function parseMoneyToDecimal(money: string | number): { amount: number; currency: string } {
  const { amount, currency } = parseMoney(money);
  return { amount: Number(amount), currency };
}

/**
 * Parse transaction ID into components
 * @param transactionId - Transaction ID (format: {network}:{id})
 * @returns Network and ID components
 */
export function parseTransactionId(transactionId: string): { network: string; id: string } {
  const parts = transactionId.split(':');
  if (parts.length < 2) {
    throw new ValidationError('Invalid transaction ID format. Expected {network}:{id}', {
      transactionId,
    });
  }

  const network = parts.slice(0, -1).join(':');
  const id = parts[parts.length - 1];

  if (!network || !id) {
    throw new ValidationError('Invalid transaction ID format. Expected {network}:{id}', {
      transactionId,
    });
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
export function fetchServiceJWKS(serviceUrl: string): ReturnType<typeof jose.createRemoteJWKSet> {
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
