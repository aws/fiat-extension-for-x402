/**
 * FAB Facilitator Scheme Implementation
 * 
 * In FAB, the "facilitator" role is played by the wallet provider,
 * which verifies and settles payments.
 */

import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
  Network
} from '@x402/core/types';
import type { FABFacilitatorSchemeConfig, WalletClientForFacilitator } from '../../config';
import { DefaultWalletClient } from '../../wallet-client';
import { FABPayloadV2, ValidationError } from '../../types';
import { verifyPayment } from './verify';
import { settlePayment } from './settle';
import { FAB_SCHEME, FAB_CAIP_FAMILY } from '../../constants';

/**
 * FAB facilitator implementation for wallet providers.
 * Verifies and settles payments.
 */
export class FABScheme implements SchemeNetworkFacilitator {
  readonly scheme = FAB_SCHEME;
  readonly caipFamily = FAB_CAIP_FAMILY;
  private readonly walletClient: WalletClientForFacilitator;
  private readonly walletId: string;

  /**
   * Create a new FAB facilitator scheme
   * @param config - Facilitator configuration with wallet client or config
   */
  constructor(config: FABFacilitatorSchemeConfig) {
    // Store wallet ID
    this.walletId = config.walletId;
    
    // Determine if we have a custom client or need to create default
    if ('walletClient' in config) {
      this.walletClient = config.walletClient;
    } else if ('wallet' in config) {
      this.walletClient = new DefaultWalletClient(config.wallet);
    } else {
      throw new ValidationError('FABFacilitatorScheme requires either walletClient or wallet configuration');
    }
  }

  /**
   * Get mechanism-specific extra data for the supported kinds endpoint
   * 
   * @param network - Network identifier
   * @returns Extra data with wallet ID
   */
  getExtra(network: Network): Record<string, unknown> | undefined {
    return {
      walletId: this.walletId
    };
  }

  /**
   * Get signer addresses used by this facilitator
   * 
   * @param network - Network identifier
   * @returns Array with wallet ID
   */
  getSigners(network: string): string[] {
    return [this.walletId];
  }

  /**
   * Verify a payment payload
   * 
   * @param payload - Payment payload to verify
   * @param requirements - Payment requirements
   * @returns Verification response
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    const fabPayload = payload.payload as unknown as FABPayloadV2;
    return verifyPayment(this.walletClient, payload, requirements, fabPayload);
  }

  /**
   * Settle a payment by executing the transfer
   * 
   * @param payload - Payment payload to settle
   * @param requirements - Payment requirements
   * @returns Settlement response
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    const fabPayload = payload.payload as unknown as FABPayloadV2;
    return settlePayment(this.walletClient, payload, requirements, fabPayload);
  }
}
