// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agentic Commerce Facilitator Client
 *
 * Implements FacilitatorClient interface by verifying payment tokens cryptographically.
 * In Agentic Commerce, the Agentic Commerce provider IS the facilitator - no separate facilitator service needed.
 *
 * This adapter translates x402 facilitator calls to cryptographic verification:
 * - verify() → verifies JWT signatures (payment token + quote token)
 * - settle() → calls Agentic Commerce's /capture endpoint
 * - getSupported() → fetches from /.well-known/x402-supported
 *
 * Security is based on signatures, not transaction state lookups.
 */

import type { FacilitatorClient } from '@x402/core/http';
import { ALLOWED_ALGORITHMS, secureCompare } from '../security';
import {
  WELL_KNOWN_JWKS_PATH,
  WELL_KNOWN_X402_SUPPORTED_PATH,
  DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL,
} from '../constants';
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from '@x402/core/types';
import * as jose from 'jose';
import { AgenticCommercePayloadV2, AgenticCommercePaymentExtra, ValidationError } from '../types';
import { decodeQuoteToken } from '../utils';
import { verifyDPoPProof, extractDPoPThumbprint } from '../dpop';

/**
 * HTTP request context for DPoP verification.
 * Pass this when verifying payments that may be DPoP-bound.
 */
export interface VerifyRequestContext {
  /** HTTP method of the buyer's retry request (e.g. 'GET', 'POST') */
  method: string;
  /** Full URL of the buyer's retry request */
  url: string;
  /** DPoP proof JWT from the request's DPoP header */
  dpopProof?: string;
}

/**
 * Optional authentication configuration for Agentic Commerce API calls
 */
export interface AgenticCommerceFacilitatorAuthConfig {
  /**
   * Function to get authentication headers for Agentic Commerce API calls
   * @returns Headers to include in requests
   */
  getAuthHeaders?: () => Promise<Record<string, string>>;
}

/**
 * Resolves the seller's public key for quote token verification.
 *
 * Two strategies:
 * - KMS: provide `kmsKeyArn` + `credentials` — SDK calls `kms:GetPublicKey`
 * - JWKS: provide `jwksUrl` — SDK fetches `{jwksUrl}/.well-known/jwks.json`
 *
 * If omitted, the SDK falls back to fetching JWKS from the quote token's `iss` claim.
 */
export type SellerKeyResolver =
  | {
      type: 'kms';
      kmsKeyArn: string;
      region: string;
      credentials: () => Promise<{
        accessKeyId: string;
        secretAccessKey: string;
        sessionToken?: string;
      }>;
    }
  | { type: 'jwks'; jwksUrl: string };

/**
 * Agentic Commerce Facilitator Client
 *
 * Calls Agentic Commerce provider's API to verify and settle payments.
 * The Agentic Commerce provider serves as the facilitator in Agentic Commerce.
 */
export class AgenticCommerceFacilitatorClient implements FacilitatorClient {
  private readonly agenticCommerceBaseUrl: string;
  private jwksCache: Map<string, { jwks: jose.JSONWebKeySet; timestamp: number }> = new Map();
  private kmsKeyCache: Map<string, { key: jose.KeyLike; timestamp: number }> = new Map();
  private readonly JWKS_CACHE_TTL = 3600000; // 1 hour
  private readonly authConfig?: AgenticCommerceFacilitatorAuthConfig;
  private readonly networkFilter?: Set<Network>;
  private readonly jwksBaseUrl?: string;
  private readonly sellerKeyResolver?: SellerKeyResolver;

  /**
   * Create a new Agentic Commerce facilitator client
   *
   * @param agenticCommerceBaseUrl - Base URL of the Agentic Commerce provider (e.g., 'https://facilitator.example.com')
   * @param authConfig - Optional authentication configuration
   * @param networkFilter - Optional set of networks to claim. When set, getSupported()
   *   filters the Agentic Commerce's response to only include kinds whose network is in this set.
   * @param jwksBaseUrl - Base URL for fetching Agentic Commerce's JWKS (signing keys).
   *   Defaults to the production CDN. Override only for beta/testing.
   * @param sellerKeyResolver - How to resolve the seller's public key for quote token
   *   verification. If omitted, fetches JWKS from the quote token's `iss` claim.
   */
  constructor(
    agenticCommerceBaseUrl: string,
    authConfig?: AgenticCommerceFacilitatorAuthConfig,
    networkFilter?: Set<Network>,
    jwksBaseUrl?: string,
    sellerKeyResolver?: SellerKeyResolver
  ) {
    if (!agenticCommerceBaseUrl) {
      throw new ValidationError('agenticCommerceBaseUrl is required');
    }
    // Remove trailing slash if present
    this.agenticCommerceBaseUrl = agenticCommerceBaseUrl.replace(/\/$/, '');
    this.authConfig = authConfig;
    this.networkFilter = networkFilter;
    this.jwksBaseUrl = (jwksBaseUrl ?? DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL).replace(/\/$/, '');
    this.sellerKeyResolver = sellerKeyResolver;
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
    if (this.networkFilter) {
      supported.kinds = supported.kinds.filter((kind) =>
        this.networkFilter!.has(kind.network as Network)
      );
    }

    return supported;
  }

