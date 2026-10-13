// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Quote tokens: the seller's signed statement of what a request costs. The
 * claims are always built in the same order; each quote has its own iat, exp
 * and jti.
 */

import { webcrypto } from 'node:crypto';
import type { PaymentRequirements } from '@x402/core/types';
import type { QuoteSigner } from '../../signers/protocol';
import {
  DEFAULT_QUOTE_VALIDITY_SECONDS,
  QUOTE_TOKEN_AUDIENCE,
  SENTINEL_PAY_TO,
} from '../../constants';
import { ValidationError, type QuoteTokenPayload } from '../../types';
import { stripWhitespace } from '../../utils';
import { isPlainObject, isTruthy } from '../json-value';

// Optional route details copied from `extra` into the quote when present.
const OPTIONAL_QUOTE_CLAIMS = ['description', 'dimensions', 'support', 'terms'] as const;

/**
 * Sign a quote token for the requirements and embed it in `extra.quoteToken`.
 *
 * `payTo` is the seller's AWS Marketplace product ID. It is signed into the
 * quote as `payTo` and as `settlement.product_id`, which the payment service
 * requires to settle the payment against the listing. Other `settlement`
 * fields can be supplied in `extra.settlement`; the outgoing `extra.settlement`
 * is left as the caller gave it, so only the quote carries `product_id`.
 *
 * The returned requirements carry the sentinel `payTo` and a
 * `maxTimeoutSeconds` equal to the quote's validity: the signed quote is the
 * authoritative source for both. The input is not modified.
 *
 * @param requirements - Base x402 payment requirements
 * @param signer - Signer for the quote token. Its service URL becomes `iss`.
 * @returns The enhanced payment requirements
 * @throws ValidationError if the signer's service URL or `payTo` is empty, or
 *   `extra.settlement.product_id` disagrees with `payTo`
 */
export async function enhancePaymentRequirements(
  requirements: PaymentRequirements,
  signer: Pick<QuoteSigner, 'signQuote' | 'getServiceUrl'>
): Promise<PaymentRequirements> {
  // The signer's service URL becomes the quote's `iss` claim.
  const issuer = signer.getServiceUrl();
  if (!issuer || !stripWhitespace(issuer)) {
    throw new ValidationError(
      'Cannot sign quote token: signer service URL (issuer) is empty. ' +
        'Configure a non-empty serviceUrl on the signer; it becomes the quote ' +
        "token's 'iss' claim, which the service requires."
    );
  }

  // `payTo` is the seller's AWS Marketplace product ID.
  const productId = stripWhitespace(String(requirements.payTo || ''));
  if (!productId) {
    throw new ValidationError("payTo must be the seller's AWS Marketplace product ID");
  }

  // `extra.settlement`, when given, must be an object; its product_id defaults
  // to payTo and must match it. A product_id of undefined counts as absent,
  // since JSON drops it.
  const extra: Record<string, unknown> = { ...requirements.extra };
  if (isTruthy(extra.settlement) && !isPlainObject(extra.settlement)) {
    throw new ValidationError('extra.settlement must be an object');
  }
  const settlement: Record<string, unknown> = isTruthy(extra.settlement)
    ? { ...(extra.settlement as Record<string, unknown>) }
    : {};
  if (settlement.product_id === undefined) {
    settlement.product_id = productId;
  } else if (settlement.product_id !== productId) {
    throw new ValidationError(
      'extra.settlement.product_id must match payTo (the AWS Marketplace product ID)'
    );
  }

  // A maxTimeoutSeconds of 0 falls back to the default.
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + (requirements.maxTimeoutSeconds || DEFAULT_QUOTE_VALIDITY_SECONDS);

  // Insertion order is the claim order on the wire.
  const claims: Record<string, unknown> = {
    iss: issuer,
    aud: QUOTE_TOKEN_AUDIENCE,
    iat,
    exp,
    jti: webcrypto.randomUUID(),
    price: {
      amount: requirements.amount,
      // Every occurrence of the prefix is removed.
      currency: (requirements.asset ?? '').split('iso4217:').join(''),
    },
    payTo: productId,
    reference: isTruthy(extra.reference) ? extra.reference : 'RESOURCE',
    settlement,
  };
  for (const name of OPTIONAL_QUOTE_CLAIMS) {
    if (extra[name] !== undefined && extra[name] !== null) {
      claims[name] = extra[name];
    }
  }

  // The claims are the QuoteTokenPayload fields, built above with their wire
  // types and order.
  extra.quoteToken = await signer.signQuote(claims as unknown as QuoteTokenPayload);
  return {
    ...requirements,
    payTo: SENTINEL_PAY_TO,
    maxTimeoutSeconds: exp - iat,
    extra,
  };
}
