// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agentic Commerce Payment Verification Logic
 */

import * as jose from 'jose';
import { ALLOWED_ALGORITHMS, secureCompare } from '../../security';
import { WELL_KNOWN_JWKS_PATH } from '../../constants';
import { PaymentPayload, PaymentRequirements, VerifyResponse } from '@x402/core/types';
import type { AgenticCommerceClientForFacilitator } from '../../config';
import { AgenticCommercePayloadV2, AgenticCommercePaymentExtra, MismatchError } from '../../types';
import { decodeQuoteToken } from '../../utils';
import { verifyDPoPProof, extractDPoPThumbprint } from '../../dpop';

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
  /** HTTP request context for DPoP verification */
  requestContext?: { method: string; url: string; dpopProof?: string };
}

/**
 * Verify a Agentic Commerce payment
 *
 * Verification steps:
 * 1. Verify payment token signature via Agentic Commerce client (Agentic Commerce's ES384 key)
 * 2. Verify payment ID matches
 * 3. Verify quote token exists in requirements
 * 4. Verify quote token signature (service's key via JWKS) — MANDATORY
 * 5. Verify quote token expiry
 * 6. Verify payment token expiry
 * 7. If payment token contains cnf.jkt, verify DPoP proof (requestContext required)
 *
 * Note: Agentic Commerce auto-captures on creation — there is no separate settlement step.
 * This function does NOT use requirements.payTo or requirements.maxTimeoutSeconds.
 * In Agentic Commerce, those fields contain sentinel values (see spec §2.4). The signed quote token
 * is the authoritative source for payment details.
 *
 * @param agenticCommerceClient - Agentic Commerce client for verification
 * @param payload - Payment payload
 * @param requirements - Payment requirements
 * @param apPayload - Agentic Commerce-specific payload
 * @param options - Optional verification options (serviceJWKSUrl override, requestContext for DPoP)
 * @returns Verification response
 */
export async function verifyPayment(
  agenticCommerceClient: AgenticCommerceClientForFacilitator,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  apPayload: AgenticCommercePayloadV2,
  options?: VerifyPaymentOptions
): Promise<VerifyResponse> {
  try {
    // 1. Verify payment token signature (Agentic Commerce's ES384 key)
    const paymentJWT = await agenticCommerceClient.verifyPaymentToken(apPayload.paymentToken);

    // 2. Verify payment ID matches
    const payloadPaymentId = apPayload.paymentId || apPayload.transactionId;
    const tokenPaymentId = paymentJWT.payment_id || paymentJWT.payment_context?.transaction_id;

    if (payloadPaymentId && tokenPaymentId && !secureCompare(payloadPaymentId, tokenPaymentId)) {
      throw new MismatchError('Payment ID mismatch', tokenPaymentId, payloadPaymentId);
    }

    // 3. Verify quote token exists in requirements
    const extra = requirements.extra as unknown as AgenticCommercePaymentExtra;
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
      const jwksUrl = `${jwksBaseUrl.replace(/\/$/, '')}${WELL_KNOWN_JWKS_PATH}`;
      const jwksResponse = await fetch(jwksUrl);
      if (!jwksResponse.ok) {
        return {
          isValid: false,
          invalidReason: 'invalid_quote',
          invalidMessage: `Quote token signature verification failed: Failed to fetch service JWKS from ${jwksUrl}: ${jwksResponse.statusText}`,
        };
      }
      const jwksData = (await jwksResponse.json()) as jose.JSONWebKeySet;
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

    // 7. DPoP verification (if buyer opted in)
    const cnf = paymentJWT.cnf;
    if (cnf?.jkt) {
      if (!options?.requestContext?.dpopProof) {
        return {
          isValid: false,
          invalidReason: 'dpop_required',
          invalidMessage: 'Payment token is DPoP-bound but no DPoP proof provided',
        };
      }
      const thumbprint = await extractDPoPThumbprint(options.requestContext.dpopProof);
      if (thumbprint !== cnf.jkt) {
        return {
          isValid: false,
          invalidReason: 'dpop_invalid',
          invalidMessage: 'DPoP proof thumbprint does not match payment token binding',
        };
      }
      await verifyDPoPProof(options.requestContext.dpopProof, {
        method: options.requestContext.method,
        url: options.requestContext.url,
      });
    }

    return {
      isValid: true,
      payer: paymentJWT.sub || paymentJWT.iss,
    };
  } catch (error) {
    return {
      isValid: false,
      invalidReason: 'verification_failed',
      invalidMessage: error instanceof Error ? error.message : 'Verification failed',
    };
  }
}
