// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agent Pay Facilitator Scheme Implementation
 *
 * In Agent Pay, the "facilitator" role is played by the Agent Pay provider,
 * which verifies and settles payments.
 */

import {
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
  Network,
} from '@x402/core/types';
import type { AgentPayFacilitatorSchemeConfig, AgentPayClientForFacilitator } from '../../config';
import { JwksPaymentTokenVerifier } from './payment-token-verifier';
import { AgentPayPayloadV2, ValidationError } from '../../types';
import { verifyPayment } from './verify';
import { settlePayment } from './settle';
import { AGENT_PAY_SCHEME, AGENT_PAY_CAIP_FAMILY } from '../../constants';

/**
 * Agent Pay facilitator implementation for Agent Pay providers.
 * Verifies and settles payments.
 */
export class AgentPayScheme implements SchemeNetworkFacilitator {
  readonly scheme = AGENT_PAY_SCHEME;
  readonly caipFamily = AGENT_PAY_CAIP_FAMILY;
  private readonly agentPayClient: AgentPayClientForFacilitator;
  private readonly agentPayId: string;

  /**
   * Create a new Agent Pay facilitator scheme
   * @param config - Facilitator configuration with Agent Pay client or config
   */
  constructor(config: AgentPayFacilitatorSchemeConfig) {
    // Store Agent Pay ID
    this.agentPayId = config.agentPayId;

    // Determine if we have a custom client or need to create default
    if ('agentPayClient' in config) {
      this.agentPayClient = config.agentPayClient;
    } else if ('agentPay' in config) {
      this.agentPayClient = new JwksPaymentTokenVerifier(config.agentPay);
    } else {
      throw new ValidationError(
        'AgentPayFacilitatorScheme requires either agentPayClient or Agent Pay configuration'
      );
    }
  }

  /**
   * Get mechanism-specific extra data for the supported kinds endpoint
   *
   * @param network - Network identifier
   * @returns Extra data with Agent Pay ID
   */
  getExtra(network: Network): Record<string, unknown> | undefined {
    return {
      agentPayId: this.agentPayId,
    };
  }

  /**
   * Get signer addresses used by this facilitator
   *
   * @param network - Network identifier
   * @returns Array with Agent Pay ID
   */
  getSigners(network: string): string[] {
    return [this.agentPayId];
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
    const apPayload = payload.payload as unknown as AgentPayPayloadV2;
    return verifyPayment(this.agentPayClient, payload, requirements, apPayload);
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
    const apPayload = payload.payload as unknown as AgentPayPayloadV2;
    return settlePayment(this.agentPayClient, payload, requirements, apPayload);
  }
}
