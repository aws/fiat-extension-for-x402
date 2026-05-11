import { beforeEach, describe, expect, it } from 'vitest';
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
import { FABScheme as FABClient } from '../../src/fab/client/scheme';
import { FABScheme as FABServer } from '../../src/fab/server/scheme';
import { FABScheme as FABFacilitator } from '../../src/fab/facilitator/scheme';
import { InProcessFacilitatorClient } from '../../src/facilitator-client';
import { buildFABClient } from '../../src/builders/client-builder';
import { createFABClient } from '../../src/builders/client-builder';
import { registerFABNetworks } from '../../src/builders/register';
import { FAB_SCHEME, FAB_SENTINEL_PAY_TO } from '../../src/constants';
import { createMockAgenticPayClient } from '../helpers/mock-agentic-pay-client';
import { createMockServiceSigner } from '../helpers/mock-service-signer';

/**
 * Multi-Facilitator Integration Tests
 *
 * Tests the network-aware facilitator routing: FAB handles registered
 * networks, unregistered networks fall back to other facilitators.
 */

/** Wraps x402Facilitator as a FacilitatorClient */
class FABFacilitatorClient implements FacilitatorClient {
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

  describe('FAB facilitator handles registered networks', () => {
    let client: x402Client;
    let server: x402ResourceServer;

    beforeEach(async () => {
      const agenticPayMock = await createMockAgenticPayClient(agenticPayId);
      const serviceMock = await createMockServiceSigner(serviceUrl);

      // Build client using the builder for two networks
      client = new x402Client();
      const fabClientScheme = new FABClient({
        agenticPayId,
        agenticPayClient: agenticPayMock.agenticPayClient,
      });
      client.register('fab:aws', fabClientScheme);
      client.register('eip155:8453', fabClientScheme);

      // Build facilitator for two networks
      const fabFacilitator = new FABFacilitator({
        agenticPayId,
        agenticPayClient: agenticPayMock.agenticPayClient,
      });
      const facilitator = new x402Facilitator()
        .register(['fab:aws', 'eip155:8453'], fabFacilitator);

      const facilitatorClient = new FABFacilitatorClient(facilitator);
      server = new x402ResourceServer(facilitatorClient);

      // Use registerFABNetworks helper
      registerFABNetworks(server, ['fab:aws', 'eip155:8453'], {
        signingKeys: {
          privateKey: serviceMock.privateKey,
          publicKey: await jose.exportJWK(serviceMock.publicKey),
          alg: 'RS256',
        },
        serviceUrl,
      });

      // Override the signer to use our mock (registerFABNetworks creates its own)
      // Re-register with the mock signer for test determinism
      server.register('fab:aws', new FABServer({ signer: serviceMock.signer }));
      server.register('eip155:8453', new FABServer({ signer: serviceMock.signer }));

      await server.initialize();
    });

    it('should complete full payment flow on fab:aws', async () => {
      const accepts = await server.buildPaymentRequirements({
        scheme: FAB_SCHEME,
        network: 'fab:aws',
        payTo: 'service-pay',
        price: 0.15,
        asset: 'iso4217:USD',
      });

      expect(accepts).toHaveLength(1);
      expect(accepts[0].payTo).toBe(FAB_SENTINEL_PAY_TO);

      const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
        url: 'https://example.com/resource',
        description: 'Test resource',
        mimeType: 'application/json',
      });

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.accepted.scheme).toBe(FAB_SCHEME);
      expect(paymentPayload.accepted.network).toBe('fab:aws');

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      expect(accepted).toBeDefined();

      const verifyResult = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResult.isValid).toBe(true);

      const settleResult = await server.settlePayment(paymentPayload, accepted!);
      expect(settleResult.success).toBe(true);
      expect(settleResult.network).toBe('fab:aws');
    });

    it('should complete full payment flow on eip155:8453 via FAB', async () => {
      const accepts = await server.buildPaymentRequirements({
        scheme: FAB_SCHEME,
        network: 'eip155:8453',
        payTo: 'merchant-pay',
        price: 0.15,
        asset: 'iso4217:USD',
      });

      expect(accepts).toHaveLength(1);

      const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
        url: 'https://example.com/evm-resource',
        description: 'EVM resource via FAB',
        mimeType: 'application/json',
      });

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.accepted.network).toBe('eip155:8453');

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      const verifyResult = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResult.isValid).toBe(true);
    });
  });

  describe('registerFABNetworks helper', () => {
    it('should register FAB server scheme for multiple networks', async () => {
      const serviceMock = await createMockServiceSigner(serviceUrl);
      const agenticPayMock = await createMockAgenticPayClient(agenticPayId);

      const fabFacilitator = new FABFacilitator({
        agenticPayId,
        agenticPayClient: agenticPayMock.agenticPayClient,
      });
      const facilitator = new x402Facilitator().register('fab:aws', fabFacilitator);
      const facilitatorClient = new FABFacilitatorClient(facilitator);

      const server = new x402ResourceServer(facilitatorClient);
      registerFABNetworks(server, ['fab:aws'], {
        signingKeys: {
          privateKey: serviceMock.privateKey,
          publicKey: await jose.exportJWK(serviceMock.publicKey),
          alg: 'RS256',
        },
        serviceUrl,
      });

      expect(server.hasRegisteredScheme('fab:aws', 'fab')).toBe(true);
    });

    it('should throw on empty networks array', () => {
      const server = new x402ResourceServer();
      expect(() =>
        registerFABNetworks(server, [], {
          signingKeys: {} as any,
          serviceUrl: 'https://api.example.com',
        })
      ).toThrow('non-empty');
    });
  });

  describe('createFABClient two-phase API', () => {
    it('should work with registerNetwork for payment flow', async () => {
      const agenticPayMock = await createMockAgenticPayClient(agenticPayId);
      const serviceMock = await createMockServiceSigner(serviceUrl);

      // Two-phase client: create then register
      const fabClient = createFABClient({
        agenticPayBaseUrl: 'https://pay.example.com',
        agenticPayId,
      });
      // Override the internal scheme with our mock Agentic Pay client
      const fabClientScheme = new FABClient({
        agenticPayId,
        agenticPayClient: agenticPayMock.agenticPayClient,
      });
      const client = new x402Client();
      client.register('fab:aws', fabClientScheme);

      // Server setup (same as before)
      const fabFacilitator = new FABFacilitator({
        agenticPayId,
        agenticPayClient: agenticPayMock.agenticPayClient,
      });
      const facilitator = new x402Facilitator().register('fab:aws', fabFacilitator);
      const facilitatorClient = new FABFacilitatorClient(facilitator);
      const server = new x402ResourceServer(facilitatorClient);

      server.register('fab:aws', new FABServer({ signer: serviceMock.signer }));
      await server.initialize();

      const accepts = await server.buildPaymentRequirements({
        scheme: FAB_SCHEME,
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
      expect(paymentPayload.accepted.scheme).toBe(FAB_SCHEME);

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      const verifyResult = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResult.isValid).toBe(true);
    });
  });
});
