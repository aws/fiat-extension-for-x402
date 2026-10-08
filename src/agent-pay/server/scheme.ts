// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agent Pay Server Scheme Implementation
 * 
 * In Agent Pay, the "server" role is played by the resource service,
 * which generates 402 responses with quote tokens.
 */

import { webcrypto } from 'node:crypto';
import {
  AssetAmount,
  Network,
  PaymentRequirements,
  Price,
  SchemeNetworkServer
} from '@x402/core/types';
import type { AgentPayServerSchemeConfig, SigningKeysConfig, ServiceAgentPaySigner } from '../../config';
import { toServiceAgentPaySigner } from '../../signer';
import { QuoteTokenPayload, AgentPayPaymentExtra, ValidationError } from '../../types';
import { parseMoneyToDecimal } from '../../utils';
import { DEFAULT_QUOTE_VALIDITY_SECONDS, AGENT_PAY_SCHEME, AGENT_PAY_SENTINEL_PAY_TO, AGENT_PAY_AUDIENCE } from '../../constants';

// Use Node.js crypto for UUID generation
const crypto = webcrypto;

/**
 * Agent Pay server implementation for resource services.
 * Generates 402 responses with quote tokens.
 */
export class AgentPayScheme implements SchemeNetworkServer {
  readonly scheme = AGENT_PAY_SCHEME;
  private readonly signer: ServiceAgentPaySigner;

  /**
   * Create a new Agent Pay server scheme
   * @param config - Server configuration with signing keys or custom signer
   */
  constructor(config: AgentPayServerSchemeConfig) {
    // Determine if we have a custom signer or need to create default
    if ('signer' in config) {
      this.signer = config.signer;
    } else if ('signingKeys' in config && 'serviceUrl' in config) {
      // Create default signer from config using adapter function
      this.signer = toServiceAgentPaySigner(
        config.signingKeys.privateKey,
        config.signingKeys.publicKey,
        config.serviceUrl
      );
    } else {
      throw new ValidationError('AgentPayServerScheme requires either signer or signingKeys + serviceUrl');
    }
  }

  /**
   * Parse a price into an asset amount
   * 
   * @param price - Price to parse (string, number, or AssetAmount)
   * @param network - Network identifier
   * @returns Asset amount
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    // If already an AssetAmount, return it
    if (typeof price === 'object' && 'amount' in price) {
      return price;
    }

    // Parse money string/number to amount and currency
    const { amount, currency } = parseMoneyToDecimal(price);

    return {
      amount: amount.toString(),
      asset: `iso4217:${currency}`,
      extra: {}
    };
  }

  /**
   * Enhance payment requirements with Agent Pay-specific data
   * 
   * @param paymentRequirements - Base payment requirements
   * @param supportedKind - Supported kind from facilitator
   * @param extensionKeys - Extension keys supported by facilitator
   * @returns Enhanced payment requirements with quote token
   */
  async enhancePaymentRequirements(
    paymentRequirements: PaymentRequirements,
    supportedKind: {
      x402Version: number;
      scheme: string;
      network: Network;
      extra?: Record<string, unknown>;
    },
    extensionKeys: string[]
  ): Promise<PaymentRequirements> {
    // Extract amount and currency
    const amount = paymentRequirements.amount;
    const currency = paymentRequirements.asset.replace('iso4217:', '');

    // Create quote token payload
    const now = Math.floor(Date.now() / 1000);
    const quotePayload: QuoteTokenPayload = {
      iss: this.signer.getServiceUrl(),
      aud: AGENT_PAY_AUDIENCE,
      iat: now,
      exp: now + (paymentRequirements.maxTimeoutSeconds || DEFAULT_QUOTE_VALIDITY_SECONDS),
      jti: crypto.randomUUID(),
      price: {
        amount,
        currency
      },
      payTo: paymentRequirements.payTo,
      reference: (paymentRequirements.extra?.reference as string) || 'RESOURCE',
      description: paymentRequirements.extra?.description as string | undefined,
      dimensions: paymentRequirements.extra?.dimensions as Record<string, string | number> | undefined,
      settlement: paymentRequirements.extra?.settlement as any,
      support: paymentRequirements.extra?.support as any,
      terms: paymentRequirements.extra?.terms as any
    };

    // Sign quote token
    const quoteToken = await this.signer.signQuote(quotePayload);

    // Add quote token to extra
    const extra: AgentPayPaymentExtra = {
      ...paymentRequirements.extra,
      quoteToken
    };

    // Return enhanced requirements. payTo is redundant in Agent Pay and carries the
    // AGENT_PAY_SENTINEL_PAY_TO sentinel; maxTimeoutSeconds is the quote's real
    // validity window (exp - iat). The signed quote token is the authoritative source
    // for the recipient and expiry, so verifiers read them from the token.
    return {
      ...paymentRequirements,
      payTo: AGENT_PAY_SENTINEL_PAY_TO,
      maxTimeoutSeconds: quotePayload.exp - quotePayload.iat,
      extra: extra as unknown as Record<string, unknown>
    };
  }
}
