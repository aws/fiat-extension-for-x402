/**
 * FAB Payment Settlement Logic
 */

import { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';
import type { AgenticPayClientForFacilitator } from '../../config';
import { FABPayloadV2 } from '../../types';
import { decodeQuoteToken } from '../../utils';

/**
 * Settle a FAB payment
 * 
 * In FAB, settlement is handled by the Agentic Pay provider's backend.
 * This calls the Agentic Pay provider's /capture endpoint to:
 * 1. Capture the held funds
 * 2. Transfer to the service's Agentic Pay account
 * 3. Record the settlement
 * 
 * Note: This function uses requirements.amount and requirements.asset (which are real
 * values, not sentinels). It does NOT use requirements.payTo or requirements.maxTimeoutSeconds,
 * which contain sentinel values in FAB (see spec §2.4).
 * 
 * @param agenticPayClient - Agentic Pay client for settlement
 * @param payload - Payment payload
 * @param requirements - Payment requirements
 * @param fabPayload - FAB-specific payload
 * @returns Settlement response
 */
export async function settlePayment(
  agenticPayClient: AgenticPayClientForFacilitator,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  fabPayload: FABPayloadV2
): Promise<SettleResponse> {
  try {
    // Extract amount and currency from requirements
    const amount = requirements.amount;
    const currency = requirements.asset.replace('iso4217:', '');
    
    // Call Agentic Pay provider to capture payment
    const captureResult = await agenticPayClient.capturePayment(
      fabPayload.transactionId,
      amount,
      currency
    );
    
    if (!captureResult.success) {
      throw new Error('Payment capture failed');
    }
    
    return {
      success: true,
      transaction: fabPayload.transactionId,
      network: requirements.network
    };
  } catch (error) {
    return {
      success: false,
      errorReason: 'settlement_failed',
      errorMessage: error instanceof Error ? error.message : 'Settlement failed',
      transaction: fabPayload.transactionId,
      network: requirements.network
    };
  }
}
