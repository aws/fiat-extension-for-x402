/**
 * Security utilities for Agent Pay
 * 
 * Provides constant-time comparison and algorithm allowlist enforcement.
 */

import { timingSafeEqual } from 'node:crypto';

/**
 * Allowed JWT signing algorithms.
 * Only these algorithms are accepted for payment and quote token verification.
 */
export const ALLOWED_ALGORITHMS: string[] = ['RS256', 'ES256', 'ES384', 'ES512'];

/**
 * Constant-time string comparison.
 * Prevents timing attacks when comparing tokens, payment IDs, or other sensitive values.
 * 
 * Returns false (not equal) if strings have different lengths — this leaks length
 * information, but for our use case (comparing JWTs or UUIDs of known format)
 * the length is not secret.
 * 
 * @param a - First string
 * @param b - Second string
 * @returns true if strings are equal
 */
export function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const bufA = Buffer.from(a, 'utf-8');
  const bufB = Buffer.from(b, 'utf-8');
  return timingSafeEqual(bufA, bufB);
}

/**
 * Validate that a URL is well-formed and uses HTTPS (or HTTP for localhost/testing).
 * 
 * @param url - URL string to validate
 * @param allowHttp - Allow HTTP (for local development). Defaults to false.
 * @returns The validated URL object
 * @throws Error if URL is invalid or uses an insecure protocol
 */
export function validateUrl(url: string, allowHttp = false): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  if (!allowHttp && parsed.protocol !== 'https:') {
    // Allow http for localhost
    if (parsed.protocol === 'http:' && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')) {
      return parsed;
    }
    throw new Error(`Insecure URL protocol: ${parsed.protocol}. Use HTTPS.`);
  }

  return parsed;
}
