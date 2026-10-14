// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Seller side of the `exact` scheme on AWS Marketplace Agentic Commerce networks.
 *
 * Register it on an x402 resource server; x402 core then calls it to price each
 * route, to add a signed quote token to every 402 response, and before and
 * after each payment is verified (where it checks DPoP proofs):
 *
 * ```typescript
 * const server = new x402ResourceServer(facilitatorClient);
 * server.register('aws:base', new ExactAgenticCommerceServerScheme({ signer }));
 * ```
 */

import type {
  AssetAmount,
  Network,
  PaymentFlowConfig,
  PaymentRequirements,
  Price,
  SchemeNetworkServer,
} from '@x402/core/types';
import type {
  AfterVerifyHook,
  BeforeVerifyHook,
  HTTPAdapter,
  VerifyContext,
  VerifyResultContext,
} from '@x402/core/server';
import { decodeJwt } from 'jose';
import type { QuoteSigner } from '../../signers/protocol';
import {
  ASSET_TRANSFER_METHOD,
  DEFAULT_ASSET,
  DYNAMIC_EXTRA_FIELDS,
  SCHEME_EXACT,
} from '../../constants';
import { extractDPoPThumbprint, verifyDPoPProof } from '../../dpop';
import { CLOCK_SKEW } from '../../dpop/verification';
import { type DPoPNonceStore, ValidationError } from '../../types';
import { checkAssetAmount, parseMoney } from '../../utils';
import { isPlainObject, isTruthy, toInteger } from '../json-value';
import { paymentTokenOf } from './facilitator';
import { enhancePaymentRequirements } from './quote';

/** Default maximum age of a DPoP proof, in seconds. */
const DEFAULT_DPOP_MAX_AGE_SECONDS = 60;

/**
 * Configuration of the `exact` server scheme
 */
export interface ExactAgenticCommerceServerSchemeConfig {
  /** Signs quote tokens. Its service URL becomes the quote's `iss`. */
  signer: QuoteSigner;
  /**
   * Records DPoP proof `jti` values so a replayed proof is rejected. Use a store
   * shared by all instances of the seller. An id is checked and recorded only
   * after the facilitator has accepted the payment token.
   */
  dpopNonceStore?: DPoPNonceStore;
  /** Maximum age of a DPoP proof, in seconds. Defaults to 60. */
  dpopMaxAgeSeconds?: number;
}

const isObject = (value: unknown): value is object => typeof value === 'object' && value !== null;

/** The HTTP adapter of the request being paid for, if any */
function adapterOf(context: VerifyContext): HTTPAdapter | undefined {
  const transport = context.transportContext as { request?: { adapter?: HTTPAdapter } };
  return transport?.request?.adapter;
}

/** The result of a `beforeVerify` hook that stops the payment */
type AbortResult = { abort: true; reason: 'dpop_required' | 'dpop_invalid' };

// Verify before the handler runs; settlement after it is a no-op because the
// service captures the payment when it issues the payment token.
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
   * the DPoP proof of a DPoP-bound payment token. It runs `onAfterVerify` once
   * the facilitator has answered: for an accepted token, it rejects a replayed
   * proof and records the proof's `jti` in the nonce store.
   */
  readonly schemeHooks: {
    readonly onBeforeVerify: BeforeVerifyHook;
    readonly onAfterVerify: AfterVerifyHook;
  };
  private readonly signer: QuoteSigner;
  private readonly dpopNonceStore?: DPoPNonceStore;
  private readonly dpopMaxAgeSeconds: number;
  /** Proofs checked by onBeforeVerify, by transport context, until onAfterVerify */
  private readonly pendingProofs = new WeakMap<object, { jti: string; expiresAt: number }>();

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
      onAfterVerify: (context: VerifyResultContext) => this.afterVerify(context),
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
   * @throws ValidationError if the price cannot be parsed, or its amount has
   *   more than 8 decimal places
   */
  async parsePrice(price: Price, network: Network): Promise<AssetAmount> {
    if (typeof price === 'object' && price !== null) {
      // An object price must be an AssetAmount: a decimal amount with at most
      // 8 decimal places, as for a string price, and an ISO 4217 asset.
      const { amount, asset } = price as Partial<AssetAmount>;
      checkAssetAmount(amount, asset);
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
   * @throws ValidationError if the amount or asset is not one `parsePrice`
   *   returns, the signer's service URL or `payTo` is empty, or
   *   `extra.settlement.product_id` disagrees with `payTo`
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
   * Check the DPoP proof of a DPoP-bound payment token.
   *
   * A payment token bound to a key (`cnf.jkt`) is accepted only with a `DPoP`
   * header proving possession of that key, for this request's method and URL,
   * over this payment token. The token's signature is verified afterwards by
   * the facilitator, so a token whose binding was altered fails there. The
   * token is unverified here, so the nonce store is not touched until
   * onAfterVerify.
   *
   * x402 core logs and ignores an error thrown by a hook, and then calls the
   * facilitator, so every error here aborts with `dpop_invalid` instead.
   */
  private async beforeVerify(context: VerifyContext): Promise<AbortResult | undefined> {
    if (isObject(context.transportContext)) {
      // Drop what an earlier request with the same transport context left.
      this.pendingProofs.delete(context.transportContext);
    }
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
      const adapter = adapterOf(context);
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
      const { jti, iat } = await verifyDPoPProof(proof, {
        method,
        url,
        accessToken: paymentToken,
        maxAge: this.dpopMaxAgeSeconds,
      });
      if (this.dpopNonceStore != null) {
        // The id is checked and recorded in onAfterVerify, once the facilitator
        // has accepted the token: a forged token never reaches the store.
        const expiresAt = toInteger(iat)! + Math.floor(this.dpopMaxAgeSeconds + CLOCK_SKEW) + 1;
        this.pendingProofs.set(context.transportContext as object, { jti, expiresAt });
      }
    } catch {
      return { abort: true, reason: 'dpop_invalid' };
    }
    return undefined;
  }

  /**
   * Reject a replayed DPoP proof of a payment the facilitator accepted, and
   * record its id.
   *
   * With a synchronous store `has` and `add` run with no await in between, so
   * of concurrent requests with one proof only one passes.
   */
  private async afterVerify(context: VerifyResultContext): Promise<AbortResult | undefined> {
    const transport = context.transportContext;
    const pending = isObject(transport) ? this.pendingProofs.get(transport) : undefined;
    if (pending === undefined) {
      return undefined;
    }
    this.pendingProofs.delete(transport as object);
    if (!context.result.isValid) {
      return undefined;
    }
    if (Math.floor(Date.now() / 1000) >= pending.expiresAt) {
      // The proof went stale while the facilitator ran, and the store may
      // already have forgotten an earlier use of it.
      return { abort: true, reason: 'dpop_invalid' };
    }
    const store = this.dpopNonceStore as DPoPNonceStore;
    try {
      const seen = store.has(pending.jti);
      if (isTruthy(seen instanceof Promise ? await seen : seen)) {
        return { abort: true, reason: 'dpop_invalid' };
      }
      await store.add(pending.jti, pending.expiresAt);
    } catch {
      return { abort: true, reason: 'dpop_invalid' };
    }
    return undefined;
  }
}
