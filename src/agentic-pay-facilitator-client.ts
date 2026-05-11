/**
 * Agentic Pay Facilitator Client
 * 
 * Implements FacilitatorClient interface by verifying payment tokens cryptographically.
 * In FAB, the Agentic Pay provider IS the facilitator - no separate facilitator service needed.
 * 
 * This adapter translates x402 facilitator calls to cryptographic verification:
 * - verify() → verifies JWT signatures (payment token + quote token)
 * - settle() → calls Agentic Pay's /capture endpoint
 * - getSupported() → fetches from /.well-known/x402-supported
 * 
 * Security is based on signatures, not transaction state lookups.
 */

import type { FacilitatorClient } from '@x402/core/http';
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse
} from '@x402/core/types';
import * as jose from 'jose';
import { FABPayloadV2, FABPaymentExtra } from './types';
import { decodeQuoteToken } from './utils';

/**
 * Optional authentication configuration for Agentic Pay API calls
 */
export interface AgenticPayFacilitatorAuthConfig {
  /**
   * Function to get authentication headers for Agentic Pay API calls
   * @returns Headers to include in requests
   */
  getAuthHeaders?: () => Promise<Record<string, string>>;
}

/**
 * Agentic Pay Facilitator Client
 * 
 * Calls Agentic Pay provider's API to verify and settle payments.
 * The Agentic Pay provider serves as the facilitator in FAB.
 */
export class AgenticPayFacilitatorClient implements FacilitatorClient {
  private jwksCache: Map<string, { jwks: jose.JSONWebKeySet; timestamp: number }> = new Map();
  private readonly JWKS_CACHE_TTL = 3600000; // 1 hour
  private readonly authConfig?: AgenticPayFacilitatorAuthConfig;
  private readonly networkFilter?: Set<Network>;

  /**
   * Create a new Agentic Pay facilitator client
   * 
   * @param agenticPayBaseUrl - Base URL of the Agentic Pay provider (e.g., 'https://pay.aws.amazon.com')
   * @param authConfig - Optional authentication configuration
   * @param networkFilter - Optional set of networks to claim. When set, getSupported()
   *   filters the Agentic Pay's response to only include kinds whose network is in this set.
   *   This prevents the FAB facilitator from shadowing the default facilitator for
   *   networks the integrator didn't intend to handle via FAB.
   */
  constructor(
    private readonly agenticPayBaseUrl: string,
    authConfig?: AgenticPayFacilitatorAuthConfig,
    networkFilter?: Set<Network>
  ) {
    // Remove trailing slash if present
    this.agenticPayBaseUrl = agenticPayBaseUrl.replace(/\/$/, '');
    this.authConfig = authConfig;
    this.networkFilter = networkFilter;
  }

