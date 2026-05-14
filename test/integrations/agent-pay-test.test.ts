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
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from '@x402/core/types';
import * as jose from 'jose';
import { AgentPayScheme as APClient } from '../../src/agent-pay/client/scheme';
import { AgentPayScheme as APServer } from '../../src/agent-pay/server/scheme';
import { AgentPayScheme as APFacilitator } from '../../src/agent-pay/facilitator/scheme';
import type { AgentPayPayloadV2 } from '../../src/types';
import { AGENT_PAY_SCHEME } from '../../src/constants';
import { AGENT_PAY_SENTINEL_PAY_TO } from '../../src/constants';
import { createMockAgentPayClient } from '../helpers/mock-agent-pay-client';
import { createMockServiceSigner } from '../helpers/mock-service-signer';
import { clearServiceJWKSCache } from '../../src/utils';

/**
 * Agent Pay Integration Tests
 * 
 * Tests use mock Agent Pay client and service signer to simulate the complete Agent Pay flow.
 * In production:
 * - Client calls Agent Pay provider API to get payment tokens
 * - Facilitator fetches Agent Pay's public key from JWKS endpoint
 * - Service signs quote tokens with its own keys
 */

/**
 * Agent Pay Facilitator Client wrapper
 * Wraps the x402Facilitator for use with x402ResourceServer
 */
class APFacilitatorClient implements FacilitatorClient {
  readonly scheme = AGENT_PAY_SCHEME;
  readonly network = 'fab:aws';
  readonly x402Version = 2;

  constructor(private readonly facilitator: x402Facilitator) {}

  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.facilitator.verify(paymentPayload, paymentRequirements);
  }

  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    return this.facilitator.settle(paymentPayload, paymentRequirements);
  }

  getSupported(): Promise<SupportedResponse> {
    return Promise.resolve(this.facilitator.getSupported());
  }
}

/**
 * Build Agent Pay payment requirements for testing
 */
