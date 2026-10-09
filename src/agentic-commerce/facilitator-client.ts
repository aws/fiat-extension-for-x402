// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agentic Commerce Facilitator Client
 *
 * A `FacilitatorClient` that verifies payment tokens cryptographically in the
 * seller's process. In Agentic Commerce the payment service is the
 * facilitator, so no separate facilitator service is needed:
 * - verify() runs the `exact` facilitator scheme's verification
 * - settle() is a no-op: the service captured the payment when it issued the token
 * - getSupported() fetches `/.well-known/x402-supported` from the service
 *
 * The Python SDK has no counterpart; it registers the facilitator scheme on an
 * in-process x402 facilitator, which `ExactAgenticCommerceFacilitatorScheme`
 * with `InProcessFacilitatorClient` also does here.
 */

import type { FacilitatorClient } from '@x402/core/http';
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from '@x402/core/types';
import { WELL_KNOWN_X402_SUPPORTED_PATH } from '../constants';
import { ValidationError } from '../types';
import {
  settleExactPayment,
  verifyExactPayment,
  type VerifyRequestContext,
} from './exact/facilitator';
import type { SellerKeyResolver } from './keys';
import { AgenticCommerceVerifier } from './verifier';

export type { VerifyRequestContext };

/**
 * Optional authentication configuration for Agentic Commerce API calls
 */
export interface AgenticCommerceFacilitatorAuthConfig {
  /**
   * Headers sent when fetching the payment service's JWKS. They are never sent
   * to the seller's JWKS URL.
   * @returns Headers to include in requests
   */
  getAuthHeaders?: () => Promise<Record<string, string>>;
}

/** Configuration of {@link AgenticCommerceFacilitatorClient} */
export interface AgenticCommerceFacilitatorClientConfig extends AgenticCommerceFacilitatorAuthConfig {
  /** Base URL of the Agentic Commerce provider, which serves `/.well-known/x402-supported` */
  baseUrl: string;
  /** Where to find the seller's quote-signing key. Required. */
  sellerKeyResolver: SellerKeyResolver;
  /**
   * Networks to claim. When set, getSupported() only returns the provider's
   * kinds whose network is in this set.
   */
  networkFilter?: Set<Network>;
  /** Base URL of the payment service's JWKS. Defaults to the production endpoint. */
  paymentTokenJwksUrl?: string;
  /** Expected `iss` of payment tokens. Defaults to `PAYMENT_TOKEN_ISSUER`. */
  paymentTokenIssuer?: string;
}

/**
 * Agentic Commerce Facilitator Client
 *
 * @example
 * ```typescript
 * const facilitatorClient = new AgenticCommerceFacilitatorClient({
 *   baseUrl: 'https://facilitator.example.com',
 *   sellerKeyResolver: { type: 'kms', kmsKeyArn, region: 'us-east-1' },
 * });
 * const server = new x402ResourceServer(facilitatorClient);
 * ```
 */
export class AgenticCommerceFacilitatorClient implements FacilitatorClient {
  private readonly agenticCommerceBaseUrl: string;
  private readonly networkFilter?: Set<Network>;
  private readonly verifier: AgenticCommerceVerifier;

  /**
   * Create a new Agentic Commerce facilitator client
   *
   * @param config - The provider URL, the seller key resolver and the JWKS options
   * @throws ValidationError if `baseUrl` or `sellerKeyResolver` is missing
   */
  constructor(config: AgenticCommerceFacilitatorClientConfig) {
    if (typeof config !== 'object' || config === null || !config.baseUrl) {
      throw new ValidationError(
        'AgenticCommerceFacilitatorClient requires { baseUrl, sellerKeyResolver }'
      );
    }
    this.agenticCommerceBaseUrl = config.baseUrl.replace(/\/$/, '');
    this.networkFilter = config.networkFilter;
    const getAuthHeaders = config.getAuthHeaders;
    this.verifier = new AgenticCommerceVerifier({
      sellerKeyResolver: config.sellerKeyResolver,
      paymentTokenJwksUrl: config.paymentTokenJwksUrl,
      paymentTokenIssuer: config.paymentTokenIssuer,
      jwksRequestHeaders: getAuthHeaders ? () => getAuthHeaders() : undefined,
    });
  }

  /**
   * Get supported payment kinds from Agentic Commerce
   *
   * @returns Supported payment kinds and extensions
   */
  async getSupported(): Promise<SupportedResponse> {
    const response = await fetch(`${this.agenticCommerceBaseUrl}${WELL_KNOWN_X402_SUPPORTED_PATH}`);

    if (!response.ok) {
      throw new Error(`Failed to fetch supported kinds: ${response.statusText}`);
    }

    const supported = (await response.json()) as SupportedResponse;

    // If network filter is set, only include kinds for registered networks.
    // This prevents the Agentic Commerce facilitator from claiming networks the integrator
    // didn't explicitly choose, which would shadow the default facilitator.
    const networkFilter = this.networkFilter;
    if (networkFilter) {
      supported.kinds = supported.kinds.filter((kind) => networkFilter.has(kind.network));
    }

    return supported;
  }

  /**
   * Verify a payment, as the `exact` facilitator scheme does: the payment token
   * against the service's JWKS, the quote the buyer accepted against the
   * seller's key, and the price, currency and product against `requirements`.
   *
   * @param payload - Payment payload to verify
   * @param requirements - The server's payment requirements for the route
   * @param requestContext - HTTP request context for DPoP verification.
   *   Required if the buyer used DPoP (payment token will contain cnf.jkt).
   * @returns Verification response
   */
  verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    requestContext?: VerifyRequestContext
  ): Promise<VerifyResponse> {
    return verifyExactPayment(this.verifier, payload, requirements, requestContext);
  }

  /**
   * Settle a payment: a no-op returning the token's `payment_id` as the transaction.
   *
   * Agentic Commerce auto-captures on creation — there is no separate /capture endpoint.
   *
   * @param payload - Payment payload to settle
   * @param requirements - Payment requirements
   * @returns Settlement response (always success)
   */
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse> {
    return Promise.resolve(settleExactPayment(payload, requirements));
  }
}
