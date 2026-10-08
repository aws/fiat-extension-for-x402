// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agentic Commerce Payment Settlement Logic
 *
 * In the Agentic Commerce model, payments are auto-captured when the service creates the payment.
 * There is no separate capture/settle step. This function returns success
 * immediately — the payment was already settled when it was created.
 */

import { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';
import type { AgenticCommerceClientForFacilitator } from '../../config';
import { AgenticCommercePayloadV2 } from '../../types';

/**
 * Settle a Agentic Commerce payment
 *
 * Agentic Commerce auto-captures on creation — there is no separate /capture endpoint.
 * This function is a no-op that returns success, since the payment was already
 * settled when the Agentic Commerce Service created the payment.
 *
 * @param agenticCommerceClient - Agentic Commerce client (unused — no capture call needed)
 * @param payload - Payment payload
 * @param requirements - Payment requirements
 * @param apPayload - Agentic Commerce-specific payload
 * @returns Settlement response (always success for auto-captured payments)
 */
export async function settlePayment(
  _agenticCommerceClient: AgenticCommerceClientForFacilitator,
  _payload: PaymentPayload,
  requirements: PaymentRequirements,
  apPayload: AgenticCommercePayloadV2
): Promise<SettleResponse> {
  // Agentic Commerce auto-captures — no HTTP call needed.
  // The payment was already settled when the service created it.
  return {
    success: true,
    transaction: apPayload.paymentId || apPayload.transactionId || '',
    network: requirements.network,
  };
}