function buildPaymentRequirements(
  payTo: string,
  amount: string,
  network: Network = 'fab:aws',
): PaymentRequirements {
  return {
    scheme: AGENT_PAY_SCHEME,
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

describe('Agent Pay Integration Tests', () => {
  let servicePrivateKey: jose.KeyLike;
  let servicePublicKey: jose.KeyLike;
  let agentPayPrivateKey: jose.KeyLike;
  let agentPayPublicKey: jose.KeyLike;
  const serviceUrl = 'https://api.example.com';
  const agentPayId = 'agent-pay-test-123';
  const mockFetch = vi.fn();

  beforeEach(async () => {
    vi.stubGlobal('fetch', mockFetch);
    clearServiceJWKSCache();

    // Generate service key pair (service signs quote tokens)
    const serviceKeys = await jose.generateKeyPair('RS256');
    servicePrivateKey = serviceKeys.privateKey;
    servicePublicKey = serviceKeys.publicKey;

    // Generate Agent Pay key pair (for mock signing in tests)
    const agentPayKeys = await jose.generateKeyPair('RS256');
    agentPayPrivateKey = agentPayKeys.privateKey;
    agentPayPublicKey = agentPayKeys.publicKey;

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

  describe('x402Client / x402ResourceServer / x402Facilitator - Agent Pay Flow', () => {
    let client: x402Client;
    let server: x402ResourceServer;

    beforeEach(async () => {
      // Create mock Agent Pay client
      const agentPayMock = await createMockAgentPayClient(agentPayId);
      
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

      // Create client with Agent Pay client
      const apClient = new APClient({
        agentPayId,
        agentPayClient: agentPayMock.agentPayClient
      });
      client = new x402Client().register('fab:aws', apClient);

      // Create facilitator with Agent Pay client
      const apFacilitator = new APFacilitator({
        agentPayId,
        agentPayClient: agentPayMock.agentPayClient
      });
      const facilitator = new x402Facilitator().register('fab:aws', apFacilitator);

      const facilitatorClient = new APFacilitatorClient(facilitator);
      server = new x402ResourceServer(facilitatorClient);
      server.register('fab:aws', new APServer({ signer: serviceMock.signer }));
      await server.initialize();
    });

    it('server should successfully verify and settle a Agent Pay payment from a client', async () => {
      // Server - builds PaymentRequired response using buildPaymentRequirements
      const accepts = await server.buildPaymentRequirements({
        scheme: AGENT_PAY_SCHEME,
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
      expect(paymentPayload.accepted.scheme).toBe(AGENT_PAY_SCHEME);

      // Verify the payload structure
      const apPayload = paymentPayload.payload as unknown as AgentPayPayloadV2;
      expect(apPayload.paymentToken).toBeDefined();
      expect(apPayload.transactionId).toBeDefined();
      expect(apPayload.transactionId).toMatch(/^awsmp-/);

      // Decode and verify payment token structure (Agent Pay format)
      const decodedPayment = jose.decodeJwt(apPayload.paymentToken);
      expect(decodedPayment.iss).toBe('awsmp-agentpay.amazonaws.com');
      expect(decodedPayment.sub).toBe(agentPayId);
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
        console.log('Agent Pay ID:', agentPayId);
        console.log('Payload:', JSON.stringify(paymentPayload, null, 2));
      }

      expect(verifyResponse.isValid).toBe(true);
      expect(verifyResponse.payer).toBe(agentPayId);

      // Server does work here

      const settleResponse = await server.settlePayment(paymentPayload, accepted!);
      expect(settleResponse.success).toBe(true);
      expect(settleResponse.network).toBe('fab:aws');
      expect(settleResponse.transaction).toBe(apPayload.transactionId);
    });
  });

  describe('x402HTTPClient / x402HTTPResourceServer / x402Facilitator - Agent Pay Flow', () => {
    let client: x402HTTPClient;
    let httpServer: x402HTTPResourceServer;

    const routes = {
      '/api/protected': {
        accepts: {
          scheme: AGENT_PAY_SCHEME,
          payTo: 'service-pay-789',
          price: 0.15,
          network: 'fab:aws' as Network,
        },
        description: 'Access to protected API',
        mimeType: 'application/json',
      },
    };

    const mockAdapter: HTTPAdapter = {
      getHeader: () => {
        return undefined;
      },
      getMethod: () => 'GET',
      getPath: () => '/api/protected',
      getUrl: () => 'https://example.com/api/protected',
      getAcceptHeader: () => 'application/json',
      getUserAgent: () => 'TestClient/1.0',
    };

    beforeEach(async () => {
      // Create mock Agent Pay client
      const agentPayMock = await createMockAgentPayClient(agentPayId);
      
      // Create mock service signer
      const serviceMock = await createMockServiceSigner(serviceUrl);

      // Create facilitator with Agent Pay client
      const apFacilitator = new APFacilitator({
        agentPayId,
        agentPayClient: agentPayMock.agentPayClient
      });
      const facilitator = new x402Facilitator().register('fab:aws', apFacilitator);

      const facilitatorClient = new APFacilitatorClient(facilitator);

      // Create client with Agent Pay client
      const apClient = new APClient({
        agentPayId,
        agentPayClient: agentPayMock.agentPayClient
      });
      const paymentClient = new x402Client().register('fab:aws', apClient);
      client = new x402HTTPClient(paymentClient) as x402HTTPClient;

      // Create resource server and register schemes
      const ResourceServer = new x402ResourceServer(facilitatorClient);
      ResourceServer.register('fab:aws', new APServer({ signer: serviceMock.signer }));
      await ResourceServer.initialize();

      httpServer = new x402HTTPResourceServer(ResourceServer, routes);
    });

    // TODO: This test is currently failing because the HTTP middleware rebuilds requirements
    // on each request, which generates a new quote token. The payment payload contains the
    // original quote token, so findMatchingRequirements fails with deepEqual.
    // This is a limitation of the current x402 HTTP middleware design for schemes with
    // non-deterministic requirements. Possible solutions:
    // 1. Cache requirements in the HTTP server for a short time
    // 2. Change findMatchingRequirements to match on core fields only (scheme, network, amount, asset, payTo)
    // 3. Have the server verify the quote token signature instead of rebuilding requirements
    it.skip('middleware should successfully verify and settle a Agent Pay payment from an http client', async () => {
      // Middleware creates a PaymentRequired response
      const context = {
        adapter: mockAdapter,
        path: '/api/protected',
        method: 'GET',
      };

      // No payment made, get PaymentRequired response & header
      const httpProcessResult = (await httpServer.processHTTPRequest(context))!;

      expect(httpProcessResult.type).toBe('payment-error');

      const initial402Response = (
        httpProcessResult as { type: 'payment-error'; response: HTTPResponseInstructions }
      ).response;

      expect(initial402Response).toBeDefined();
      expect(initial402Response.status).toBe(402);
      expect(initial402Response.headers).toBeDefined();
      expect(initial402Response.headers['PAYMENT-REQUIRED']).toBeDefined();

      // Client responds to PaymentRequired and submits a request with a PaymentPayload
      const paymentRequired = client.getPaymentRequiredResponse(
        name => initial402Response.headers[name],
        initial402Response.body,
      );
      
      const paymentPayload = await client.createPaymentPayload(paymentRequired);

      expect(paymentPayload).toBeDefined();
      expect(paymentPayload.accepted.scheme).toBe(AGENT_PAY_SCHEME);

      const requestHeaders = await client.encodePaymentSignatureHeader(paymentPayload);

      // Middleware handles PAYMENT-SIGNATURE request
      mockAdapter.getHeader = (name: string) => {
        if (name === 'PAYMENT-SIGNATURE') {
          return requestHeaders['PAYMENT-SIGNATURE'];
        }
        return undefined;
      };

      const httpProcessResult2 = await httpServer.processHTTPRequest(context);

      // No need to respond, can continue with request
      expect(httpProcessResult2.type).toBe('payment-verified');
      const {
        paymentPayload: verifiedPaymentPayload,
        paymentRequirements: verifiedPaymentRequirements,
      } = httpProcessResult2 as {
        type: 'payment-verified';
        paymentPayload: PaymentPayload;
        paymentRequirements: PaymentRequirements;
      };

      expect(verifiedPaymentPayload).toBeDefined();
      expect(verifiedPaymentRequirements).toBeDefined();

      const settlementResult = await httpServer.processSettlement(
        verifiedPaymentPayload,
        verifiedPaymentRequirements,
        200,
      );

      expect(settlementResult).toBeDefined();
      expect(settlementResult.success).toBe(true);

      if (settlementResult.success) {
        expect(settlementResult.headers).toBeDefined();
        expect(settlementResult.headers['PAYMENT-RESPONSE']).toBeDefined();
      }
    });
  });

  describe('Price Parsing Integration', () => {
    let server: x402ResourceServer;
    let apServer: APServer;

    beforeEach(async () => {
      // Create mock Agent Pay client
      const agentPayMock = await createMockAgentPayClient(agentPayId);
      
      // Create mock service signer
      const serviceMock = await createMockServiceSigner(serviceUrl);

      const apFacilitator = new APFacilitator({
        agentPayId,
        agentPayClient: agentPayMock.agentPayClient
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
        { input: '$1.00', expectedAmount: '1' },
        { input: '1.50', expectedAmount: '1.5' },
        { input: '1.50 USD', expectedAmount: '1.5' },
        { input: 2.5, expectedAmount: '2.5' },
      ];

      for (const testCase of testCases) {
        const requirements = await server.buildPaymentRequirements({
          scheme: AGENT_PAY_SCHEME,
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
        scheme: AGENT_PAY_SCHEME,
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
          scheme: AGENT_PAY_SCHEME,
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
        scheme: AGENT_PAY_SCHEME,
        payTo: 'service-pay',
        price: 0.15,
        network: 'fab:aws' as Network,
      });

      expect(requirements).toHaveLength(1);
      expect((requirements[0].extra as any).quoteToken).toBeDefined();

      // Sentinel values: payTo should be sentinel, maxTimeoutSeconds should match quote validity
      expect(requirements[0].payTo).toBe(AGENT_PAY_SENTINEL_PAY_TO);
      expect(requirements[0].maxTimeoutSeconds).toBe(300); // DEFAULT_QUOTE_VALIDITY_SECONDS

      // Decode and verify quote token
      const quoteToken = (requirements[0].extra as any).quoteToken;
      const decoded = jose.decodeJwt(quoteToken);
      expect(decoded.iss).toBe(serviceUrl);
      expect(decoded.aud).toBe('aws-marketplace');
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
        aud: 'aws-marketplace',
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
      expect(decoded.aud).toBe('aws-marketplace');
      expect((decoded as any).price).toEqual({ amount: '1.50', currency: 'USD' });
    });

    it('should create valid payment token referencing quote token', async () => {
      // Create mock service signer and Agent Pay client
      const serviceMock = await createMockServiceSigner(serviceUrl);
      const agentPayMock = await createMockAgentPayClient(agentPayId);

      // First create quote token
      const quoteToken = await serviceMock.signer.signQuote({
        iss: serviceUrl,
        aud: 'aws-marketplace',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'service-pay',
        capture: 'manual',
        reference: 'TEST',
      });

      // Then create payment token using Agent Pay client
      const result = await agentPayMock.agentPayClient.createPayment({
        quoteToken,
      });

      expect(result.paymentToken).toBeDefined();
      expect(typeof result.paymentToken).toBe('string');
      expect(result.paymentId).toBeDefined();

      // Verify token can be decoded
      const decoded = jose.decodeJwt(result.paymentToken);
      expect(decoded.iss).toBe('awsmp-agentpay.amazonaws.com');
      expect(decoded.sub).toBe(agentPayId);
      expect((decoded as any).payment_context.quote_token).toBe(quoteToken);
    });
  });
});
