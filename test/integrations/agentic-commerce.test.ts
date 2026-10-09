// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import { x402Facilitator } from '@x402/core/facilitator';
import {
  HTTPAdapter,
  HTTPResponseInstructions,
  x402HTTPResourceServer,
  x402ResourceServer,
  FacilitatorClient,
} from '@x402/core/server';
import {
  Network,
  PaymentPayload,
  PaymentRequirements,
  SchemeNetworkServer,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from '@x402/core/types';
import * as jose from 'jose';
import { FakeBuyerScheme } from '../helpers/fake-buyer-scheme';
import { ExactAgenticCommerceScheme as APServer } from '../../src/agentic-commerce/exact/server';
import { ExactAgenticCommerceScheme } from '../../src/agentic-commerce/exact/server';
import { registerExactAgenticCommerceServer } from '../../src/agentic-commerce/exact/register';
import { InProcessFacilitatorClient } from '../../src/facilitator-client';
import { AgenticCommerceScheme as APFacilitator } from '../../src/agentic-commerce/facilitator/scheme';
import type { AgenticCommercePayloadV2 } from '../../src/types';
import { SCHEME_EXACT } from '../../src/constants';
import { SENTINEL_PAY_TO } from '../../src/constants';
import { createMockAgenticCommerceClient } from '../helpers/mock-agentic-commerce-client';
import { createMockServiceSigner } from '../helpers/mock-service-signer';
import { clearServiceJWKSCache } from '../../src/utils';

/**
 * Agentic Commerce Integration Tests
 *
 * Tests use mock Agentic Commerce client and service signer to simulate the complete Agentic Commerce flow.
 * In production:
 * - Client calls Agentic Commerce provider API to get payment tokens
 * - Facilitator fetches Agentic Commerce's public key from JWKS endpoint
 * - Service signs quote tokens with its own keys
 */

/**
 * Agentic Commerce Facilitator Client wrapper
 * Wraps the x402Facilitator for use with x402ResourceServer
 */
class APFacilitatorClient implements FacilitatorClient {
  readonly scheme = SCHEME_EXACT;
  readonly network = 'fab:aws';
  readonly x402Version = 2;

  constructor(private readonly facilitator: x402Facilitator) {}

  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    return this.facilitator.verify(paymentPayload, paymentRequirements);
  }

  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements
  ): Promise<SettleResponse> {
    return this.facilitator.settle(paymentPayload, paymentRequirements);
  }

  getSupported(): Promise<SupportedResponse> {
    return Promise.resolve(this.facilitator.getSupported());
  }
}

/**
 * Build Agentic Commerce payment requirements for testing
 */
function buildPaymentRequirements(
  payTo: string,
  amount: string,
  network: Network = 'fab:aws'
): PaymentRequirements {
  return {
    scheme: SCHEME_EXACT,
    network,
    asset: 'iso4217:USD',
    amount,
    payTo,
    maxTimeoutSeconds: 3600,
    extra: {
      capture: 'manual',
      reference: 'TEST',
    },
  };
}

