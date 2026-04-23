/**
 * FAB Client Scheme Implementation
 * 
 * In FAB, the "client" role is played by the wallet provider,
 * which creates payment tokens (JWTs) for authorized payments.
 */

import {
  PaymentRequirements,
  SchemeNetworkClient,
  PaymentPayloadResult
} from '@x402/core/types';
import type {
  FABClientSchemeConfig,
  WalletClientForClient
} from '../../config';
import { DefaultWalletClient } from '../../wallet-client';
import {
  FABPaymentExtra,
  FABPayloadV2,
  ValidationError
} from '../../types';
import { decodeQuoteToken } from '../../utils';
import { FAB_SCHEME } from '../../constants';

/**
 * FAB client implementation for wallet providers.
 * Creates payment tokens (JWTs) for authorized payments.
 */
export class FABScheme implements SchemeNetworkClient {
  readonly scheme = FAB_SCHEME;
  private readonly walletId: string;
  private readonly walletClient: WalletClientForClient;

  /**
   * Create a new FAB client scheme
   * @param config - Client configuration with wallet ID and wallet client or config
   */
  constructor(config: FABClientSchemeConfig) {
    this.walletId = config.walletId;
    
    // Determine if we have a custom client or need to create default
    if ('walletClient' in config) {
      this.walletClient = config.walletClient;
    } else if ('wallet' in config) {
      // Pass through auth config if provided
      this.walletClient = new DefaultWalletClient(config.wallet);
    } else {
      throw new ValidationError('FABClientScheme requires either walletClient or wallet configuration');
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
    
    // Call wallet provider to authorize payment
    // In FAB, paymentRequirements.payTo is a sentinel value ('urn:x402:fab:see-quote')
    // because the signed quote token is the authoritative source for the payment
    // recipient. We use quote.iss (service URL) as the payTo for the wallet's
    // authorization request — this becomes the payment token's aud field.
    const authResult = await this.walletClient.authorize({
      network: paymentRequirements.network,
      amount: price.amount,
      currency: price.currency,
      payTo: quote.iss, // Service URL from quote token
      quoteToken: extra.quoteToken,
      walletId: this.walletId,
    });

    // Create FAB payload with payment token from wallet
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
