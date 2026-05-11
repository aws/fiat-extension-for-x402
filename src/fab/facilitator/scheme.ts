/**
 * FAB Facilitator Scheme Implementation
 * 
 * In FAB, the "facilitator" role is played by the Agentic Pay provider,
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
import type { FABFacilitatorSchemeConfig, AgenticPayClientForFacilitator } from '../../config';
import { DefaultAgenticPayClient } from '../../agentic-pay-client';
import { FABPayloadV2, ValidationError } from '../../types';
import { verifyPayment } from './verify';
import { settlePayment } from './settle';
import { FAB_SCHEME, FAB_CAIP_FAMILY } from '../../constants';

/**
 * FAB facilitator implementation for Agentic Pay providers.
 * Verifies and settles payments.
 */
export class FABScheme implements SchemeNetworkFacilitator {
  readonly scheme = FAB_SCHEME;
  readonly caipFamily = FAB_CAIP_FAMILY;
  private readonly agenticPayClient: AgenticPayClientForFacilitator;
  private readonly agenticPayId: string;

  /**
   * Create a new FAB facilitator scheme
   * @param config - Facilitator configuration with Agentic Pay client or config
   */
  constructor(config: FABFacilitatorSchemeConfig) {
    // Store Agentic Pay ID
    this.agenticPayId = config.agenticPayId;
    
    // Determine if we have a custom client or need to create default
    if ('agenticPayClient' in config) {
      this.agenticPayClient = config.agenticPayClient;
    } else if ('agenticPay' in config) {
      this.agenticPayClient = new DefaultAgenticPayClient(config.agenticPay);
    } else {
      throw new ValidationError('FABFacilitatorScheme requires either agenticPayClient or Agentic Pay configuration');
    }
  }

  /**
   * Get mechanism-specific extra data for the supported kinds endpoint
   * 
   * @param network - Network identifier
   * @returns Extra data with Agentic Pay ID
   */
  getExtra(network: Network): Record<string, unknown> | undefined {
    return {
      agenticPayId: this.agenticPayId
    };
  }

  /**
   * Get signer addresses used by this facilitator
   * 
   * @param network - Network identifier
   * @returns Array with Agentic Pay ID
   */
  getSigners(network: string): string[] {
    return [this.agenticPayId];
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
    return verifyPayment(this.agenticPayClient, payload, requirements, fabPayload);
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
    return settlePayment(this.agenticPayClient, payload, requirements, fabPayload);
  }
}
