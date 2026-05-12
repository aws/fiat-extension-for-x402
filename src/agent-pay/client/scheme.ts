/**
 * Agent Pay Client Scheme Implementation
 * 
 * In Agent Pay, the "client" role is played by the AI agent (buyer),
 * which sends the quote token to the Agent Pay Service and receives
 * a signed payment JWT in return.
 */

import {
  PaymentRequirements,
  SchemeNetworkClient,
  PaymentPayloadResult
} from '@x402/core/types';
import type {
  AgentPayClientSchemeConfig,
  AgentPayClientForClient,
  DpopJwk
} from '../../config';
import { DefaultAgentPayClient } from '../../agent-pay-client';
import {
  AgentPayPaymentExtra,
  AgentPayPayloadV2,
  ValidationError
} from '../../types';
import { AGENT_PAY_SCHEME } from '../../constants';

/**
 * Agent Pay client implementation.
 * Sends quote tokens to the Agent Pay Service and wraps the response
 * into an x402 PaymentPayload.
 */
export class AgentPayScheme implements SchemeNetworkClient {
  readonly scheme = AGENT_PAY_SCHEME;
  private readonly agentPayId: string;
  private readonly agentPayClient: AgentPayClientForClient;
  private readonly dpopJwk?: DpopJwk;
  private readonly clientTokenGenerator?: () => string;

  /**
   * Create a new Agent Pay client scheme
   * @param config - Client configuration with Agent Pay ID and client or config
   */
  constructor(config: AgentPayClientSchemeConfig & {
    dpopJwk?: DpopJwk;
    clientTokenGenerator?: () => string;
  }) {
    this.agentPayId = config.agentPayId;
    this.dpopJwk = config.dpopJwk;
    this.clientTokenGenerator = config.clientTokenGenerator;
    
    if ('agentPayClient' in config) {
      this.agentPayClient = config.agentPayClient;
    } else if ('agentPay' in config) {
      this.agentPayClient = new DefaultAgentPayClient(config.agentPay);
    } else {
      throw new ValidationError('AgentPayClientScheme requires either agentPayClient or Agent Pay configuration');
    }
  }

  /**
   * Create a payment payload for Agent Pay scheme
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
    // Extract Agent Pay extra data
    const extra = paymentRequirements.extra as unknown as AgentPayPaymentExtra;
    if (!extra?.quoteToken) {
      throw new ValidationError('Missing quoteToken in payment requirements');
    }

    // Generate client token for idempotency
    const clientToken = this.clientTokenGenerator
      ? this.clientTokenGenerator()
      : crypto.randomUUID();

    // Call Agent Pay Service — it extracts everything from the quote token
    const result = await this.agentPayClient.createPayment({
      quoteToken: extra.quoteToken,
      clientToken,
      dpopJwk: this.dpopJwk,
    });

    // Create Agent Pay payload with payment token from Agent Pay
    const payload: AgentPayPayloadV2 = {
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
