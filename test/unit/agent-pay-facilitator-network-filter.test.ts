// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { x402ResourceServer } from '@x402/core/server';
import { AgentPayFacilitatorClient } from '../../src/agent-pay-facilitator-client';
import { AgentPayScheme as AgentPayServerScheme } from '../../src/agent-pay/server/scheme';
import { createMockServiceSigner } from '../helpers/mock-service-signer';
import type { Network } from '@x402/core/types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const AGENT_PAY_SUPPORTED_RESPONSE = {
  kinds: [
    { x402Version: 2, scheme: 'agent-pay', network: 'fab:aws', extra: { agentPayId: 'w1' } },
    { x402Version: 2, scheme: 'agent-pay', network: 'fab:test', extra: { agentPayId: 'w1' } },
    { x402Version: 2, scheme: 'agent-pay', network: 'eip155:8453', extra: { agentPayId: 'w1' } },
  ],
  extensions: [],
  signers: { 'aws:*': ['w1'] },
};

describe('AgentPayFacilitatorClient networkFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...AGENT_PAY_SUPPORTED_RESPONSE }),
    });
  });

  it('should return all networks when no filter is set', async () => {
    const client = new AgentPayFacilitatorClient('https://pay.example.com');
    const supported = await client.getSupported();

    expect(supported.kinds).toHaveLength(3);
    expect(supported.kinds.map((k) => k.network)).toEqual(['fab:aws', 'fab:test', 'eip155:8453']);
  });

  it('should filter to only specified networks', async () => {
    const filter = new Set(['fab:aws'] as Network[]);
    const client = new AgentPayFacilitatorClient('https://pay.example.com', undefined, filter);
    const supported = await client.getSupported();

    expect(supported.kinds).toHaveLength(1);
    expect(supported.kinds[0].network).toBe('fab:aws');
  });

  it('should return empty kinds when filter matches nothing', async () => {
    const filter = new Set(['solana:mainnet'] as Network[]);
    const client = new AgentPayFacilitatorClient('https://pay.example.com', undefined, filter);
    const supported = await client.getSupported();

    expect(supported.kinds).toHaveLength(0);
  });

  it('should filter to multiple specified networks', async () => {
    const filter = new Set(['fab:aws', 'eip155:8453'] as Network[]);
    const client = new AgentPayFacilitatorClient('https://pay.example.com', undefined, filter);
    const supported = await client.getSupported();

    expect(supported.kinds).toHaveLength(2);
    expect(supported.kinds.map((k) => k.network).sort()).toEqual(['eip155:8453', 'fab:aws']);
  });

  // Moved from the deleted builder tests: the filter holds once the client backs a stock x402ResourceServer.
  it('should keep filtered-out networks out of x402ResourceServer supported kinds', async () => {
    const { signer } = await createMockServiceSigner('https://api.example.com');
    const filter = new Set(['fab:aws'] as Network[]);
    const client = new AgentPayFacilitatorClient('https://pay.example.com', undefined, filter);
    const server = new x402ResourceServer(client);
    server.register('fab:aws', new AgentPayServerScheme({ signer }));

    await server.initialize();

    expect(server.hasRegisteredScheme('fab:aws', 'agent-pay')).toBe(true);
    expect(server.getSupportedKind(2, 'fab:aws', 'agent-pay')).toBeDefined();
    expect(server.getSupportedKind(2, 'fab:test', 'agent-pay')).toBeUndefined();
  });
});
