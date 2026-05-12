/**
 * Agentic Pay Facilitator Scheme Implementation
 * 
 * In Agentic Pay, the "facilitator" role is played by the Agentic Pay provider,
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
import type { AgenticPayFacilitatorSchemeConfig, AgenticPayClientForFacilitator } from '../../config';
import { DefaultAgenticPayClient } from '../../agentic-pay-client';
import { AgenticPayPayloadV2, ValidationError } from '../../types';
import { verifyPayment } from './verify';
import { settlePayment } from './settle';
import { AGENTIC_PAY_SCHEME, AGENTIC_PAY_CAIP_FAMILY } from '../../constants';

/**
 * Agentic Pay facilitator implementation for Agentic Pay providers.
 * Verifies and settles payments.
 */
export class AgenticPayScheme implements SchemeNetworkFacilitator {
  readonly scheme = AGENTIC_PAY_SCHEME;
  readonly caipFamily = AGENTIC_PAY_CAIP_FAMILY;
  private readonly agenticPayClient: AgenticPayClientForFacilitator;
  private readonly agenticPayId: string;

  /**
   * Create a new Agentic Pay facilitator scheme
   * @param config - Facilitator configuration with Agentic Pay client or config
   */
  constructor(config: AgenticPayFacilitatorSchemeConfig) {
    // Store Agentic Pay ID
    this.agenticPayId = config.agenticPayId;
    
    // Determine if we have a custom client or need to create default
    if ('agenticPayClient' in config) {
      this.agenticPayClient = config.agenticPayClient;
    } else if ('agenticPay' in config) {
      this.agenticPayClient = new DefaultAgenticPayClient(config.agenticPay);
    } else {
      throw new ValidationError('AgenticPayFacilitatorScheme requires either agenticPayClient or Agentic Pay configuration');
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
    const apPayload = payload.payload as unknown as AgenticPayPayloadV2;
    return verifyPayment(this.agenticPayClient, payload, requirements, apPayload);
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
    const apPayload = payload.payload as unknown as AgenticPayPayloadV2;
    return settlePayment(this.agenticPayClient, payload, requirements, apPayload);
  }
}