describe('Agentic Commerce Integration Tests', () => {
  let servicePrivateKey: jose.KeyLike;
  let servicePublicKey: jose.KeyLike;
  let agenticCommercePrivateKey: jose.KeyLike;
  let agenticCommercePublicKey: jose.KeyLike;
  const serviceUrl = 'https://api.example.com';
  const agenticCommerceId = 'agentic-commerce-test-123';
  const mockFetch = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    clearServiceJWKSCache();

    // Generate service key pair (service signs quote tokens)
    const serviceKeys = await jose.generateKeyPair('RS256');
    servicePrivateKey = serviceKeys.privateKey;
    servicePublicKey = serviceKeys.publicKey;

    // Generate Agentic Commerce key pair (for mock signing in tests)
    const agenticCommerceKeys = await jose.generateKeyPair('RS256');
    agenticCommercePrivateKey = agenticCommerceKeys.privateKey;
    agenticCommercePublicKey = agenticCommerceKeys.publicKey;

    // Mock fetch to serve service JWKS for quote token verification
    const servicePublicJWK = await jose.exportJWK(servicePublicKey);
    servicePublicJWK.kid = 'test-service-key';
    servicePublicJWK.alg = 'RS256';
    servicePublicJWK.use = 'sig';

    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/.well-known/jwks.json')) {
        return { ok: true, json: async () => ({ keys: [servicePublicJWK] }) };
      }
      return { ok: false, statusText: 'Not Found' };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearServiceJWKSCache();
  });

  describe('x402Client / x402ResourceServer / x402Facilitator - Agentic Commerce Flow', () => {
    let client: x402Client;
    let server: x402ResourceServer;

    beforeEach(async () => {
      // Create mock Agentic Commerce client
      const agenticCommerceMock = await createMockAgenticCommerceClient(agenticCommerceId);

      // Create mock service signer
      const serviceMock = await createMockServiceSigner(serviceUrl);

      // Update JWKS mock to serve THIS test's service public key
      const svcPubJWK = await jose.exportJWK(serviceMock.publicKey);
      svcPubJWK.kid = 'test-service-key';
      svcPubJWK.alg = 'RS256';
      svcPubJWK.use = 'sig';
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/.well-known/jwks.json')) {
          return { ok: true, json: async () => ({ keys: [svcPubJWK] }) };
        }
        return { ok: false, statusText: 'Not Found' };
      });
      clearServiceJWKSCache();

      // Create client with Agentic Commerce client
      const apClient = new FakeBuyerScheme({
        agenticCommerceClient: agenticCommerceMock.agenticCommerceClient,
      });
      // The fake buyer is test-only. x402 core's buyer spend controls (core >= 2.23)
      // accept only default assets with atomic amounts, which fiat prices are not.
      client = new x402Client().setSpendControls(false).register('fab:aws', apClient);

      // Create facilitator with Agentic Commerce client
      const apFacilitator = new APFacilitator({
        agenticCommerceId,
        agenticCommerceClient: agenticCommerceMock.agenticCommerceClient,
      });
      const facilitator = new x402Facilitator().register('fab:aws', apFacilitator);

      const facilitatorClient = new APFacilitatorClient(facilitator);
      server = new x402ResourceServer(facilitatorClient);
      server.register('fab:aws', new APServer({ signer: serviceMock.signer }));
      await server.initialize();
    });

    it('server should successfully verify and settle a Agentic Commerce payment from a client', async () => {
      // Server - builds PaymentRequired response using buildPaymentRequirements
      const accepts = await server.buildPaymentRequirements({
        scheme: SCHEME_EXACT,
        network: 'fab:aws',
        payTo: 'service-pay-789',
        price: 0.15,
      });

      const resource = {
        url: 'https://company.co/api/resource',
        description: 'Company Co. API resource',
        mimeType: 'application/json',
      };
      const paymentRequired = await server.createPaymentRequiredResponse(accepts, resource);

      // Verify payment requirements structure
      expect(paymentRequired).toBeDefined();

      // Client - responds with PaymentPayload response
      const paymentPayload = await client.createPaymentPayload(paymentRequired);

      expect(paymentPayload).toBeDefined();
      expect(paymentPayload.x402Version).toBe(2);
      expect(paymentPayload.accepted.scheme).toBe(SCHEME_EXACT);

      // Verify the payload structure
      const apPayload = paymentPayload.payload as unknown as AgenticCommercePayloadV2;
      expect(apPayload.paymentToken).toBeDefined();
      expect(apPayload.transactionId).toBeDefined();
      expect(apPayload.transactionId).toMatch(/^awsmp-/);

      // Decode and verify payment token structure (Agentic Commerce format)
      const decodedPayment = jose.decodeJwt(apPayload.paymentToken);
      expect(decodedPayment.iss).toBe('awsmp-agentpay.amazonaws.com');
      expect(decodedPayment.sub).toBe(agenticCommerceId);
      expect((decodedPayment as any).payment_context).toBeDefined();
      expect((decodedPayment as any).payment_context.transaction_id).toBe(apPayload.transactionId);
      expect((decodedPayment as any).payment_context.quote_token).toBeDefined();

      // Server - maps payment payload to payment requirements
      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      expect(accepted).toBeDefined();

      const verifyResponse = await server.verifyPayment(paymentPayload, accepted!);

      if (!verifyResponse.isValid) {
        console.log('❌ Verification failed!');
        console.log('Invalid reason:', verifyResponse.invalidReason);
        console.log('Invalid message:', verifyResponse.invalidMessage);
        console.log('Payer:', verifyResponse.payer);
        console.log('Agentic Commerce ID:', agenticCommerceId);
        console.log('Payload:', JSON.stringify(paymentPayload, null, 2));
      }

      expect(verifyResponse.isValid).toBe(true);
      expect(verifyResponse.payer).toBe(agenticCommerceId);

      // Server does work here

      const settleResponse = await server.settlePayment(paymentPayload, accepted!);
      expect(settleResponse.success).toBe(true);
      expect(settleResponse.network).toBe('fab:aws');
      expect(settleResponse.transaction).toBe(apPayload.transactionId);
    });
  });

  // The stock x402 HTTP server (x402HTTPResourceServer, which @x402/express and
  // the other framework middlewares wrap) with the exact scheme and an
  // in-process facilitator. The stock server rebuilds the requirements on the
  // paid retry, so it signs a new quote token; the exact scheme declares
  // quoteToken as a dynamic extra field, so core leaves it out of the match.
  describe('x402HTTPClient / x402HTTPResourceServer / x402Facilitator - Agentic Commerce Flow', () => {
    let client: x402HTTPClient;
    let httpServer: x402HTTPResourceServer;
    let signQuote: ReturnType<typeof vi.spyOn>;

    const routes = {
      '/api/protected': {
        accepts: {
          scheme: SCHEME_EXACT,
          payTo: 'prod-abc123',
          price: 0.15,
          network: 'aws:base' as Network,
        },
        description: 'Access to protected API',
        mimeType: 'application/json',
      },
    };

    const context = (headers: Record<string, string> = {}) => {
      const adapter: HTTPAdapter = {
        getHeader: (name: string) => headers[name],
        getMethod: () => 'GET',
        getPath: () => '/api/protected',
        getUrl: () => 'https://example.com/api/protected',
        getAcceptHeader: () => 'application/json',
        getUserAgent: () => 'TestClient/1.0',
      };
      return { adapter, path: '/api/protected', method: 'GET' };
    };

    /** The 402 for an unpaid request, as the buyer receives it */
    async function paymentRequired() {
      const result = await httpServer.processHTTPRequest(context());
      expect(result.type).toBe('payment-error');
      const response = (result as { type: 'payment-error'; response: HTTPResponseInstructions })
        .response;
      expect(response.status).toBe(402);
      expect(response.headers['PAYMENT-REQUIRED']).toBeDefined();
      return client.getPaymentRequiredResponse((name) => response.headers[name], response.body);
    }

    async function setUp(serverScheme?: SchemeNetworkServer) {
      const agenticCommerceMock = await createMockAgenticCommerceClient(agenticCommerceId);
      const serviceMock = await createMockServiceSigner(serviceUrl);
      signQuote = vi.spyOn(serviceMock.signer, 'signQuote');

      const svcPubJWK = await jose.exportJWK(serviceMock.publicKey);
      mockFetch.mockImplementation(async (url: string) => {
        if (new URL(url).pathname === '/.well-known/jwks.json') {
          return { ok: true, json: async () => ({ keys: [svcPubJWK] }) };
        }
        return { ok: false, statusText: 'Not Found' };
      });

      const apFacilitator = new APFacilitator({
        agenticCommerceId,
        agenticCommerceClient: agenticCommerceMock.agenticCommerceClient,
      });
      const facilitator = new x402Facilitator().register('aws:base', apFacilitator);

      const apClient = new FakeBuyerScheme({
        agenticCommerceClient: agenticCommerceMock.agenticCommerceClient,
      });
      // The fake buyer is test-only. x402 core's buyer spend controls (core >= 2.23)
      // accept only default assets with atomic amounts, which fiat prices are not.
      client = new x402HTTPClient(
        new x402Client().setSpendControls(false).register('aws:base', apClient)
      );

      const resourceServer = new x402ResourceServer(new InProcessFacilitatorClient(facilitator));
      if (serverScheme) {
        resourceServer.register('aws:base', serverScheme);
      } else {
        registerExactAgenticCommerceServer(resourceServer, { signer: serviceMock.signer });
      }
      await resourceServer.initialize();
      httpServer = new x402HTTPResourceServer(resourceServer, routes);
      return serviceMock;
    }

    it('middleware should successfully verify and settle a Agentic Commerce payment from an http client', async () => {
      await setUp();

      // No payment made: the 402 carries one exact accept with a quote token.
      const required = await paymentRequired();
      expect(required.accepts).toHaveLength(1);
      expect(required.accepts[0]).toMatchObject({
        scheme: 'exact',
        network: 'aws:base',
        amount: '0.15',
        asset: 'iso4217:USD',
        payTo: SENTINEL_PAY_TO,
        maxTimeoutSeconds: 300,
      });

      // Client responds to PaymentRequired and submits a request with a PaymentPayload
      const paymentPayload = await client.createPaymentPayload(required);
      expect(paymentPayload.accepted.scheme).toBe(SCHEME_EXACT);
      const paidQuote = (paymentPayload.accepted.extra as { quoteToken: string }).quoteToken;
      const requestHeaders = await client.encodePaymentSignatureHeader(paymentPayload);

      // Middleware handles the PAYMENT-SIGNATURE request, as @x402/express does
      // (@x402/express 2.28.0 dist/cjs/index.js:224 and :368-375).
      const paidContext = context(requestHeaders);
      const paid = await httpServer.processHTTPRequest(paidContext);

      expect(paid.type).toBe('payment-verified');
      const verified = paid as Extract<typeof paid, { type: 'payment-verified' }>;
      const { paymentRequirements: verifiedRequirements } = verified;

      // The paid retry re-minted the quote; it still matched the buyer's accept.
      expect(signQuote).toHaveBeenCalledTimes(2);
      const reMintedQuote = (verifiedRequirements.extra as { quoteToken: string }).quoteToken;
      expect(reMintedQuote).not.toBe(paidQuote);
      const { quoteToken: _a, ...acceptedExtra } = paymentPayload.accepted.extra;
      const { quoteToken: _b, ...matchedExtra } = verifiedRequirements.extra;
      expect({ ...verifiedRequirements, extra: matchedExtra }).toEqual({
        ...paymentPayload.accepted,
        extra: acceptedExtra,
      });

      const settlementResult = await httpServer.processSettlement(
        verified.paymentPayload,
        verifiedRequirements,
        verified.declaredExtensions,
        { request: paidContext, responseBody: Buffer.from('{}'), responseHeaders: {} },
        undefined,
        verified.beforeHandlerSettlement
      );

      expect(settlementResult.success).toBe(true);
      if (settlementResult.success) {
        const receipt = client.getPaymentSettleResponse((name) => settlementResult.headers[name]);
        const { paymentId } = paymentPayload.payload as unknown as AgenticCommercePayloadV2;
        expect(receipt).toMatchObject({
          success: true,
          transaction: paymentId,
          network: 'aws:base',
        });
      }
    });

    it('rejects a paid retry whose accept was changed by the buyer', async () => {
      await setUp();
      const required = await paymentRequired();
      const paymentPayload = await client.createPaymentPayload(required);
      const cheaper = {
        ...paymentPayload,
        accepted: { ...paymentPayload.accepted, amount: '0.01' },
      };

      const result = await httpServer.processHTTPRequest(
        context(await client.encodePaymentSignatureHeader(cheaper))
      );

      expect(result.type).toBe('payment-error');
      const { response } = result as { type: 'payment-error'; response: HTTPResponseInstructions };
      expect(response.status).toBe(402);
      expect(
        client.getPaymentRequiredResponse((name) => response.headers[name], response.body).error
      ).toBe('No matching payment requirements');
    });

    it('without quoteToken as a dynamic extra field, the paid retry is not matched', async () => {
      // What happened before the exact scheme: the re-minted quote token made
      // the buyer's accept differ from every requirement the server built.
      const serviceMock = await createMockServiceSigner(serviceUrl);
      const legacy = new ExactAgenticCommerceScheme({ signer: serviceMock.signer });
      Object.defineProperty(legacy, 'dynamicExtraFields', { value: undefined });
      await setUp(legacy);

      const paymentPayload = await client.createPaymentPayload(await paymentRequired());
      const result = await httpServer.processHTTPRequest(
        context(await client.encodePaymentSignatureHeader(paymentPayload))
      );

      expect(result.type).toBe('payment-error');
      const { response } = result as { type: 'payment-error'; response: HTTPResponseInstructions };
      expect(
        client.getPaymentRequiredResponse((name) => response.headers[name], response.body).error
      ).toBe('No matching payment requirements');
    });
  });

  describe('Price Parsing Integration', () => {
    let server: x402ResourceServer;
    let apServer: APServer;

    beforeEach(async () => {
      // Create mock Agentic Commerce client
      const agenticCommerceMock = await createMockAgenticCommerceClient(agenticCommerceId);

      // Create mock service signer
      const serviceMock = await createMockServiceSigner(serviceUrl);

      const apFacilitator = new APFacilitator({
        agenticCommerceId,
        agenticCommerceClient: agenticCommerceMock.agenticCommerceClient,
      });
      const facilitator = new x402Facilitator().register('fab:aws', apFacilitator);

      const facilitatorClient = new APFacilitatorClient(facilitator);
      server = new x402ResourceServer(facilitatorClient);

      apServer = new APServer({ signer: serviceMock.signer });
      server.register('fab:aws', apServer);
      await server.initialize();
    });

    it('should parse Money formats and build payment requirements', async () => {
      const testCases = [
        { input: '$1.00', expectedAmount: '1.00' },
        { input: '1.50', expectedAmount: '1.50' },
        { input: '1.50 USD', expectedAmount: '1.50' },
        { input: 2.5, expectedAmount: '2.5' },
      ];

      for (const testCase of testCases) {
        const requirements = await server.buildPaymentRequirements({
          scheme: SCHEME_EXACT,
          payTo: 'service-pay',
          price: testCase.input,
          network: 'fab:aws' as Network,
        });

        expect(requirements).toHaveLength(1);
        expect(requirements[0].amount).toBe(testCase.expectedAmount);
        expect(requirements[0].asset).toBe('iso4217:USD');
        expect((requirements[0].extra as any).quoteToken).toBeDefined();
      }
    });

    it('should handle AssetAmount pass-through', async () => {
      const customAsset = {
        amount: '5.00',
        asset: 'iso4217:EUR',
        extra: { foo: 'bar' },
      };

      const requirements = await server.buildPaymentRequirements({
        scheme: SCHEME_EXACT,
        payTo: 'service-pay',
        price: customAsset,
        network: 'fab:aws' as Network,
      });

      expect(requirements).toHaveLength(1);
      expect(requirements[0].amount).toBe('5.00');
      expect(requirements[0].asset).toBe('iso4217:EUR');
      expect(requirements[0].extra?.foo).toBe('bar');
      expect((requirements[0].extra as any).quoteToken).toBeDefined();
    });

    it('should handle multiple currencies', async () => {
      const testCases = [
        { input: '1.50 USD', expectedAsset: 'iso4217:USD' },
        { input: '2.99 EUR', expectedAsset: 'iso4217:EUR' },
        { input: '3.49 GBP', expectedAsset: 'iso4217:GBP' },
      ];

      for (const testCase of testCases) {
        const requirements = await server.buildPaymentRequirements({
          scheme: SCHEME_EXACT,
          payTo: 'service-pay',
          price: testCase.input,
          network: 'fab:aws' as Network,
        });

        expect(requirements).toHaveLength(1);
        expect(requirements[0].asset).toBe(testCase.expectedAsset);
      }
    });

    it('should include quote token in all payment requirements', async () => {
      const requirements = await server.buildPaymentRequirements({
        scheme: SCHEME_EXACT,
        payTo: 'service-pay',
        price: 0.15,
        network: 'fab:aws' as Network,
      });

      expect(requirements).toHaveLength(1);
      expect((requirements[0].extra as any).quoteToken).toBeDefined();

      // Sentinel values: payTo should be sentinel, maxTimeoutSeconds should match quote validity
      expect(requirements[0].payTo).toBe(SENTINEL_PAY_TO);
      expect(requirements[0].maxTimeoutSeconds).toBe(300); // DEFAULT_QUOTE_VALIDITY_SECONDS

      // Decode and verify quote token
      const quoteToken = (requirements[0].extra as any).quoteToken;
      const decoded = jose.decodeJwt(quoteToken);
      expect(decoded.iss).toBe(serviceUrl);
      expect(decoded.aud).toBe('aws:marketplace');
      expect((decoded as any).price).toEqual({
        amount: '0.15',
        currency: 'USD',
      });
      // The real payTo lives inside the signed quote token
      expect((decoded as any).payTo).toBe('service-pay');
    });
  });

  describe('Quote and Payment Token Flow', () => {
    it('should create valid quote token with all required fields', async () => {
      // Create mock service signer
      const serviceMock = await createMockServiceSigner(serviceUrl);

      const quoteToken = await serviceMock.signer.signQuote({
        iss: serviceUrl,
        aud: 'aws:marketplace',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-pay',
        capture: 'manual',
        reference: 'TEST',
      });

      expect(quoteToken).toBeDefined();
      expect(typeof quoteToken).toBe('string');

      // Verify token can be decoded
      const decoded = jose.decodeJwt(quoteToken);
      expect(decoded.iss).toBe(serviceUrl);
      expect(decoded.aud).toBe('aws:marketplace');
      expect((decoded as any).price).toEqual({ amount: '1.50', currency: 'USD' });
    });

    it('should create valid payment token referencing quote token', async () => {
      // Create mock service signer and Agentic Commerce client
      const serviceMock = await createMockServiceSigner(serviceUrl);
      const agenticCommerceMock = await createMockAgenticCommerceClient(agenticCommerceId);

      // First create quote token
      const quoteToken = await serviceMock.signer.signQuote({
        iss: serviceUrl,
        aud: 'aws:marketplace',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-pay',
        capture: 'manual',
        reference: 'TEST',
      });

      // Then create payment token using Agentic Commerce client
      const result = await agenticCommerceMock.agenticCommerceClient.createPayment({
        quoteToken,
      });

      expect(result.paymentToken).toBeDefined();
      expect(typeof result.paymentToken).toBe('string');
      expect(result.paymentId).toBeDefined();

      // Verify token can be decoded
      const decoded = jose.decodeJwt(result.paymentToken);
      expect(decoded.iss).toBe('awsmp-agentpay.amazonaws.com');
      expect(decoded.sub).toBe(agenticCommerceId);
      expect((decoded as any).payment_context.quote_token).toBe(quoteToken);
    });
  });
});
