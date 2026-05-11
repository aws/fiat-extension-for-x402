/**
 * FAB Client Scheme Implementation
 * 
 * In FAB, the "client" role is played by the AI agent (buyer),
 * which sends the quote token to the Agent Pay Service and receives
 * a signed payment JWT in return.
 */

import {
  PaymentRequirements,
  SchemeNetworkClient,
  PaymentPayloadResult
} from '@x402/core/types';
import type {
  FABClientSchemeConfig,
  AgenticPayClientForClient,
  DpopJwk
} from '../../config';
import { DefaultAgenticPayClient } from '../../agentic-pay-client';
import {
  FABPaymentExtra,
  FABPayloadV2,
  ValidationError
} from '../../types';
import { FAB_SCHEME } from '../../constants';

/**
 * FAB client implementation.
 * Sends quote tokens to the Agent Pay Service and wraps the response
 * into an x402 PaymentPayload.
 */
export class FABScheme implements SchemeNetworkClient {
  readonly scheme = FAB_SCHEME;
  private readonly agenticPayId: string;
  private readonly agenticPayClient: AgenticPayClientForClient;
  private readonly dpopJwk?: DpopJwk;
  private readonly clientTokenGenerator?: () => string;

  /**
   * Create a new FAB client scheme
   * @param config - Client configuration with Agentic Pay ID and client or config
   */
  constructor(config: FABClientSchemeConfig & {
    dpopJwk?: DpopJwk;
    clientTokenGenerator?: () => string;
  }) {
    this.agenticPayId = config.agenticPayId;
    this.dpopJwk = config.dpopJwk;
    this.clientTokenGenerator = config.clientTokenGenerator;
    
    if ('agenticPayClient' in config) {
      this.agenticPayClient = config.agenticPayClient;
    } else if ('agenticPay' in config) {
      this.agenticPayClient = new DefaultAgenticPayClient(config.agenticPay);
    } else {
      throw new ValidationError('FABClientScheme requires either agenticPayClient or Agentic Pay configuration');
    }
  }

  /**
   * Create a payment payload for FAB scheme
   * 
   * Sends the quote token to the Agent Pay Service which verifies the quote,
   * captures the payment, and returns a signed Payment JWT. The Agent Pay
   * Service extracts all payment details (amount, currency, recipient) from
   * the quote token — the client only needs to forward it.
   * 
   * @param x402Version - x402 protocol version
   * @param paymentRequirements - Payment requirements from 402 response
   * @returns Payment payload result
   */
  async createPaymentPayload(
    x402Version: number,
    paymentRequirements: PaymentRequirements
  ): Promise<PaymentPayloadResult> {
    // Extract FAB extra data
    const extra = paymentRequirements.extra as unknown as FABPaymentExtra;
    if (!extra?.quoteToken) {
      throw new ValidationError('Missing quoteToken in payment requirements');
    }

    // Generate client token for idempotency
    const clientToken = this.clientTokenGenerator
      ? this.clientTokenGenerator()
      : crypto.randomUUID();

    // Call Agent Pay Service — it extracts everything from the quote token
    const result = await this.agenticPayClient.createPayment({
      quoteToken: extra.quoteToken,
      clientToken,
      dpopJwk: this.dpopJwk,
    });

    // Create FAB payload with payment token from Agent Pay
    const payload: FABPayloadV2 = {
      paymentToken: result.paymentToken,
      paymentId: result.paymentId,
      // Backward compat: also set transactionId
      transactionId: result.paymentId,
    };

    return {
      x402Version,
      payload: payload as unknown as Record<string, unknown>
    };
  }
}
