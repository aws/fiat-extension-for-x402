/**
 * FAB Payment Settlement Logic
 */

import { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';
import type { WalletClientForFacilitator } from '../../config';
import { FABPayloadV2 } from '../../types';
import { decodeQuoteToken } from '../../utils';

/**
 * Settle a FAB payment
 * 
 * In FAB, settlement is handled by the wallet provider's backend.
 * This calls the wallet provider's /capture endpoint to:
 * 1. Capture the held funds
 * 2. Transfer to the service's wallet account
 * 3. Record the settlement
 * 
 * Note: This function uses requirements.amount and requirements.asset (which are real
 * values, not sentinels). It does NOT use requirements.payTo or requirements.maxTimeoutSeconds,
 * which contain sentinel values in FAB (see spec §2.4).
 * 
 * @param walletClient - Wallet client for settlement
 * @param payload - Payment payload
 * @param requirements - Payment requirements
 * @param fabPayload - FAB-specific payload
 * @returns Settlement response
 */
export async function settlePayment(
  walletClient: WalletClientForFacilitator,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
  fabPayload: FABPayloadV2
): Promise<SettleResponse> {
  try {
    // Extract amount and currency from requirements
    const amount = requirements.amount;
    const currency = requirements.asset.replace('iso4217:', '');
    
    // Call wallet provider to capture payment
    const captureResult = await walletClient.capturePayment(
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
