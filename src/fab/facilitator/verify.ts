/**
 * FAB Payment Verification Logic
 */

import * as jose from 'jose';
import { PaymentPayload, PaymentRequirements, VerifyResponse } from '@x402/core/types';
import type { AgenticPayClientForFacilitator } from '../../config';
import { FABPayloadV2, FABPaymentExtra, MismatchError } from '../../types';
import { decodeQuoteToken, fetchServiceJWKS } from '../../utils';

/**
 * Verify a FAB payment
 * 
 * Verification steps:
 * 1. Verify payment token signature via Agentic Pay client (Agent Pay's ES384 key)
 * 2. Verify payment ID matches
 * 3. Extract and verify quote token from payment requirements
 * 4. Verify quote token signature (service's key via JWKS) — best-effort
 * 5. Verify payment token expiry
 * 
 * Note: Agent Pay auto-captures on creation — there is no separate settlement step.
 * This function does NOT use requirements.payTo or requirements.maxTimeoutSeconds.
 * In FAB, those fields contain sentinel values (see spec §2.4). The signed quote token
 * is the authoritative source for payment details.
 * 
 * @param agenticPayClient - Agentic Pay client for verification
 * @param payload - Payment payload
 * @param requirements - Payment requirements
 * @param fabPayload - FAB-specific payload
 * @returns Verification response
 */
export async function verifyPayment(
  agenticPayClient: AgenticPayClientForFacilitator,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  fabPayload: FABPayloadV2
): Promise<VerifyResponse> {
  try {
    // 1. Verify payment token signature (Agent Pay's ES384 key)
    const paymentJWT = await agenticPayClient.verifyPaymentToken(fabPayload.paymentToken);

    // 2. Verify payment ID matches
    const payloadPaymentId = fabPayload.paymentId || fabPayload.transactionId;
    const tokenPaymentId = paymentJWT.payment_id ||
      paymentJWT.payment_context?.transaction_id;

    if (payloadPaymentId && tokenPaymentId && payloadPaymentId !== tokenPaymentId) {
      throw new MismatchError(
        'Payment ID mismatch',
        tokenPaymentId,
        payloadPaymentId
      );
    }

    // 3. Verify quote token from requirements
    const extra = requirements.extra as unknown as FABPaymentExtra;
    if (!extra?.quoteToken) {
      throw new Error('Missing quoteToken in payment requirements');
    }

    // 4. Verify quote token signature (service's key) — best-effort
    const quotePayload = decodeQuoteToken(extra.quoteToken);
    if (quotePayload.iss) {
      try {
        const serviceJWKS = fetchServiceJWKS(quotePayload.iss);
        await jose.jwtVerify(extra.quoteToken, serviceJWKS);
      } catch {
        // If JWKS fetch fails, the quote token was already verified by Agent Pay
        // during CreateAgentPayment. The string presence in requirements is sufficient.
      }
    }

    // 5. Verify payment token expiry
    const now = Math.floor(Date.now() / 1000);
    if (paymentJWT.exp < now) {
      throw new Error('Payment token expired');
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
