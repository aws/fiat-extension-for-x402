// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Facilitator side of the `exact` scheme on AWS Marketplace Agentic Commerce networks.
 *
 * Follows the Python SDK's `ExactAgenticCommerceScheme`
 * (fiat_extension_x402/agentic_commerce/exact/facilitator.py at commit 62230e6).
 * Register it on an x402 facilitator, which can run in the seller's own
 * process (no network hop) or as a separate service.
 */

import type {
  DeepReadonly,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkFacilitator,
  SettleResponse,
  VerifyResponse,
} from '@x402/core/types';
import { decodeJwt } from 'jose';
import { AGENTIC_COMMERCE_CAIP_FAMILY, SCHEME_EXACT } from '../../constants';
import { ValidationError } from '../../types';
import { isPlainObject, isTruthy, pyStr } from '../python';
import type { AgenticCommerceVerifier, VerificationRequirements } from '../verifier';

/** Configuration of the `exact` facilitator scheme */
export interface ExactAgenticCommerceFacilitatorSchemeConfig {
  /** Verifies payment tokens. Configure it with the seller's key. */
  verifier: AgenticCommerceVerifier;
}

/**
 * `exact` facilitator scheme for AWS Marketplace Agentic Commerce.
 *
 * @example
 * ```typescript
 * const verifier = new AgenticCommerceVerifier({ sellerKeyResolver });
 * const facilitator = new x402Facilitator().register(
 *   'aws:base',
 *   new ExactAgenticCommerceFacilitatorScheme({ verifier })
 * );
 * ```
 */
export class ExactAgenticCommerceScheme implements SchemeNetworkFacilitator {
  readonly scheme = SCHEME_EXACT;
  readonly caipFamily = AGENTIC_COMMERCE_CAIP_FAMILY;
  private readonly paymentVerifier: AgenticCommerceVerifier;

  /**
   * @param config - The payment token verifier
   * @throws ValidationError if `verifier` is missing
   */
  constructor(config: ExactAgenticCommerceFacilitatorSchemeConfig) {
    if (!config?.verifier) {
      throw new ValidationError('ExactAgenticCommerceFacilitatorScheme requires a verifier');
    }
    this.paymentVerifier = config.verifier;
  }

  /** The payment token verifier */
  get verifier(): AgenticCommerceVerifier {
    return this.paymentVerifier;
  }

  /** No scheme-specific data is advertised. */
  getExtra(): Record<string, unknown> | undefined {
    return undefined;
  }

  /** No on-chain signers: the service authorizes payments. */
  getSigners(): string[] {
    return [];
  }

  /**
   * Verify the payment token in `payload.payload.paymentToken`.
   *
   * Never throws for an invalid payment: failures are returned as a
   * `VerifyResponse` with `isValid: false`, per the x402 facilitator contract.
   */
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse> {
    return verifyExactPayment(this.paymentVerifier, payload, requirements);
  }

  /**
   * Settle a verified payment: a no-op.
   *
   * The service captures the payment when it issues the payment token, so
   * there is nothing to settle. The payment id is returned as the transaction.
   */
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return Promise.resolve(settleExactPayment(payload, requirements));
  }
}

/**
 * The payment token in `payload.payload.paymentToken`; shared by the server
 * scheme's DPoP check and the facilitator, so both read the same token.
 *
 * @internal
 */
export function paymentTokenOf(payload: DeepReadonly<PaymentPayload>): unknown {
  const inner: unknown = payload?.payload;
  return isPlainObject(inner) ? inner.paymentToken : undefined;
}

/**
 * Verify an `exact` payment; shared by the facilitator scheme and
 * `AgenticCommerceFacilitatorClient`.
 *
 * @internal
 */
export async function verifyExactPayment(
  verifier: AgenticCommerceVerifier,
  payload: PaymentPayload,
  requirements: PaymentRequirements
): Promise<VerifyResponse> {
  const paymentToken = paymentTokenOf(payload);
  if (typeof paymentToken !== 'string' || !paymentToken) {
    return {
      isValid: false,
      invalidReason: 'invalid_payment',
      invalidMessage: 'Missing paymentToken in payment payload',
    };
  }
  const result = await verifier.verify(paymentToken, wireRequirements(payload, requirements));
  if (!result.isValid) {
    return {
      isValid: false,
      invalidReason: result.invalidReason,
      invalidMessage: result.invalidMessage,
    };
  }
  return result.payer === undefined ? { isValid: true } : { isValid: true, payer: result.payer };
}

/**
 * Settle an `exact` payment; shared by the facilitator scheme and
 * `AgenticCommerceFacilitatorClient`.
 *
 * @internal
 */
export function settleExactPayment(
  payload: PaymentPayload,
  requirements: PaymentRequirements
): SettleResponse {
  let claims: Record<string, unknown> = {};
  try {
    claims = decodeJwt(pyStr(paymentTokenOf(payload) || ''));
  } catch {
    // An undecodable token settles with an empty transaction, as in Python.
  }
  const response: SettleResponse = {
    success: true,
    transaction: isTruthy(claims.payment_id) ? pyStr(claims.payment_id) : '',
    network: requirements.network,
  };
  if (typeof claims.sub === 'string') {
    response.payer = claims.sub;
  }
  return response;
}

/**
 * The terms to verify the payment against.
 *
 * Price and asset come from `requirements`: the server's own requirements for
 * the route. The quote comes from the buyer's `accepted` requirements: x402
 * core matches those against the server's while ignoring the quote token
 * (signed afresh for every 402), so the server's copy holds a newer quote than
 * the one the buyer paid for. The quote is signed by the seller, which the
 * verifier checks. v1 payloads have no `accepted` and v1 requirements name
 * the amount `maxAmountRequired`.
 */
function wireRequirements(
  payload: PaymentPayload,
  requirements: PaymentRequirements
): VerificationRequirements {
  const server = requirements as Partial<PaymentRequirements> & { maxAmountRequired?: string };
  const accepted = (payload as { accepted?: { extra?: unknown } | null }).accepted;
  const quoteSource: { extra?: unknown } = accepted ?? requirements;
  const quoteToken = isPlainObject(quoteSource.extra) ? quoteSource.extra.quoteToken : undefined;
  return {
    amount: server.amount ?? server.maxAmountRequired,
    asset: server.asset,
    extra: { quoteToken },
    productId: routeProductId(requirements),
  };
}

/**
 * The route's product ID, read from the quote the server signed for this
 * request. The requirements come from the seller's own server (x402 core
 * passes its requirements, not the buyer's), so the quote is not re-verified.
 * An empty string, which no quote matches, when the server sent no quote.
 */
function routeProductId(requirements: PaymentRequirements): string {
  const extra: unknown = requirements.extra;
  const serverQuote = isPlainObject(extra) ? extra.quoteToken : undefined;
  try {
    const payTo = decodeJwt(String(serverQuote)).payTo;
    return typeof payTo === 'string' ? payTo : '';
  } catch {
    return '';
  }
}
