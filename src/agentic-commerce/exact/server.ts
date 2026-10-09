// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Seller side of the `exact` scheme on AWS Marketplace Agentic Commerce networks.
 *
 * Register it on an x402 resource server; x402 core then calls it to price each
 * route and to add a signed quote token to every 402 response:
 *
 * ```typescript
 * const server = new x402ResourceServer(facilitatorClient);
 * server.register('aws:base', new ExactAgenticCommerceServerScheme({ signer }));
 * ```
 *
 * Follows the Python SDK's `ExactAgenticCommerceScheme`
 * (fiat_extension_x402/agentic_commerce/exact/server.py:48-127 at commit 62230e6).
 */

import type {
  AssetAmount,
  Network,
  PaymentFlowConfig,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from '@x402/core/types';
import type { QuoteSigner } from '../../config';
import {
  ASSET_TRANSFER_METHOD,
  DEFAULT_ASSET,
  DYNAMIC_EXTRA_FIELDS,
  SCHEME_EXACT,
} from '../../constants';
import { ValidationError } from '../../types';
import { parseMoney } from '../../utils';
import { enhancePaymentRequirements } from './quote';

/**
 * Configuration of the `exact` server scheme
 */
export interface ExactAgenticCommerceServerSchemeConfig {
  /** Signs quote tokens. Its service URL becomes the quote's `iss`. */
  signer: QuoteSigner;
}

// Verify before the handler runs; settlement after it is a no-op because the
// service captures the payment when it issues the payment token (server.py:60-64).
const PAYMENT_FLOWS: Readonly<Record<string, PaymentFlowConfig>> = Object.freeze({
  [ASSET_TRANSFER_METHOD]: Object.freeze({
    supported: Object.freeze(['authorization'] as const),
    default: 'authorization',
  }),
});

/**
 * `exact` server scheme for AWS Marketplace Agentic Commerce.
 */
export class ExactAgenticCommerceScheme implements SchemeNetworkServer {
  readonly scheme = SCHEME_EXACT;
  readonly defaultAssetTransferMethod = ASSET_TRANSFER_METHOD;
  readonly paymentFlows = PAYMENT_FLOWS;
  /**
   * The quote token is signed fresh for every 402, so x402 core ignores it when
   * matching a buyer's `accepted` requirements against the route's. Every other
   * field of the requirements is deterministic for a route. The facilitator
   * checks the quote instead.
   */
  readonly dynamicExtraFields = [...DYNAMIC_EXTRA_FIELDS];
  private readonly signer: QuoteSigner;

  /**
   * @param config - The quote token signer
   */
  constructor(config: ExactAgenticCommerceServerSchemeConfig) {
    if (!config?.signer) {
      throw new ValidationError('ExactAgenticCommerceServerScheme requires a signer');
    }
    this.signer = config.signer;
  }

  /**
   * Convert a route price into a fiat amount and ISO 4217 asset.
   *
   * Amounts are decimal strings ("0.50"), not atomic units.
   *
   * @param price - "$1.50", "1.50 USD", 1.50, or an AssetAmount
   * @param network - Target network (pricing does not depend on it)
   * @returns The amount and asset
   * @throws ValidationError if the price cannot be parsed
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === 'object' && price !== null) {
      // server.py:95-98: Python validates the object as an AssetAmount.
      const { amount, asset } = price as Partial<AssetAmount>;
      if (typeof amount !== 'string' || typeof asset !== 'string') {
        throw new ValidationError(`Invalid price: ${JSON.stringify(price)}`);
      }
      return price;
    }
    const { amount, currency } = parseMoney(price);
    return { amount, asset: currency === 'USD' ? DEFAULT_ASSET : `iso4217:${currency}`, extra: {} };
  }

  /**
   * Sign a quote token for the requirements and embed it in `extra.quoteToken`.
   *
   * @param paymentRequirements - Base payment requirements; `payTo` is the product ID
   * @param supportedKind - Supported kind from the facilitator (unused)
   * @param extensionKeys - Extension keys supported by the facilitator (unused)
   * @returns Requirements with the quote token, the sentinel `payTo` and the
   *   quote's validity as `maxTimeoutSeconds`
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
    return enhancePaymentRequirements(paymentRequirements, this.signer);
  }
}
