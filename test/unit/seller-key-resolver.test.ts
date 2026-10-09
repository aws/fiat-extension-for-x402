// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * SellerKeyResolver Tests
 *
 * Tests the three quote token verification paths in AgenticCommerceFacilitatorClient:
 * 1. KMS-hosted key (calls kms:GetPublicKey)
 * 2. Explicit JWKS URL (fetches from configured URL)
 * 3. Fallback (fetches from quote token iss claim)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as jose from 'jose';
import { AgenticCommerceFacilitatorClient } from '../../src/agentic-commerce/facilitator-client';
import { AGENTIC_COMMERCE_SCHEME, QUOTE_TOKEN_AUDIENCE } from '../../src/constants';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';

/** Hostname of a mocked fetch() request, compared exactly (not as a substring). */
function requestHostname(reqUrl: string | URL | Request): string {
  const href =
    typeof reqUrl === 'string' ? reqUrl : reqUrl instanceof URL ? reqUrl.href : reqUrl.url;
  return new URL(href).hostname;
}

describe('SellerKeyResolver', () => {
  let sellerPrivateKey: jose.KeyLike;
  let sellerPublicKey: jose.KeyLike;
  let sellerPublicJWK: jose.JWK;
  let agenticCommercePrivateKey: jose.KeyLike;
  let agenticCommercePublicJWK: jose.JWK;
  const mockFetch = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);

    // Seller key pair (ES384 — matches KMS ECDSA_SHA_384)
    const sellerKeys = await jose.generateKeyPair('ES384');
    sellerPrivateKey = sellerKeys.privateKey;
    sellerPublicKey = sellerKeys.publicKey;
    sellerPublicJWK = await jose.exportJWK(sellerPublicKey);
    sellerPublicJWK.kid = 'seller-key-1';
    sellerPublicJWK.alg = 'ES384';
    sellerPublicJWK.use = 'sig';

    // Agentic Commerce key pair (ES384)
    const apKeys = await jose.generateKeyPair('ES384');
    agenticCommercePrivateKey = apKeys.privateKey;
    const apPubJWK = await jose.exportJWK(apKeys.publicKey);
    apPubJWK.kid = 'service-key-1';
    apPubJWK.alg = 'ES384';
    apPubJWK.use = 'sig';
    agenticCommercePublicJWK = apPubJWK;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Helper: create a signed quote token */
  async function createQuoteToken(issuer: string) {
    return new jose.SignJWT({
      price: { amount: '1.00', currency: 'USD' },
      payTo: 'seller-123',
      reference: 'RESOURCE',
    })
      .setProtectedHeader({ alg: 'ES384', typ: 'JWT' })
      .setIssuer(issuer)
      .setAudience(QUOTE_TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .setJti('quote-001')
      .sign(sellerPrivateKey);
  }

  /** Helper: create a signed payment token wrapping a quote */
  async function createPaymentToken(quoteToken: string, sellerIssuer: string) {
    return new jose.SignJWT({
      payment_id: 'awsmp-test-123',
      quote_token: quoteToken,
    })
      .setProtectedHeader({ alg: 'ES384', typ: 'JWT' })
      .setIssuer('awsmp-agentpay.amazonaws.com')
      .setAudience(sellerIssuer)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(agenticCommercePrivateKey);
  }

  /** Helper: mock fetch to return JWKS */
  function mockJwksEndpoint(url: string, jwk: jose.JWK) {
    mockFetch.mockImplementation(async (reqUrl: string | URL | Request, opts?: RequestInit) => {
      const hostname = requestHostname(reqUrl);
      if (hostname === new URL(url).hostname) {
        return new Response(JSON.stringify({ keys: [jwk] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('Not Found', { status: 404 });
    });
  }

  /** Helper: build payload + requirements for verify() */
  function buildVerifyInputs(paymentToken: string, quoteToken: string) {
    const payload: PaymentPayload = {
      x402Version: 2,
      scheme: AGENTIC_COMMERCE_SCHEME,
      network: 'aws:base',
      payload: {
        paymentToken,
        paymentId: 'awsmp-test-123',
        transactionId: 'awsmp-test-123',
      } as any,
    };
    const requirements: PaymentRequirements = {
      scheme: AGENTIC_COMMERCE_SCHEME,
      network: 'aws:base',
      amount: '1.00',
      asset: 'iso4217:USD',
      payTo: 'seller-123',
      maxTimeoutSeconds: 300,
      extra: { quoteToken } as any,
    };
    return { payload, requirements };
  }

  describe('fallback: fetches JWKS from iss claim', () => {
    it('should verify when seller hosts JWKS at their iss URL', async () => {
      const issuer = 'https://api.seller.com';
      const quoteToken = await createQuoteToken(issuer);
      const paymentToken = await createPaymentToken(quoteToken, issuer);

      // Mock: Agentic Commerce JWKS + seller JWKS at iss URL
      mockFetch.mockImplementation(async (reqUrl: string | URL | Request) => {
        const hostname = requestHostname(reqUrl);
        if (hostname === 'payments.example.com') {
          return new Response(JSON.stringify({ keys: [agenticCommercePublicJWK] }), {
            status: 200,
          });
        }
        if (hostname === 'api.seller.com') {
          return new Response(JSON.stringify({ keys: [sellerPublicJWK] }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      });

      const client = new AgenticCommerceFacilitatorClient(
        'https://payments.example.com',
        undefined,
        undefined,
        'https://payments.example.com' // jwksBaseUrl = same as base so mock matches
      );
      const { payload, requirements } = buildVerifyInputs(paymentToken, quoteToken);
      const result = await client.verify(payload, requirements);

      expect(result.isValid).toBe(true);
    });

    it('should fail when seller iss has no JWKS endpoint', async () => {
      const issuer = 'https://no-jwks.seller.com';
      const quoteToken = await createQuoteToken(issuer);
      const paymentToken = await createPaymentToken(quoteToken, issuer);

      mockFetch.mockImplementation(async (reqUrl: string | URL | Request) => {
        const hostname = requestHostname(reqUrl);
        if (hostname === 'payments.example.com') {
          return new Response(JSON.stringify({ keys: [agenticCommercePublicJWK] }), {
            status: 200,
          });
        }
        return new Response('Not Found', { status: 404 });
      });

      const client = new AgenticCommerceFacilitatorClient(
        'https://payments.example.com',
        undefined,
        undefined,
        'https://payments.example.com'
      );
      const { payload, requirements } = buildVerifyInputs(paymentToken, quoteToken);
      const result = await client.verify(payload, requirements);

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('verification_error');
    });
  });

  describe('type: jwks — explicit JWKS URL', () => {
    it('should verify using explicit JWKS URL instead of iss', async () => {
      const issuer = 'https://api.seller.com';
      const jwksHost = 'https://keys.seller.com';
      const quoteToken = await createQuoteToken(issuer);
      const paymentToken = await createPaymentToken(quoteToken, issuer);

      mockFetch.mockImplementation(async (reqUrl: string | URL | Request) => {
        const hostname = requestHostname(reqUrl);
        if (hostname === 'payments.example.com') {
          return new Response(JSON.stringify({ keys: [agenticCommercePublicJWK] }), {
            status: 200,
          });
        }
        if (hostname === 'keys.seller.com') {
          return new Response(JSON.stringify({ keys: [sellerPublicJWK] }), { status: 200 });
        }
        // iss URL should NOT be called
        if (hostname === 'api.seller.com') {
          throw new Error('Should not fetch from iss when jwksUrl is configured');
        }
        return new Response('Not Found', { status: 404 });
      });

      const client = new AgenticCommerceFacilitatorClient(
        'https://payments.example.com',
        undefined,
        undefined,
        'https://payments.example.com',
        { type: 'jwks', jwksUrl: jwksHost }
      );
      const { payload, requirements } = buildVerifyInputs(paymentToken, quoteToken);
      const result = await client.verify(payload, requirements);

      expect(result.isValid).toBe(true);
    });
  });

  describe('type: kms — KMS GetPublicKey', () => {
    it('should verify using KMS-resolved public key', async () => {
      const issuer = 'https://api.seller.com';
      const quoteToken = await createQuoteToken(issuer);
      const paymentToken = await createPaymentToken(quoteToken, issuer);

      // Export seller public key as DER for KMS mock
      const spki = await jose.exportSPKI(sellerPublicKey);
      const derBytes = Buffer.from(
        spki
          .replace('-----BEGIN PUBLIC KEY-----', '')
          .replace('-----END PUBLIC KEY-----', '')
          .replace(/\n/g, ''),
        'base64'
      );

      // Mock Agentic Commerce JWKS fetch only
      mockFetch.mockImplementation(async (reqUrl: string | URL | Request) => {
        const hostname = requestHostname(reqUrl);
        if (hostname === 'payments.example.com') {
          return new Response(JSON.stringify({ keys: [agenticCommercePublicJWK] }), {
            status: 200,
          });
        }
        throw new Error('Should not fetch seller JWKS when KMS resolver is configured');
      });

      // Mock the dynamic import of @aws-sdk/client-kms
      vi.doMock('@aws-sdk/client-kms', () => ({
        KMSClient: class {
          send() {
            return Promise.resolve({ PublicKey: derBytes });
          }
        },
        GetPublicKeyCommand: class {
          constructor(public input: any) {}
        },
      }));

      const client = new AgenticCommerceFacilitatorClient(
        'https://payments.example.com',
        undefined,
        undefined,
        'https://payments.example.com',
        {
          type: 'kms',
          kmsKeyArn: 'arn:aws:kms:us-east-1:123456789:alias/test-key',
          region: 'us-east-1',
          credentials: async () => ({ accessKeyId: 'AKIA...', secretAccessKey: 'secret' }),
        }
      );
      const { payload, requirements } = buildVerifyInputs(paymentToken, quoteToken);
      const result = await client.verify(payload, requirements);

      expect(result.isValid).toBe(true);
      vi.doUnmock('@aws-sdk/client-kms');
    });
  });

  describe('payment token verification', () => {
    it('should fail if payment token signature is invalid', async () => {
      const issuer = 'https://api.seller.com';
      const quoteToken = await createQuoteToken(issuer);
      // Sign with wrong key
      const wrongKey = (await jose.generateKeyPair('ES384')).privateKey;
      const badPaymentToken = await new jose.SignJWT({
        payment_id: 'awsmp-x',
        quote_token: quoteToken,
      })
        .setProtectedHeader({ alg: 'ES384', typ: 'JWT' })
        .setIssuer('awsmp-agentpay.amazonaws.com')
        .setAudience(issuer)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(wrongKey);

      mockJwksEndpoint('https://payments.example.com', agenticCommercePublicJWK);

      const client = new AgenticCommerceFacilitatorClient(
        'https://payments.example.com',
        undefined,
        undefined,
        'https://payments.example.com'
      );
      const { payload, requirements } = buildVerifyInputs(badPaymentToken, quoteToken);
      const result = await client.verify(payload, requirements);

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('verification_error');
    });

    it('should fail if quote token in payment JWT does not match requirements', async () => {
      const issuer = 'https://api.seller.com';
      const quoteToken = await createQuoteToken(issuer);
      const differentQuote = await createQuoteToken(issuer); // different jti
      const paymentToken = await createPaymentToken(differentQuote, issuer);

      mockFetch.mockImplementation(async (reqUrl: string | URL | Request) => {
        const hostname = requestHostname(reqUrl);
        if (hostname === 'payments.example.com') {
          return new Response(JSON.stringify({ keys: [agenticCommercePublicJWK] }), {
            status: 200,
          });
        }
        if (hostname === 'api.seller.com') {
          return new Response(JSON.stringify({ keys: [sellerPublicJWK] }), { status: 200 });
        }
        return new Response('Not Found', { status: 404 });
      });

      const client = new AgenticCommerceFacilitatorClient(
        'https://payments.example.com',
        undefined,
        undefined,
        'https://payments.example.com'
      );
      const { payload, requirements } = buildVerifyInputs(paymentToken, quoteToken);
      const result = await client.verify(payload, requirements);

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('invalid_payment');
      expect(result.invalidMessage).toBe('Quote token mismatch');
    });
  });
});
