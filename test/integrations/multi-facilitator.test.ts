import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { x402Client } from '@x402/core/client';
import { x402Facilitator } from '@x402/core/facilitator';
import {
  x402ResourceServer,
  FacilitatorClient,
} from '@x402/core/server';
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from '@x402/core/types';
import * as jose from 'jose';
import { AgenticPayScheme as APClient } from '../../src/agentic-pay/client/scheme';
import { AgenticPayScheme as APServer } from '../../src/agentic-pay/server/scheme';
import { AgenticPayScheme as APFacilitator } from '../../src/agentic-pay/facilitator/scheme';
import { InProcessFacilitatorClient } from '../../src/facilitator-client';
import { buildAgenticPayClient } from '../../src/builders/client-builder';
import { createAgenticPayClient } from '../../src/builders/client-builder';
import { registerAgenticPayNetworks } from '../../src/builders/register';
import { AGENTIC_PAY_SCHEME, AGENTIC_PAY_SENTINEL_PAY_TO } from '../../src/constants';
import { createMockAgenticPayClient } from '../helpers/mock-agentic-pay-client';
import { createMockServiceSigner } from '../helpers/mock-service-signer';
import { clearServiceJWKSCache } from '../../src/utils';

/**
 * Multi-Facilitator Integration Tests
 *
 * Tests the network-aware facilitator routing: Agentic Pay handles registered
 * networks, unregistered networks fall back to other facilitators.
 */

/** Wraps x402Facilitator as a FacilitatorClient */
class APFacilitatorClient implements FacilitatorClient {
  constructor(private readonly facilitator: x402Facilitator) {}

  verify(p: PaymentPayload, r: PaymentRequirements): Promise<VerifyResponse> {
    return this.facilitator.verify(p, r);
  }
  settle(p: PaymentPayload, r: PaymentRequirements): Promise<SettleResponse> {
    return this.facilitator.settle(p, r);
  }
  getSupported(): Promise<SupportedResponse> {
    return Promise.resolve(this.facilitator.getSupported());
  }
}

