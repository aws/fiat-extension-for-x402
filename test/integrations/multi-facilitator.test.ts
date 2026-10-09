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
import { ExactAgenticCommerceScheme as APServer } from '../../src/agentic-commerce/exact/server';
import { toQuoteSigner } from '../../src/signers/protocol';
import { AgenticCommerceScheme as APFacilitator } from '../../src/agentic-commerce/facilitator/scheme';
import { InProcessFacilitatorClient } from '../../src/facilitator-client';
import { SCHEME_EXACT, SENTINEL_PAY_TO } from '../../src/constants';
import { createMockAgenticCommerceClient } from '../helpers/mock-agentic-commerce-client';
import { createMockServiceSigner } from '../helpers/mock-service-signer';
import { clearServiceJWKSCache } from '../../src/utils';

/**
 * Multi-Facilitator Integration Tests
 *
 * Tests the network-aware facilitator routing: Agentic Commerce handles registered
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
  const agenticCommerceId = 'agentic-commerce-test-123';
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    clearServiceJWKSCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearServiceJWKSCache();
  });

  describe('Agentic Commerce facilitator handles registered networks', () => {
    let client: x402Client;
    let server: x402ResourceServer;

    beforeEach(async () => {
      const agenticCommerceMock = await createMockAgenticCommerceClient(agenticCommerceId);
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
      // The fake buyer is test-only. x402 core's buyer spend controls (core >= 2.23)
      // accept only default assets with atomic amounts, which fiat prices are not.
      client = new x402Client().setSpendControls(false);
      const apClientScheme = new FakeBuyerScheme({
        agenticCommerceClient: agenticCommerceMock.agenticCommerceClient,
      });
      client.register('fab:aws', apClientScheme);
      client.register('eip155:8453', apClientScheme);

      // Build facilitator for two networks
      const apFacilitator = new APFacilitator({
        agenticCommerceId,
        agenticCommerceClient: agenticCommerceMock.agenticCommerceClient,
      });
      const facilitator = new x402Facilitator().register(['fab:aws', 'eip155:8453'], apFacilitator);

      const facilitatorClient = new APFacilitatorClient(facilitator);
      server = new x402ResourceServer(facilitatorClient);

      // Register the Agentic Commerce server scheme with the mock signer on both networks
      server.register('fab:aws', new APServer({ signer: serviceMock.signer }));
      server.register('eip155:8453', new APServer({ signer: serviceMock.signer }));

      await server.initialize();
    });

    it('should complete full payment flow on fab:aws', async () => {
      const accepts = await server.buildPaymentRequirements({
        scheme: SCHEME_EXACT,
        network: 'fab:aws',
        payTo: 'service-pay',
        price: 0.15,
      });

      expect(accepts).toHaveLength(1);
      expect(accepts[0].payTo).toBe(SENTINEL_PAY_TO);

      const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
        url: 'https://example.com/resource',
        description: 'Test resource',
        mimeType: 'application/json',
      });

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.accepted.scheme).toBe(SCHEME_EXACT);
      expect(paymentPayload.accepted.network).toBe('fab:aws');

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      expect(accepted).toBeDefined();

      const verifyResult = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResult.isValid).toBe(true);

      const settleResult = await server.settlePayment(paymentPayload, accepted!);
      expect(settleResult.success).toBe(true);
      expect(settleResult.network).toBe('fab:aws');
    });

    it('should complete full payment flow on eip155:8453 via Agentic Commerce', async () => {
      const accepts = await server.buildPaymentRequirements({
        scheme: SCHEME_EXACT,
        network: 'eip155:8453',
        payTo: 'merchant-pay',
        price: 0.15,
      });

      expect(accepts).toHaveLength(1);

      const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
        url: 'https://example.com/evm-resource',
        description: 'EVM resource via Agentic Commerce',
        mimeType: 'application/json',
      });

      const paymentPayload = await client.createPaymentPayload(paymentRequired);
      expect(paymentPayload.accepted.network).toBe('eip155:8453');

      const accepted = server.findMatchingRequirements(accepts, paymentPayload);
      const verifyResult = await server.verifyPayment(paymentPayload, accepted!);
      expect(verifyResult.isValid).toBe(true);
    });
  });

  describe('stock x402ResourceServer.register', () => {
    it('should register an Agentic Commerce server scheme built from a jose key pair', async () => {
      const serviceMock = await createMockServiceSigner(serviceUrl);
      const agenticCommerceMock = await createMockAgenticCommerceClient(agenticCommerceId);

      const apFacilitator = new APFacilitator({
        agenticCommerceId,
        agenticCommerceClient: agenticCommerceMock.agenticCommerceClient,
      });
      const facilitator = new x402Facilitator().register('fab:aws', apFacilitator);
      const facilitatorClient = new APFacilitatorClient(facilitator);

      const server = new x402ResourceServer(facilitatorClient);
      server.register(
        'fab:aws',
        new APServer({
          signer: toQuoteSigner(
            serviceMock.privateKey,
            await jose.exportJWK(serviceMock.publicKey),
            serviceUrl
          ),
        })
      );

      expect(server.hasRegisteredScheme('fab:aws', SCHEME_EXACT)).toBe(true);

      // The scheme signs quotes that verify against the service key.
      await server.initialize();
      const [accept] = await server.buildPaymentRequirements({
        scheme: SCHEME_EXACT,
        network: 'fab:aws',
        payTo: 'service-pay',
        price: 0.15,
      });
      const quoteToken = (accept.extra as { quoteToken: string }).quoteToken;
      const { payload } = await jose.jwtVerify(quoteToken, serviceMock.publicKey);
      expect(payload.iss).toBe(serviceUrl);
    });
  });
});
