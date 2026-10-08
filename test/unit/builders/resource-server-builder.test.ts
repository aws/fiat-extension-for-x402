// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildAgentPayResourceServer } from '../../../src/builders/resource-server-builder';
import type { AgentPayResourceServerConfig } from '../../../src/builders/resource-server-builder';
import { ValidationError } from '../../../src/types';
import * as jose from 'jose';

// Mock fetch globally for Agent Pay /.well-known/x402-supported
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('buildAgentPayResourceServer', () => {
  let signingKeys: { privateKey: jose.KeyLike; publicKey: jose.JWK; alg: 'RS256' };

  beforeEach(async () => {
    vi.clearAllMocks();
    const keys = await jose.generateKeyPair('RS256');
    signingKeys = {
      privateKey: keys.privateKey,
      publicKey: await jose.exportJWK(keys.publicKey),
      alg: 'RS256',
    };
  });

  function mockAgentPaySupported(networks: string[]) {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/.well-known/x402-supported')) {
        return {
          ok: true,
          json: async () => ({
            kinds: networks.map(n => ({
              x402Version: 2,
              scheme: 'agent-pay',
              network: n,
              extra: { agentPayId: 'test-agent-pay' },
            })),
            extensions: [],
            signers: { 'aws:*': ['test-agent-pay'] },
          }),
        };
      }
      // Default facilitator /supported — return some non-Agent-Pay networks
      if (url.includes('/supported')) {
        return {
          ok: true,
          json: async () => ({
            kinds: [
              { x402Version: 2, scheme: 'exact', network: 'solana:mainnet' },
              { x402Version: 2, scheme: 'exact', network: 'eip155:8453' },
            ],
            extensions: [],
            signers: {},
          }),
        };
      }
      return { ok: false, statusText: 'Not Found' };
    });
  }

  it('should build server with Agent Pay schemes for specified networks', async () => {
    mockAgentPaySupported(['fab:aws', 'eip155:8453']);

    const server = await buildAgentPayResourceServer({
      networks: ['fab:aws', 'eip155:8453'],
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
      signingKeys,
      serviceUrl: 'https://api.example.com',
    });

    expect(server.hasRegisteredScheme('fab:aws', 'agent-pay')).toBe(true);
    expect(server.hasRegisteredScheme('eip155:8453', 'agent-pay')).toBe(true);
  });

  it('should include default facilitator when disableDefaultFallback is false', async () => {
    mockAgentPaySupported(['fab:aws']);

    const server = await buildAgentPayResourceServer({
      networks: ['fab:aws'],
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
      signingKeys,
      serviceUrl: 'https://api.example.com',
      disableDefaultFallback: false,
    });

    // Agent Pay network should be registered
    expect(server.hasRegisteredScheme('fab:aws', 'agent-pay')).toBe(true);
    // Both facilitator clients were queried during initialize().
    // The Agent Pay's x402-supported endpoint is one call, and the default
    // facilitator's /supported endpoint is another. Both go through fetch.
    const allCalls = mockFetch.mock.calls.map((c: any) => c[0] as string);
    const agentPayCall = allCalls.find((u: string) => u.includes('pay.example.com'));
    const defaultCall = allCalls.find((u: string) => u.includes('x402.org'));
    expect(agentPayCall).toBeDefined();
    expect(defaultCall).toBeDefined();
  });

  it('should exclude default facilitator when disableDefaultFallback is true', async () => {
    mockAgentPaySupported(['fab:aws']);

    const server = await buildAgentPayResourceServer({
      networks: ['fab:aws'],
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
      signingKeys,
      serviceUrl: 'https://api.example.com',
      disableDefaultFallback: true,
    });

    expect(server.hasRegisteredScheme('fab:aws', 'agent-pay')).toBe(true);
    // Only the Agent Pay's x402-supported should have been called
    const supportedCalls = mockFetch.mock.calls.filter(
      (c: any) => c[0].includes('x402-supported')
    );
    expect(supportedCalls.length).toBe(1);
  });

  it('should apply network filter so Agent Pay only claims specified networks', async () => {
    // Agent Pay supports both fab:aws and fab:test, but we only want fab:aws
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/.well-known/x402-supported')) {
        return {
          ok: true,
          json: async () => ({
            kinds: [
              { x402Version: 2, scheme: 'agent-pay', network: 'fab:aws', extra: {} },
              { x402Version: 2, scheme: 'agent-pay', network: 'fab:test', extra: {} },
            ],
            extensions: [],
            signers: {},
          }),
        };
      }
      if (url.includes('/supported')) {
        return {
          ok: true,
          json: async () => ({ kinds: [], extensions: [], signers: {} }),
        };
      }
      return { ok: false, statusText: 'Not Found' };
    });

    const server = await buildAgentPayResourceServer({
      networks: ['fab:aws'],
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
      signingKeys,
      serviceUrl: 'https://api.example.com',
    });

    // fab:aws should be registered (in networks)
    expect(server.hasRegisteredScheme('fab:aws', 'agent-pay')).toBe(true);
    // fab:test should NOT have a supported kind (filtered out by networkFilter)
    expect(server.getSupportedKind(2, 'fab:test', 'agent-pay')).toBeUndefined();
  });

  it('should throw on empty networks', async () => {
    await expect(
      buildAgentPayResourceServer({
        networks: [],
        agentPayBaseUrl: 'https://pay.example.com',
        agentPayId: 'test-agent-pay',
        signingKeys,
        serviceUrl: 'https://api.example.com',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should throw on invalid agentPayBaseUrl', async () => {
    await expect(
      buildAgentPayResourceServer({
        networks: ['fab:aws'],
        agentPayBaseUrl: 'not-a-url',
        agentPayId: 'test-agent-pay',
        signingKeys,
        serviceUrl: 'https://api.example.com',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should throw on missing signingKeys', async () => {
    await expect(
      buildAgentPayResourceServer({
        networks: ['fab:aws'],
        agentPayBaseUrl: 'https://pay.example.com',
        agentPayId: 'test-agent-pay',
        signingKeys: undefined as any,
        serviceUrl: 'https://api.example.com',
      })
    ).rejects.toThrow(ValidationError);
  });
});
