/**
 * Agentic Pay Payment Settlement Logic
 * 
 * In the Agent Pay model, payments are auto-captured during CreateAgentPayment.
 * There is no separate capture/settle step. This function returns success
 * immediately — the payment was already settled when it was created.
 */

import { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';
import type { AgenticPayClientForFacilitator } from '../../config';
import { AgenticPayPayloadV2 } from '../../types';

/**
 * Settle a Agentic Pay payment
 * 
 * Agent Pay auto-captures on creation — there is no separate /capture endpoint.
 * This function is a no-op that returns success, since the payment was already
 * settled when the Agent Pay Service processed CreateAgentPayment.
 * 
 * @param agenticPayClient - Agentic Pay client (unused — no capture call needed)
 * @param payload - Payment payload
 * @param requirements - Payment requirements
 * @param apPayload - Agentic Pay-specific payload
 * @returns Settlement response (always success for auto-captured payments)
 */
export async function settlePayment(
  _agenticPayClient: AgenticPayClientForFacilitator,
  _payload: PaymentPayload,
  requirements: PaymentRequirements,
  apPayload: AgenticPayPayloadV2
): Promise<SettleResponse> {
  // Agent Pay auto-captures — no HTTP call needed.
  // The payment was already settled during CreateAgentPayment.
  return {
    success: true,
    transaction: apPayload.paymentId || apPayload.transactionId || '',
    network: requirements.network
  };
}
