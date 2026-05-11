/**
 * FAB Client Scheme Implementation
 * 
 * In FAB, the "client" role is played by the Agentic Pay provider,
 * which creates payment tokens (JWTs) for authorized payments.
 */

import {
  PaymentRequirements,
  SchemeNetworkClient,
  PaymentPayloadResult
} from '@x402/core/types';
import type {
  FABClientSchemeConfig,
  AgenticPayClientForClient
} from '../../config';
import { DefaultAgenticPayClient } from '../../agentic-pay-client';
import {
  FABPaymentExtra,
  FABPayloadV2,
  ValidationError
} from '../../types';
import { decodeQuoteToken } from '../../utils';
import { FAB_SCHEME } from '../../constants';

/**
 * FAB client implementation for Agentic Pay providers.
 * Creates payment tokens (JWTs) for authorized payments.
 */
export class FABScheme implements SchemeNetworkClient {
  readonly scheme = FAB_SCHEME;
  private readonly agenticPayId: string;
  private readonly agenticPayClient: AgenticPayClientForClient;

  /**
   * Create a new FAB client scheme
   * @param config - Client configuration with Agentic Pay ID and Agentic Pay client or config
   */
  constructor(config: FABClientSchemeConfig) {
    this.agenticPayId = config.agenticPayId;
    
    // Determine if we have a custom client or need to create default
    if ('agenticPayClient' in config) {
      this.agenticPayClient = config.agenticPayClient;
    } else if ('agenticPay' in config) {
      // Pass through auth config if provided
      this.agenticPayClient = new DefaultAgenticPayClient(config.agenticPay);
    } else {
      throw new ValidationError('FABClientScheme requires either agenticPayClient or Agentic Pay configuration');
    }
  }

  /**
   * Create a payment payload for FAB scheme
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

    // Decode quote token to get service details and payment info
    const quote = decodeQuoteToken(extra.quoteToken);
    
    // Get price - handle both single price and array of prices
    const price = Array.isArray(quote.price) ? quote.price[0] : quote.price;
    if (!price) {
      throw new ValidationError('Missing price in quote token');
    }
    
    // Call Agentic Pay provider to authorize payment
    // In FAB, paymentRequirements.payTo is a sentinel value ('urn:x402:fab:see-quote')
    // because the signed quote token is the authoritative source for the payment
    // recipient. We use quote.iss (service URL) as the payTo for the Agentic Pay's
    // authorization request — this becomes the payment token's aud field.
    const authResult = await this.agenticPayClient.authorize({
      network: paymentRequirements.network,
      amount: price.amount,
      currency: price.currency,
      payTo: quote.iss, // Service URL from quote token
      quoteToken: extra.quoteToken,
      agenticPayId: this.agenticPayId,
    });

    // Create FAB payload with payment token from Agentic Pay
    const payload: FABPayloadV2 = {
      paymentToken: authResult.paymentToken,
      transactionId: authResult.transactionId
    };

    return {
      x402Version,
      payload: payload as unknown as Record<string, unknown>
    };
  }
}