  /**
   * Verify a payment by checking JWT signatures
   *
   * Security model:
   * 1. Verify payment token signature (proves Agentic Commerce authorized it)
   * 2. Verify quote token signature (proves service issued it)
   * 3. Verify amounts match (prevents tampering)
   * 4. If payment token contains cnf.jkt (DPoP binding), verify the DPoP
   *    proof in requestContext matches the bound key thumbprint
   *
   * The signed payment token IS the proof of payment.
   * Services should track processed transaction IDs for idempotency.
   *
   * @param payload - Payment payload to verify
   * @param requirements - Payment requirements
   * @param requestContext - Optional HTTP request context for DPoP verification.
   *   Required if the buyer used DPoP (payment token will contain cnf.jkt).
   * @returns Verification response
   */
  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
    requestContext?: VerifyRequestContext
  ): Promise<VerifyResponse> {
    try {
      const apPayload = payload.payload as unknown as AgenticCommercePayloadV2;
      const extra = requirements.extra as unknown as AgenticCommercePaymentExtra;

      // 1. Fetch Agentic Commerce's JWKS
      const agenticCommerceJWKS = await this.fetchJWKS(this.agenticCommerceBaseUrl);

      // 2. Verify payment token signature (algorithm allowlist enforced)
      const { payload: paymentTokenPayload } = await jose.jwtVerify(
        apPayload.paymentToken,
        jose.createLocalJWKSet(agenticCommerceJWKS),
        { algorithms: ALLOWED_ALGORITHMS }
      );

      // 3. Check payment token expiry
      const now = Math.floor(Date.now() / 1000);
      if (paymentTokenPayload.exp && paymentTokenPayload.exp < now) {
        return {
          isValid: false,
          invalidReason: 'expired',
          invalidMessage: 'Payment token expired',
        };
      }

      // 4. Extract quote token — Agentic Commerce puts it at top level (quote_token),
      //    with fallback to payment_context.quote_token for backward compatibility
      const quoteToken =
        (paymentTokenPayload as any).quote_token ||
        (paymentTokenPayload.payment_context as any)?.quote_token;
      if (!quoteToken) {
        return {
          isValid: false,
          invalidReason: 'invalid_payment',
          invalidMessage: 'Missing quote token in payment JWT',
        };
      }

      // 5. Verify quote token matches requirements (constant-time comparison)
      if (!secureCompare(quoteToken, extra.quoteToken)) {
        return {
          isValid: false,
          invalidReason: 'invalid_payment',
          invalidMessage: 'Quote token mismatch',
        };
      }

      // 6. Decode and verify quote token
      const quote = decodeQuoteToken(quoteToken);

      // 7. Resolve seller's public key and verify quote token signature
      const sellerKey = await this.resolveSellerKey(quote.iss, quoteToken);
      await jose.jwtVerify(quoteToken, sellerKey as any, {
        algorithms: ALLOWED_ALGORITHMS,
      });

      // 9. Verify amounts match
      const quotePrice = Array.isArray(quote.price) ? quote.price[0] : quote.price;
      const reqCurrency = requirements.asset.replace('iso4217:', '');

      if (quotePrice.amount !== requirements.amount || quotePrice.currency !== reqCurrency) {
        return {
          isValid: false,
          invalidReason: 'invalid_payment',
          invalidMessage: 'Amount or currency mismatch',
        };
      }

      // 10. DPoP verification (if buyer opted in)
      const cnf = (paymentTokenPayload as any).cnf;
      if (cnf?.jkt) {
        if (!requestContext?.dpopProof) {
          return {
            isValid: false,
            invalidReason: 'dpop_required',
            invalidMessage: 'Payment token is DPoP-bound but no DPoP proof provided',
          };
        }
        const thumbprint = await extractDPoPThumbprint(requestContext.dpopProof);
        if (thumbprint !== cnf.jkt) {
          return {
            isValid: false,
            invalidReason: 'dpop_invalid',
            invalidMessage: 'DPoP proof thumbprint does not match payment token binding',
          };
        }
        await verifyDPoPProof(requestContext.dpopProof, {
          method: requestContext.method,
          url: requestContext.url,
        });
      }

      return {
        isValid: true,
        payer: paymentTokenPayload.sub as string,
      };
    } catch (error) {
      return {
        isValid: false,
        invalidReason: 'verification_error',
        invalidMessage: error instanceof Error ? error.message : 'Verification failed',
      };
    }
  }

  /**
   * Settle a payment.
   *
   * Agentic Commerce auto-captures on creation — there is no separate /capture endpoint.
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
    const apPayload = payload.payload as unknown as AgenticCommercePayloadV2;
    const paymentId = apPayload.paymentId || apPayload.transactionId || '';

    // Agentic Commerce auto-captures — no HTTP call needed.
    return {
      success: true,
      transaction: paymentId,
      network: requirements.network,
    };
  }

  /**
   * Resolve the seller's public key for quote token signature verification.
   *
   * Resolution order:
   * 1. If sellerKeyResolver is configured (KMS or JWKS), use it
   * 2. Otherwise, fall back to fetching JWKS from the quote token's `iss` claim
   */
  private async resolveSellerKey(
    issuer: string,
    quoteToken: string
  ): Promise<jose.KeyLike | jose.JWTVerifyGetKey> {
    if (!this.sellerKeyResolver) {
      // Default: fetch JWKS from issuer URL
      const jwks = await this.fetchJWKS(issuer);
      return jose.createLocalJWKSet(jwks) as jose.JWTVerifyGetKey;
    }

    if (this.sellerKeyResolver.type === 'jwks') {
      const jwks = await this.fetchJWKS(this.sellerKeyResolver.jwksUrl);
      return jose.createLocalJWKSet(jwks) as jose.JWTVerifyGetKey;
    }

    // KMS path: call GetPublicKey and import as KeyLike (cached)
    const arn = this.sellerKeyResolver.kmsKeyArn;
    const cached = this.kmsKeyCache.get(arn);
    if (cached && Date.now() - cached.timestamp < this.JWKS_CACHE_TTL) {
      return cached.key;
    }

    const { KMSClient, GetPublicKeyCommand } = await import('@aws-sdk/client-kms');
    const creds = await this.sellerKeyResolver.credentials();
    const kms = new KMSClient({
      region: this.sellerKeyResolver.region,
      credentials: creds,
    });
    const resp = await kms.send(new GetPublicKeyCommand({ KeyId: arn }));
    if (!resp.PublicKey) {
      throw new Error('KMS GetPublicKey returned no key material');
    }
    const key = await jose.importSPKI(
      `-----BEGIN PUBLIC KEY-----\n${Buffer.from(resp.PublicKey).toString('base64')}\n-----END PUBLIC KEY-----`,
      'ES384'
    );
    this.kmsKeyCache.set(arn, { key, timestamp: Date.now() });
    return key;
  }

  /**
   * Fetch JWKS from a URL with caching
   *
   * @param baseUrl - Base URL to fetch JWKS from
   * @returns JWKS
   */
  private async fetchJWKS(baseUrl: string): Promise<jose.JSONWebKeySet> {
    // For Agentic Commerce's own keys, use the dedicated JWKS CDN URL
    const isAgenticCommerceKeys = baseUrl === this.agenticCommerceBaseUrl;
    const effectiveBase = isAgenticCommerceKeys ? this.jwksBaseUrl! : baseUrl;
    const url = `${effectiveBase}${WELL_KNOWN_JWKS_PATH}`;

    // Agentic Commerce enforces Cache-Control: no-store on their JWKS endpoint.
    // Only cache seller keys (which are stable and fetched from seller's own JWKS).
    if (!isAgenticCommerceKeys) {
      const now = Date.now();
      const cached = this.jwksCache.get(url);
      if (cached && now - cached.timestamp < this.JWKS_CACHE_TTL) {
        return cached.jwks;
      }
    }

    // Fetch fresh JWKS
    const headers: Record<string, string> = {};
    if (this.authConfig?.getAuthHeaders) {
      Object.assign(headers, await this.authConfig.getAuthHeaders());
    }
    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Failed to fetch JWKS from ${url}: ${response.statusText}`);
    }

    const jwks = (await response.json()) as jose.JSONWebKeySet;

    // Cache seller keys only — Agentic Commerce keys are always fetched fresh
    if (!isAgenticCommerceKeys) {
      this.jwksCache.set(url, { jwks, timestamp: Date.now() });
    }

    return jwks;
  }
}
