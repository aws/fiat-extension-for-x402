// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Test-only buyer scheme
 * Stands in for the buyer: forwards the quote token to the fake Agentic Commerce Service
 * and wraps the payment token into an x402 PaymentPayload, so tests can drive the
 * seller and facilitator through x402Client.
 */

import type {
  PaymentPayloadResult,
  PaymentRequirements,
  SchemeNetworkClient,
} from '@x402/core/types';
import { SCHEME_EXACT } from '../../src/constants';
import type { AgenticCommercePaymentExtra, AgenticCommercePayloadV2 } from '../../src/types';
import type {
  CreatePaymentRequest,
  MockAgenticCommerceClient,
} from './mock-agentic-commerce-client';

export class FakeBuyerScheme implements SchemeNetworkClient {
  readonly scheme = SCHEME_EXACT;

  constructor(
    private readonly config: {
      agenticCommerceClient: Pick<MockAgenticCommerceClient, 'createPayment'>;
      dpopJwk?: CreatePaymentRequest['dpopJwk'];
    }
  ) {}

  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements
  ): Promise<PaymentPayloadResult> {
    const extra = paymentRequirements.extra as unknown as AgenticCommercePaymentExtra;
    if (!extra?.quoteToken) {
      throw new Error('Missing quoteToken in payment requirements');
    }
    const result = await this.config.agenticCommerceClient.createPayment({
      quoteToken: extra.quoteToken,
      clientToken: crypto.randomUUID(),
      dpopJwk: this.config.dpopJwk,
    });
    const payload: AgenticCommercePayloadV2 = {
      paymentToken: result.paymentToken,
      paymentId: result.paymentId,
      transactionId: result.paymentId,
    };
    return { x402Version, payload: payload as unknown as Record<string, unknown> };
  }
}
