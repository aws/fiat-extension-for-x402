// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * In-Process Facilitator Client
 * 
 * Provides a FacilitatorClient implementation that wraps an in-process x402Facilitator.
 * This is useful for demos, testing, and scenarios where you want to run the facilitator
 * logic in the same process as your resource server.
 * 
 * For production deployments, consider using HTTPFacilitatorClient to call a remote
 * facilitator service for better separation of concerns and scalability.
 */

import type { FacilitatorClient } from '@x402/core/http';
import type { x402Facilitator } from '@x402/core/facilitator';
import type {
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse
} from '@x402/core/types';

/**
 * In-process facilitator client that wraps an x402Facilitator instance.
 * 
 * This allows you to use the standard FacilitatorClient interface with
 * an in-process facilitator, avoiding the need for a separate HTTP service.
 * 
 * @example
 * ```typescript
 * import { x402Facilitator } from '@x402/core/facilitator';
 * import { x402ResourceServer } from '@x402/core/server';
 * import { InProcessFacilitatorClient, AgentPayFacilitatorScheme } from 'aws-agent-pay-x402';
 * 
 * // Create facilitator with Agent Pay scheme
 * const facilitator = new x402Facilitator()
 *   .register('aws:base', new AgentPayFacilitatorSchemeImpl({
 *     agentPayId: 'my-agent-pay',
 *     agentPay: { baseUrl: 'https://pay.example.com' }
 *   }));
 * 
 * // Wrap in client
 * const facilitatorClient = new InProcessFacilitatorClient(facilitator);
 * 
 * // Use with resource server
 * const server = new x402ResourceServer(facilitatorClient);
 * ```
 */
export class InProcessFacilitatorClient implements FacilitatorClient {
  /**
   * Create a new in-process facilitator client
   * 
   * @param facilitator - The x402Facilitator instance to wrap
   */
  constructor(private readonly facilitator: x402Facilitator) {}

  /**
   * Verify a payment with the in-process facilitator
   * 
   * @param paymentPayload - The payment to verify
   * @param paymentRequirements - The requirements to verify against
   * @returns Verification response
   */
  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    return this.facilitator.verify(paymentPayload, paymentRequirements);
  }

  /**
   * Settle a payment with the in-process facilitator
   * 
   * @param paymentPayload - The payment to settle
   * @param paymentRequirements - The requirements for settlement
   * @returns Settlement response
   */
  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements
  ): Promise<SettleResponse> {
    return this.facilitator.settle(paymentPayload, paymentRequirements);
  }

  /**
   * Get supported payment kinds and extensions from the in-process facilitator
   * 
   * @returns Supported payment kinds and extensions
   */
  async getSupported(): Promise<SupportedResponse> {
    const result = await this.facilitator.getSupported();
    return result as SupportedResponse;
  }
}
