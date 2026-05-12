/**
 * Agentic Pay Payment Verification Logic
 */

import * as jose from 'jose';
import { ALLOWED_ALGORITHMS, secureCompare } from '../../security';
import { PaymentPayload, PaymentRequirements, VerifyResponse } from '@x402/core/types';
import type { AgenticPayClientForFacilitator } from '../../config';
import { AgenticPayPayloadV2, AgenticPayPaymentExtra, MismatchError } from '../../types';
import { decodeQuoteToken } from '../../utils';

/**
 * Options for payment verification
 */
export interface VerifyPaymentOptions {
  /**
   * Override the JWKS URL used to verify the quote token signature.
   * By default, derived from `quote.iss` + `/.well-known/jwks.json`.
   * Useful when the service is behind a proxy or uses a different JWKS endpoint.
   */
  serviceJWKSUrl?: string;
}

/**
 * Verify a Agentic Pay payment
 * 
 * Verification steps:
 * 1. Verify payment token signature via Agentic Pay client (Agent Pay's ES384 key)
 * 2. Verify payment ID matches
 * 3. Verify quote token exists in requirements
 * 4. Verify quote token signature (service's key via JWKS) — MANDATORY
 * 5. Verify quote token expiry
 * 6. Verify payment token expiry
 * 
 * Note: Agent Pay auto-captures on creation — there is no separate settlement step.
 * This function does NOT use requirements.payTo or requirements.maxTimeoutSeconds.
 * In Agentic Pay, those fields contain sentinel values (see spec §2.4). The signed quote token
 * is the authoritative source for payment details.
 * 
 * @param agenticPayClient - Agentic Pay client for verification
 * @param payload - Payment payload
 * @param requirements - Payment requirements
 * @param apPayload - Agentic Pay-specific payload
 * @param options - Optional verification options (e.g., serviceJWKSUrl override)
 * @returns Verification response
 */
export async function verifyPayment(
  agenticPayClient: AgenticPayClientForFacilitator,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  apPayload: AgenticPayPayloadV2,
  options?: VerifyPaymentOptions
): Promise<VerifyResponse> {
  try {
    // 1. Verify payment token signature (Agent Pay's ES384 key)
    const paymentJWT = await agenticPayClient.verifyPaymentToken(apPayload.paymentToken);

    // 2. Verify payment ID matches
    const payloadPaymentId = apPayload.paymentId || apPayload.transactionId;
    const tokenPaymentId = paymentJWT.payment_id ||
      paymentJWT.payment_context?.transaction_id;

    if (payloadPaymentId && tokenPaymentId && !secureCompare(payloadPaymentId, tokenPaymentId)) {
      throw new MismatchError(
        'Payment ID mismatch',
        tokenPaymentId,
        payloadPaymentId
      );
    }

    // 3. Verify quote token exists in requirements
    const extra = requirements.extra as unknown as AgenticPayPaymentExtra;
    if (!extra?.quoteToken) {
      return {
        isValid: false,
        invalidReason: 'invalid_quote',
        invalidMessage: 'Missing quoteToken in payment requirements',
      };
    }

    // 4. Verify quote token signature (service's key) — MANDATORY
    const quotePayload = decodeQuoteToken(extra.quoteToken);

    if (!quotePayload.iss) {
      return {
        isValid: false,
        invalidReason: 'invalid_quote',
        invalidMessage: 'Quote token missing issuer (iss) claim',
      };
    }

    try {
      const jwksBaseUrl = options?.serviceJWKSUrl || quotePayload.iss;
      const jwksUrl = `${jwksBaseUrl.replace(/\/$/, '')}/.well-known/jwks.json`;
      const jwksResponse = await fetch(jwksUrl);
      if (!jwksResponse.ok) {
        return {
          isValid: false,
          invalidReason: 'invalid_quote',
          invalidMessage: `Quote token signature verification failed: Failed to fetch service JWKS from ${jwksUrl}: ${jwksResponse.statusText}`,
        };
      }
      const jwksData = await jwksResponse.json() as jose.JSONWebKeySet;
      // Disable jose's built-in exp check — we check it separately with a specific error reason
      await jose.jwtVerify(extra.quoteToken, jose.createLocalJWKSet(jwksData), {
        clockTolerance: Infinity,
        algorithms: ALLOWED_ALGORITHMS,
      });
    } catch (jwksError) {
      const errorMessage = jwksError instanceof Error ? jwksError.message : String(jwksError);
      return {
        isValid: false,
        invalidReason: 'invalid_quote',
        invalidMessage: `Quote token signature verification failed: ${errorMessage}`,
      };
    }

    // 5. Verify quote token expiry
    const now = Math.floor(Date.now() / 1000);
    if (quotePayload.exp && quotePayload.exp < now) {
      return {
        isValid: false,
        invalidReason: 'quote_expired',
        invalidMessage: 'Quote token expired',
      };
    }

    // 6. Verify payment token expiry
    if (paymentJWT.exp < now) {
      return {
        isValid: false,
        invalidReason: 'payment_expired',
        invalidMessage: 'Payment token expired',
      };
    }

    return {
      isValid: true,
      payer: paymentJWT.sub || paymentJWT.iss
    };
  } catch (error) {
    return {
      isValid: false,
      invalidReason: 'verification_failed',
      invalidMessage: error instanceof Error ? error.message : 'Verification failed'
    };
  }
}
