import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildAgenticPayResourceServer } from '../../../src/builders/resource-server-builder';
import type { AgenticPayResourceServerConfig } from '../../../src/builders/resource-server-builder';
import { ValidationError } from '../../../src/types';
import * as jose from 'jose';

// Mock fetch globally for Agentic Pay /.well-known/x402-supported
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('buildAgenticPayResourceServer', () => {
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

  function mockAgenticPaySupported(networks: string[]) {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/.well-known/x402-supported')) {
        return {
          ok: true,
          json: async () => ({
            kinds: networks.map(n => ({
              x402Version: 2,
              scheme: 'aws:marketplace',
              network: n,
              extra: { agenticPayId: 'test-agentic-pay' },
            })),
            extensions: [],
            signers: { 'aws:*': ['test-agentic-pay'] },
          }),
        };
      }
      // Default facilitator /supported — return some non-Agentic-Pay networks
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

  it('should build server with Agentic Pay schemes for specified networks', async () => {
    mockAgenticPaySupported(['fab:aws', 'eip155:8453']);

    const server = await buildAgenticPayResourceServer({
      networks: ['fab:aws', 'eip155:8453'],
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
      signingKeys,
      serviceUrl: 'https://api.example.com',
    });

    expect(server.hasRegisteredScheme('fab:aws', 'aws:marketplace')).toBe(true);
    expect(server.hasRegisteredScheme('eip155:8453', 'aws:marketplace')).toBe(true);
  });

  it('should include default facilitator when disableDefaultFallback is false', async () => {
    mockAgenticPaySupported(['fab:aws']);

    const server = await buildAgenticPayResourceServer({
      networks: ['fab:aws'],
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
      signingKeys,
      serviceUrl: 'https://api.example.com',
      disableDefaultFallback: false,
    });

    // Agentic Pay network should be registered
    expect(server.hasRegisteredScheme('fab:aws', 'aws:marketplace')).toBe(true);
    // Both facilitator clients were queried during initialize().
    // The Agentic Pay's x402-supported endpoint is one call, and the default
    // facilitator's /supported endpoint is another. Both go through fetch.
    const allCalls = mockFetch.mock.calls.map((c: any) => c[0] as string);
    const agenticPayCall = allCalls.find((u: string) => u.includes('pay.example.com'));
    const defaultCall = allCalls.find((u: string) => u.includes('x402.org'));
    expect(agenticPayCall).toBeDefined();
    expect(defaultCall).toBeDefined();
  });

  it('should exclude default facilitator when disableDefaultFallback is true', async () => {
    mockAgenticPaySupported(['fab:aws']);

    const server = await buildAgenticPayResourceServer({
      networks: ['fab:aws'],
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
      signingKeys,
      serviceUrl: 'https://api.example.com',
      disableDefaultFallback: true,
    });

    expect(server.hasRegisteredScheme('fab:aws', 'aws:marketplace')).toBe(true);
    // Only the Agentic Pay's x402-supported should have been called
    const supportedCalls = mockFetch.mock.calls.filter(
      (c: any) => c[0].includes('x402-supported')
    );
    expect(supportedCalls.length).toBe(1);
  });

  it('should apply network filter so Agentic Pay only claims specified networks', async () => {
    // Agentic Pay supports both fab:aws and fab:test, but we only want fab:aws
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/.well-known/x402-supported')) {
        return {
          ok: true,
          json: async () => ({
            kinds: [
              { x402Version: 2, scheme: 'aws:marketplace', network: 'fab:aws', extra: {} },
              { x402Version: 2, scheme: 'aws:marketplace', network: 'fab:test', extra: {} },
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

    const server = await buildAgenticPayResourceServer({
      networks: ['fab:aws'],
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
      signingKeys,
      serviceUrl: 'https://api.example.com',
    });

    // fab:aws should be registered (in networks)
    expect(server.hasRegisteredScheme('fab:aws', 'aws:marketplace')).toBe(true);
    // fab:test should NOT have a supported kind (filtered out by networkFilter)
    expect(server.getSupportedKind(2, 'fab:test', 'aws:marketplace')).toBeUndefined();
  });

  it('should throw on empty networks', async () => {
    await expect(
      buildAgenticPayResourceServer({
        networks: [],
        agenticPayBaseUrl: 'https://pay.example.com',
        agenticPayId: 'test-agentic-pay',
        signingKeys,
        serviceUrl: 'https://api.example.com',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should throw on invalid agenticPayBaseUrl', async () => {
    await expect(
      buildAgenticPayResourceServer({
        networks: ['fab:aws'],
        agenticPayBaseUrl: 'not-a-url',
        agenticPayId: 'test-agentic-pay',
        signingKeys,
        serviceUrl: 'https://api.example.com',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should throw on missing signingKeys', async () => {
    await expect(
      buildAgenticPayResourceServer({
        networks: ['fab:aws'],
        agenticPayBaseUrl: 'https://pay.example.com',
        agenticPayId: 'test-agentic-pay',
        signingKeys: undefined as any,
        serviceUrl: 'https://api.example.com',
      })
    ).rejects.toThrow(ValidationError);
  });
});