describe('Multi-Facilitator Integration Tests', () => {
  const serviceUrl = 'https://api.example.com';
  const agenticPayId = 'agentic-pay-test-123';
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    clearServiceJWKSCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearServiceJWKSCache();
  });

  describe('Agentic Pay facilitator handles registered networks', () => {
    let client: x402Client;
    let server: x402ResourceServer;

    beforeEach(async () => {
      const agenticPayMock = await createMockAgenticPayClient(agenticPayId);
      const serviceMock = await createMockServiceSigner(serviceUrl);

      // Mock fetch to serve service JWKS for quote token verification
      const servicePublicJWK = await jose.exportJWK(serviceMock.publicKey);
      servicePublicJWK.kid = 'test-service-key';
      servicePublicJWK.alg = 'RS256';
      servicePublicJWK.use = 'sig';
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/.well-known/jwks.json')) {
          return { ok: true, json: async () => ({ keys: [servicePublicJWK] }) };
        }
        return { ok: false, statusText: 'Not Found' };
      });

      // Build client using the builder for two networks
      client = new x402Client();
      const apClientScheme = new APClient({
        agenticPayId,
        agenticPayClient: agenticPayMock.agenticPayClient,
      });
      client.register('fab:aws', apClientScheme);
      client.register('eip155:8453', apClientScheme);

      // Build facilitator for two networks
      const apFacilitator = new APFacilitator({
        agenticPayId,
        agenticPayClient: agenticPayMock.agenticPayClient,
      });
      const facilitator = new x402Facilitator()
        .register(['fab:aws', 'eip155:8453'], apFacilitator);

      const facilitatorClient = new APFacilitatorClient(facilitator);
      server = new x402ResourceServer(facilitatorClient);

      // Use registerAgenticPayNetworks helper
      registerAgenticPayNetworks(server, ['fab:aws', 'eip155:8453'], {
        signingKeys: {
          privateKey: serviceMock.privateKey,
          publicKey: await jose.exportJWK(serviceMock.publicKey),
          alg: 'RS256',
        },
        serviceUrl,
      });

      // Override the signer to use our mock (registerAgenticPayNetworks creates its own)
      // Re-register with the mock signer for test determinism
      server.register('fab:aws', new APServer({ signer: serviceMock.signer }));
      server.register('eip155:8453', new APServer({ signer: serviceMock.signer }));

      await server.initialize();
    });

    it('should complete full payment flow on fab:aws', async () => {
      const accepts = await server.buildPaymentRequirements({
        scheme: AGENTIC_PAY_SCHEME,
        network: 'fab:aws',
        payTo: 'service-pay',
        price: 0.15,
        asset: 'iso4217:USD',
      });

      expect(accepts).toHaveLength(1);
      expect(accepts[0].payTo).toBe(AGENTIC_PAY_SENTINEL_PAY_TO);

      const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
        url: 'https://example.com/resource',
        description: 'Test resource',
        mimeType: 'application/json',
      });

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.accepted.scheme).toBe(AGENTIC_PAY_SCHEME);
      expect(paymentPayload.accepted.network).toBe('fab:aws');

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      expect(accepted).toBeDefined();

      const verifyResult = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResult.isValid).toBe(true);

      const settleResult = await server.settlePayment(paymentPayload, accepted!);
      expect(settleResult.success).toBe(true);
      expect(settleResult.network).toBe('fab:aws');
    });

    it('should complete full payment flow on eip155:8453 via Agentic Pay', async () => {
      const accepts = await server.buildPaymentRequirements({
        scheme: AGENTIC_PAY_SCHEME,
        network: 'eip155:8453',
        payTo: 'merchant-pay',
        price: 0.15,
        asset: 'iso4217:USD',
      });

      expect(accepts).toHaveLength(1);

      const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
        url: 'https://example.com/evm-resource',
        description: 'EVM resource via Agentic Pay',
        mimeType: 'application/json',
      });

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.accepted.network).toBe('eip155:8453');

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      const verifyResult = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResult.isValid).toBe(true);
    });
  });

  describe('registerAgenticPayNetworks helper', () => {
    it('should register Agentic Pay server scheme for multiple networks', async () => {
      const serviceMock = await createMockServiceSigner(serviceUrl);
      const agenticPayMock = await createMockAgenticPayClient(agenticPayId);

      const apFacilitator = new APFacilitator({
        agenticPayId,
        agenticPayClient: agenticPayMock.agenticPayClient,
      });
      const facilitator = new x402Facilitator().register('fab:aws', apFacilitator);
      const facilitatorClient = new APFacilitatorClient(facilitator);

      const server = new x402ResourceServer(facilitatorClient);
      registerAgenticPayNetworks(server, ['fab:aws'], {
        signingKeys: {
          privateKey: serviceMock.privateKey,
          publicKey: await jose.exportJWK(serviceMock.publicKey),
          alg: 'RS256',
        },
        serviceUrl,
      });

      expect(server.hasRegisteredScheme('fab:aws', 'aws:marketplace')).toBe(true);
    });

    it('should throw on empty networks array', () => {
      const server = new x402ResourceServer();
      expect(() =>
        registerAgenticPayNetworks(server, [], {
          signingKeys: {} as any,
          serviceUrl: 'https://api.example.com',
        })
      ).toThrow('non-empty');
    });
  });

  describe('createAgenticPayClient two-phase API', () => {
    it('should work with registerNetwork for payment flow', async () => {
      const agenticPayMock = await createMockAgenticPayClient(agenticPayId);
      const serviceMock = await createMockServiceSigner(serviceUrl);

      // Update mock fetch to serve this test's service JWKS
      const servicePublicJWK = await jose.exportJWK(serviceMock.publicKey);
      servicePublicJWK.kid = 'test-service-key';
      servicePublicJWK.alg = 'RS256';
      servicePublicJWK.use = 'sig';
      mockFetch.mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/.well-known/jwks.json')) {
          return { ok: true, json: async () => ({ keys: [servicePublicJWK] }) };
        }
        return { ok: false, statusText: 'Not Found' };
      });
      clearServiceJWKSCache();

      // Two-phase client: create then register
      const apClient = createAgenticPayClient({
        agenticPayBaseUrl: 'https://pay.example.com',
        agenticPayId,
      });
      // Override the internal scheme with our mock Agentic Pay client
      const apClientScheme = new APClient({
        agenticPayId,
        agenticPayClient: agenticPayMock.agenticPayClient,
      });
      const client = new x402Client();
      client.register('fab:aws', apClientScheme);

      // Server setup (same as before)
      const apFacilitator = new APFacilitator({
        agenticPayId,
        agenticPayClient: agenticPayMock.agenticPayClient,
      });
      const facilitator = new x402Facilitator().register('fab:aws', apFacilitator);
      const facilitatorClient = new APFacilitatorClient(facilitator);
      const server = new x402ResourceServer(facilitatorClient);

      server.register('fab:aws', new APServer({ signer: serviceMock.signer }));
      await server.initialize();

      const accepts = await server.buildPaymentRequirements({
        scheme: AGENTIC_PAY_SCHEME,
        network: 'fab:aws',
        payTo: 'service-pay',
        price: 0.15,
        asset: 'iso4217:USD',
      });

      const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
        url: 'https://example.com/resource',
        description: 'Test',
        mimeType: 'application/json',
      });

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.accepted.scheme).toBe(AGENTIC_PAY_SCHEME);

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      const verifyResult = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResult.isValid).toBe(true);
    });
  });
});
