/**
 * FAB Server Scheme Implementation
 * 
 * In FAB, the "server" role is played by the resource service,
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
import type { FABServerSchemeConfig, SigningKeysConfig, ServiceFABSigner } from '../../config';
import { toServiceFABSigner } from '../../signer';
import { QuoteTokenPayload, FABPaymentExtra, ValidationError } from '../../types';
import { parseMoneyToDecimal } from '../../utils';
import { DEFAULT_QUOTE_VALIDITY_SECONDS, FAB_SCHEME, FAB_SENTINEL_PAY_TO } from '../../constants';

// Use Node.js crypto for UUID generation
const crypto = webcrypto;

/**
 * FAB server implementation for resource services.
 * Generates 402 responses with quote tokens.
 */
export class FABScheme implements SchemeNetworkServer {
  readonly scheme = FAB_SCHEME;
  private readonly signer: ServiceFABSigner;

  /**
   * Create a new FAB server scheme
   * @param config - Server configuration with signing keys or custom signer
   */
  constructor(config: FABServerSchemeConfig) {
    // Determine if we have a custom signer or need to create default
    if ('signer' in config) {
      this.signer = config.signer;
    } else if ('signingKeys' in config && 'serviceUrl' in config) {
      // Create default signer from config using adapter function
      this.signer = toServiceFABSigner(
        config.signingKeys.privateKey,
        config.signingKeys.publicKey,
        config.serviceUrl
      );
    } else {
      throw new ValidationError('FABServerScheme requires either signer or signingKeys + serviceUrl');
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
   * Enhance payment requirements with FAB-specific data
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
      aud: supportedKind.network,
      iat: now,
      exp: now + DEFAULT_QUOTE_VALIDITY_SECONDS,
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
    const extra: FABPaymentExtra = {
      ...paymentRequirements.extra,
      quoteToken
    };

    // Return enhanced requirements with sentinel values for fields that are
    // redundant in FAB. The signed quote token is the authoritative source for
    // payment recipient (payTo) and validity window (exp - iat).
    // See spec §2.4 "Sentinel Value Convention for x402 Core Fields".
    return {
      ...paymentRequirements,
      payTo: FAB_SENTINEL_PAY_TO,
      maxTimeoutSeconds: quotePayload.exp - quotePayload.iat,
      extra: extra as unknown as Record<string, unknown>
    };
  }
}
