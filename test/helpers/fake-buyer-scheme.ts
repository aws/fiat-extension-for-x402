// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Test-only buyer scheme
 * Stands in for the buyer: forwards the quote token to the fake Agent Pay Service
 * and wraps the payment token into an x402 PaymentPayload, so tests can drive the
 * seller and facilitator through x402Client.
 */

import type {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from '@x402/core/types';
import { AGENT_PAY_SCHEME } from '../../src/constants';
import type { AgentPayPaymentExtra, AgentPayPayloadV2 } from '../../src/types';
import type { CreateAgentPaymentRequest, MockAgentPayClient } from './mock-agent-pay-client';

export class FakeBuyerScheme implements SchemeNetworkClient {
  readonly scheme = AGENT_PAY_SCHEME;

  constructor(
    private readonly config: {
      agentPayClient: Pick<MockAgentPayClient, 'createPayment'>;
      dpopJwk?: CreateAgentPaymentRequest['dpopJwk'];
    }
  ) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements
  ): Promise<PaymentPayloadResult> {
    const extra = paymentRequirements.extra as unknown as AgentPayPaymentExtra;
    if (!extra?.quoteToken) {
      throw new Error('Missing quoteToken in payment requirements');
    }
    const result = await this.config.agentPayClient.createPayment({
      quoteToken: extra.quoteToken,
      clientToken: crypto.randomUUID(),
      dpopJwk: this.config.dpopJwk,
    });
    const payload: AgentPayPayloadV2 = {
      paymentToken: result.paymentToken,
      paymentId: result.paymentId,
      transactionId: result.paymentId,
    };
    return { x402Version, payload: payload as unknown as Record<string, unknown> };
  }
}
