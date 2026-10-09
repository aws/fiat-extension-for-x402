// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agentic Commerce Facilitator Scheme Implementation
 *
 * In Agentic Commerce, the "facilitator" role is played by the Agentic Commerce provider,
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
import type {
  AgenticCommerceFacilitatorSchemeConfig,
  AgenticCommerceClientForFacilitator,
} from '../../config';
import { JwksPaymentTokenVerifier } from './payment-token-verifier';
import { AgenticCommercePayloadV2, ValidationError } from '../../types';
import { verifyPayment } from './verify';
import { settlePayment } from './settle';
import { AGENTIC_COMMERCE_SCHEME, AGENTIC_COMMERCE_CAIP_FAMILY } from '../../constants';

/**
 * Agentic Commerce facilitator implementation for Agentic Commerce providers.
 * Verifies and settles payments.
 */
export class AgenticCommerceScheme implements SchemeNetworkFacilitator {
  readonly scheme = AGENTIC_COMMERCE_SCHEME;
  readonly caipFamily = AGENTIC_COMMERCE_CAIP_FAMILY;
  private readonly agenticCommerceClient: AgenticCommerceClientForFacilitator;
  private readonly agenticCommerceId: string;

  /**
   * Create a new Agentic Commerce facilitator scheme
   * @param config - Facilitator configuration with Agentic Commerce client or config
   */
  constructor(config: AgenticCommerceFacilitatorSchemeConfig) {
    // Store Agentic Commerce ID
    this.agenticCommerceId = config.agenticCommerceId;

    // Determine if we have a custom client or need to create default
    if ('agenticCommerceClient' in config) {
      this.agenticCommerceClient = config.agenticCommerceClient;
    } else if ('agenticCommerce' in config) {
      this.agenticCommerceClient = new JwksPaymentTokenVerifier(config.agenticCommerce);
    } else {
      throw new ValidationError(
        'AgenticCommerceFacilitatorScheme requires either agenticCommerceClient or Agentic Commerce configuration'
      );
    }
  }

  /**
   * Get mechanism-specific extra data for the supported kinds endpoint
   *
   * @param network - Network identifier
   * @returns Extra data with Agentic Commerce ID
   */
  getExtra(network: Network): Record<string, unknown> | undefined {
    // Wire key in the supported kind's `extra`; kept as-is so the output is unchanged.
    return {
      agentPayId: this.agenticCommerceId,
    };
  }

  /**
   * Get signer addresses used by this facilitator
   *
   * @param network - Network identifier
   * @returns Array with Agentic Commerce ID
   */
  getSigners(network: string): string[] {
    return [this.agenticCommerceId];
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
    const apPayload = payload.payload as unknown as AgenticCommercePayloadV2;
    return verifyPayment(this.agenticCommerceClient, payload, requirements, apPayload);
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
    const apPayload = payload.payload as unknown as AgenticCommercePayloadV2;
    return settlePayment(this.agenticCommerceClient, payload, requirements, apPayload);
  }
}
