// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { x402Client } from '@x402/core/client';
import { x402Facilitator } from '@x402/core/facilitator';
import { x402ResourceServer, FacilitatorClient } from '@x402/core/server';
import type {
  Network,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  SupportedResponse,
} from '@x402/core/types';
import * as jose from 'jose';
import { FakeBuyerScheme } from '../helpers/fake-buyer-scheme';
import { AgentPayScheme as APServer } from '../../src/agent-pay/server/scheme';
import { AgentPayScheme as APFacilitator } from '../../src/agent-pay/facilitator/scheme';
import { InProcessFacilitatorClient } from '../../src/facilitator-client';
import { registerAgentPayNetworks } from '../../src/builders/register';
import { AGENT_PAY_SCHEME, AGENT_PAY_SENTINEL_PAY_TO } from '../../src/constants';
import { createMockAgentPayClient } from '../helpers/mock-agent-pay-client';
import { createMockServiceSigner } from '../helpers/mock-service-signer';
import { clearServiceJWKSCache } from '../../src/utils';

/**
 * Multi-Facilitator Integration Tests
 *
 * Tests the network-aware facilitator routing: Agent Pay handles registered
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
  const agentPayId = 'agent-pay-test-123';
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    clearServiceJWKSCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearServiceJWKSCache();
  });

  describe('Agent Pay facilitator handles registered networks', () => {
    let client: x402Client;
    let server: x402ResourceServer;

    beforeEach(async () => {
      const agentPayMock = await createMockAgentPayClient(agentPayId);
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
      const apClientScheme = new FakeBuyerScheme({
        agentPayClient: agentPayMock.agentPayClient,
      });
      client.register('fab:aws', apClientScheme);
      client.register('eip155:8453', apClientScheme);

      // Build facilitator for two networks
      const apFacilitator = new APFacilitator({
        agentPayId,
        agentPayClient: agentPayMock.agentPayClient,
      });
      const facilitator = new x402Facilitator().register(['fab:aws', 'eip155:8453'], apFacilitator);

      const facilitatorClient = new APFacilitatorClient(facilitator);
      server = new x402ResourceServer(facilitatorClient);

      // Use registerAgentPayNetworks helper
      registerAgentPayNetworks(server, ['fab:aws', 'eip155:8453'], {
        signingKeys: {
          privateKey: serviceMock.privateKey,
          publicKey: await jose.exportJWK(serviceMock.publicKey),
          alg: 'RS256',
        },
        serviceUrl,
      });

      // Override the signer to use our mock (registerAgentPayNetworks creates its own)
      // Re-register with the mock signer for test determinism
      server.register('fab:aws', new APServer({ signer: serviceMock.signer }));
      server.register('eip155:8453', new APServer({ signer: serviceMock.signer }));

      await server.initialize();
    });

    it('should complete full payment flow on fab:aws', async () => {
      const accepts = await server.buildPaymentRequirements({
        scheme: AGENT_PAY_SCHEME,
        network: 'fab:aws',
        payTo: 'service-pay',
        price: 0.15,
      });

      expect(accepts).toHaveLength(1);
      expect(accepts[0].payTo).toBe(AGENT_PAY_SENTINEL_PAY_TO);

      const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
        url: 'https://example.com/resource',
        description: 'Test resource',
        mimeType: 'application/json',
      });

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.accepted.scheme).toBe(AGENT_PAY_SCHEME);
      expect(paymentPayload.accepted.network).toBe('fab:aws');

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      expect(accepted).toBeDefined();

      const verifyResult = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResult.isValid).toBe(true);

      const settleResult = await server.settlePayment(paymentPayload, accepted!);
      expect(settleResult.success).toBe(true);
      expect(settleResult.network).toBe('fab:aws');
    });

    it('should complete full payment flow on eip155:8453 via Agent Pay', async () => {
      const accepts = await server.buildPaymentRequirements({
        scheme: AGENT_PAY_SCHEME,
        network: 'eip155:8453',
        payTo: 'merchant-pay',
        price: 0.15,
      });

      expect(accepts).toHaveLength(1);

      const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
        url: 'https://example.com/evm-resource',
        description: 'EVM resource via Agent Pay',
        mimeType: 'application/json',
      });

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.accepted.network).toBe('eip155:8453');

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      const verifyResult = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResult.isValid).toBe(true);
    });
  });

  describe('registerAgentPayNetworks helper', () => {
    it('should register Agent Pay server scheme for multiple networks', async () => {
      const serviceMock = await createMockServiceSigner(serviceUrl);
      const agentPayMock = await createMockAgentPayClient(agentPayId);

      const apFacilitator = new APFacilitator({
        agentPayId,
        agentPayClient: agentPayMock.agentPayClient,
      });
      const facilitator = new x402Facilitator().register('fab:aws', apFacilitator);
      const facilitatorClient = new APFacilitatorClient(facilitator);

      const server = new x402ResourceServer(facilitatorClient);
      registerAgentPayNetworks(server, ['fab:aws'], {
        signingKeys: {
          privateKey: serviceMock.privateKey,
          publicKey: await jose.exportJWK(serviceMock.publicKey),
          alg: 'RS256',
        },
        serviceUrl,
      });

      expect(server.hasRegisteredScheme('fab:aws', 'agent-pay')).toBe(true);
    });

    it('should throw on empty networks array', () => {
      const server = new x402ResourceServer();
      expect(() =>
        registerAgentPayNetworks(server, [], {
          signingKeys: {} as any,
          serviceUrl: 'https://api.example.com',
        })
      ).toThrow('non-empty');
    });
  });
});
