// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Seller side of the `exact` scheme on AWS Marketplace Agentic Commerce networks.
 *
 * Register it on an x402 resource server; x402 core then calls it to price each
 * route, to add a signed quote token to every 402 response, and before each
 * payment is verified (where it checks DPoP proofs):
 *
 * ```typescript
 * const server = new x402ResourceServer(facilitatorClient);
 * server.register('aws:base', new ExactAgenticCommerceServerScheme({ signer }));
 * ```
 *
 * Follows the Python SDK's `ExactAgenticCommerceScheme`
 * (fiat_extension_x402/agentic_commerce/exact/server.py:48-172 at commit 62230e6).
 */

import type {
  AssetAmount,
  Network,
  PaymentFlowConfig,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from '@x402/core/types';
import type { BeforeVerifyHook, HTTPAdapter, VerifyContext } from '@x402/core/server';
import { decodeJwt } from 'jose';
import type { QuoteSigner } from '../../config';
import {
  ASSET_TRANSFER_METHOD,
  DEFAULT_ASSET,
  DYNAMIC_EXTRA_FIELDS,
  SCHEME_EXACT,
} from '../../constants';
import { extractDPoPThumbprint, verifyDPoPProof } from '../../dpop';
import { type DPoPNonceStore, ValidationError } from '../../types';
import { parseMoney } from '../../utils';
import { isPlainObject } from '../python';
import { paymentTokenOf } from './facilitator';
import { enhancePaymentRequirements } from './quote';

/** Default maximum age of a DPoP proof, in seconds (server.py:42). */
const DEFAULT_DPOP_MAX_AGE_SECONDS = 60;

/**
 * Configuration of the `exact` server scheme
 */
export interface ExactAgenticCommerceServerSchemeConfig {
  /** Signs quote tokens. Its service URL becomes the quote's `iss`. */
  signer: QuoteSigner;
  /**
   * Records DPoP proof `jti` values so a replayed proof is rejected. Use a store
   * shared by all instances of the seller.
   */
  dpopNonceStore?: DPoPNonceStore;
  /** Maximum age of a DPoP proof, in seconds. Defaults to 60. */
  dpopMaxAgeSeconds?: number;
}

/** The result of a `beforeVerify` hook that stops the payment */
type AbortResult = { abort: true; reason: 'dpop_required' | 'dpop_invalid' };

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
  /**
   * x402 core runs `onBeforeVerify` before it calls the facilitator: it checks
   * the DPoP proof of a DPoP-bound payment token.
   */
  readonly schemeHooks: { readonly onBeforeVerify: BeforeVerifyHook };
  private readonly signer: QuoteSigner;
  private readonly dpopNonceStore?: DPoPNonceStore;
  private readonly dpopMaxAgeSeconds: number;

  /**
   * @param config - The quote token signer and the DPoP options
   * @throws ValidationError if `signer` is missing or `dpopMaxAgeSeconds` is
   *   not a finite number
   */
  constructor(config: ExactAgenticCommerceServerSchemeConfig) {
    if (!config?.signer) {
      throw new ValidationError('ExactAgenticCommerceServerScheme requires a signer');
    }
    this.signer = config.signer;
    const maxAge: unknown = config.dpopMaxAgeSeconds ?? DEFAULT_DPOP_MAX_AGE_SECONDS;
    if (typeof maxAge !== 'number' || !Number.isFinite(maxAge)) {
      // NaN would turn off the expiry check, and a string would concatenate.
      throw new ValidationError('dpopMaxAgeSeconds must be a finite number of seconds');
    }
    this.dpopNonceStore = config.dpopNonceStore;
    this.dpopMaxAgeSeconds = maxAge;
    this.schemeHooks = Object.freeze({
      onBeforeVerify: (context: VerifyContext) => this.beforeVerify(context),
    });
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

  /**
   * Check the DPoP proof of a DPoP-bound payment token (server.py:129-172).
   *
   * A payment token bound to a key (`cnf.jkt`) is accepted only with a `DPoP`
   * header proving possession of that key, for this request's method and URL,
   * over this payment token. The token's signature is verified afterwards by
   * the facilitator, so a token whose binding was altered fails there.
   *
   * x402 core logs and ignores an error thrown by a hook, and then calls the
   * facilitator, so every error here aborts with `dpop_invalid` instead.
   */
  private async beforeVerify(context: VerifyContext): Promise<AbortResult | undefined> {
    const paymentToken = paymentTokenOf(context.paymentPayload);
    if (typeof paymentToken !== 'string' || !paymentToken) {
      return undefined;
    }
    let cnf: unknown;
    try {
      cnf = decodeJwt(paymentToken).cnf;
    } catch {
      return undefined; // Malformed token: rejected by the facilitator.
    }
    if (!isPlainObject(cnf) || !Object.hasOwn(cnf, 'jkt')) {
      return undefined;
    }

    try {
      const transport = context.transportContext as { request?: { adapter?: HTTPAdapter } };
      const adapter = transport?.request?.adapter;
      if (adapter == null) {
        return { abort: true, reason: 'dpop_required' };
      }
      const proof = adapter.getHeader('DPoP') || adapter.getHeader('dpop');
      if (!proof) {
        return { abort: true, reason: 'dpop_required' };
      }
      if ((await extractDPoPThumbprint(proof)) !== cnf.jkt) {
        return { abort: true, reason: 'dpop_invalid' };
      }
      const method = adapter.getMethod().toUpperCase();
      const url = adapter.getUrl().split('?', 1)[0].split('#', 1)[0];
      if (!method || !url) {
        // verifyDPoPProof skips the htm or htu check when nothing is expected.
        return { abort: true, reason: 'dpop_invalid' };
      }
      await verifyDPoPProof(proof, {
        method,
        url,
        accessToken: paymentToken,
        maxAge: this.dpopMaxAgeSeconds,
        nonceStore: this.dpopNonceStore,
      });
    } catch {
      return { abort: true, reason: 'dpop_invalid' };
    }
    return undefined;
  }
}