  /**
   * Get supported payment kinds from Agentic Pay
   * 
   * @returns Supported payment kinds and extensions
   */
  async getSupported(): Promise<SupportedResponse> {
    const response = await fetch(`${this.agenticPayBaseUrl}/.well-known/x402-supported`);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch supported kinds: ${response.statusText}`);
    }
    
    const supported = await response.json() as SupportedResponse;

    // If network filter is set, only include kinds for registered networks.
    // This prevents the FAB facilitator from claiming networks the integrator
    // didn't explicitly choose, which would shadow the default facilitator.
    if (this.networkFilter) {
      supported.kinds = supported.kinds.filter(
        kind => this.networkFilter!.has(kind.network as Network)
      );
    }

    return supported;
  }

  /**
   * Verify a payment by checking JWT signatures
   * 
   * Security model:
   * 1. Verify payment token signature (proves Agentic Pay authorized it)
   * 2. Verify quote token signature (proves service issued it)
   * 3. Verify amounts match (prevents tampering)
   * 
   * The signed payment token IS the proof of payment.
   * Services should track processed transaction IDs for idempotency.
   * 
   * @param payload - Payment payload to verify
   * @param requirements - Payment requirements
   * @returns Verification response
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    try {
      const fabPayload = payload.payload as unknown as FABPayloadV2;
      const extra = requirements.extra as unknown as FABPaymentExtra;

      // 1. Fetch Agentic Pay's JWKS
      const agenticPayJWKS = await this.fetchJWKS(this.agenticPayBaseUrl);

      // 2. Verify payment token signature
      const { payload: paymentTokenPayload } = await jose.jwtVerify(
        fabPayload.paymentToken,
        jose.createLocalJWKSet(agenticPayJWKS)
      );

      // 3. Check payment token expiry
      const now = Math.floor(Date.now() / 1000);
      if (paymentTokenPayload.exp && paymentTokenPayload.exp < now) {
        return {
          isValid: false,
          invalidReason: 'expired',
          invalidMessage: 'Payment token expired'
        };
      }

      // 4. Extract quote token from payment context
      const quoteToken = (paymentTokenPayload.payment_context as any)?.quote_token;
      if (!quoteToken) {
        return {
          isValid: false,
          invalidReason: 'invalid_payment',
          invalidMessage: 'Missing quote token in payment context'
        };
      }

      // 5. Verify quote token matches requirements
      if (quoteToken !== extra.quoteToken) {
        return {
          isValid: false,
          invalidReason: 'invalid_payment',
          invalidMessage: 'Quote token mismatch'
        };
      }

      // 6. Decode and verify quote token
      const quote = decodeQuoteToken(quoteToken);
      
      // 7. Fetch service's JWKS
      const serviceJWKS = await this.fetchJWKS(quote.iss);

      // 8. Verify quote token signature
      await jose.jwtVerify(quoteToken, jose.createLocalJWKSet(serviceJWKS));

      // 9. Verify amounts match
      const quotePrice = Array.isArray(quote.price) ? quote.price[0] : quote.price;
      const reqCurrency = requirements.asset.replace('iso4217:', '');

      if (
        quotePrice.amount !== requirements.amount ||
        quotePrice.currency !== reqCurrency
      ) {
        return {
          isValid: false,
          invalidReason: 'invalid_payment',
          invalidMessage: 'Amount or currency mismatch'
        };
      }

      return {
        isValid: true,
        payer: paymentTokenPayload.sub as string
      };
    } catch (error) {
      return {
        isValid: false,
        invalidReason: 'verification_error',
        invalidMessage: error instanceof Error ? error.message : 'Verification failed'
      };
    }
  }

  /**
   * Settle a payment.
   * 
   * Agent Pay auto-captures on creation — there is no separate /capture endpoint.
   * This returns success immediately since the payment was already settled.
   * 
   * @param payload - Payment payload to settle
   * @param requirements - Payment requirements
   * @returns Settlement response (always success)
   */
  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    const fabPayload = payload.payload as unknown as FABPayloadV2;
    const paymentId = fabPayload.paymentId || fabPayload.transactionId || '';

    // Agent Pay auto-captures — no HTTP call needed.
    return {
      success: true,
      transaction: paymentId,
      network: requirements.network
    };
  }

  /**
   * Fetch JWKS from a URL with caching
   * 
   * @param baseUrl - Base URL to fetch JWKS from
   * @returns JWKS
   */
  private async fetchJWKS(baseUrl: string): Promise<jose.JSONWebKeySet> {
    const url = `${baseUrl}/.well-known/jwks.json`;
    const now = Date.now();

    // Check cache
    const cached = this.jwksCache.get(url);
    if (cached && now - cached.timestamp < this.JWKS_CACHE_TTL) {
      return cached.jwks;
    }

    // Fetch fresh JWKS
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKS from ${url}: ${response.statusText}`);
    }

    const jwks = await response.json() as jose.JSONWebKeySet;

    // Cache it
    this.jwksCache.set(url, { jwks, timestamp: now });

    return jwks;
  }
}
