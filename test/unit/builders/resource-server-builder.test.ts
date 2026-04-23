import { describe, expect, it, vi, beforeEach } from 'vitest';
import { buildFABResourceServer } from '../../../src/builders/resource-server-builder';
import type { FABResourceServerConfig } from '../../../src/builders/resource-server-builder';
import { ValidationError } from '../../../src/types';
import * as jose from 'jose';

// Mock fetch globally for wallet /.well-known/x402-supported
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('buildFABResourceServer', () => {
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

  function mockWalletSupported(networks: string[]) {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/.well-known/x402-supported')) {
        return {
          ok: true,
          json: async () => ({
            kinds: networks.map(n => ({
              x402Version: 2,
              scheme: 'fab',
              network: n,
              extra: { walletId: 'test-wallet' },
            })),
            extensions: [],
            signers: { 'fab:*': ['test-wallet'] },
          }),
        };
      }
      // Default facilitator /supported — return some non-FAB networks
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

  it('should build server with FAB schemes for specified networks', async () => {
    mockWalletSupported(['fab:aws', 'eip155:8453']);

    const server = await buildFABResourceServer({
      fabNetworks: ['fab:aws', 'eip155:8453'],
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
      signingKeys,
      serviceUrl: 'https://api.example.com',
    });

    expect(server.hasRegisteredScheme('fab:aws', 'fab')).toBe(true);
    expect(server.hasRegisteredScheme('eip155:8453', 'fab')).toBe(true);
  });

  it('should include default facilitator when disableDefaultFallback is false', async () => {
    mockWalletSupported(['fab:aws']);

    const server = await buildFABResourceServer({
      fabNetworks: ['fab:aws'],
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
      signingKeys,
      serviceUrl: 'https://api.example.com',
      disableDefaultFallback: false,
    });

    // FAB network should be registered
    expect(server.hasRegisteredScheme('fab:aws', 'fab')).toBe(true);
    // Both facilitator clients were queried during initialize().
    // The wallet's x402-supported endpoint is one call, and the default
    // facilitator's /supported endpoint is another. Both go through fetch.
    const allCalls = mockFetch.mock.calls.map((c: any) => c[0] as string);
    const walletCall = allCalls.find((u: string) => u.includes('wallet.example.com'));
    const defaultCall = allCalls.find((u: string) => u.includes('x402.org'));
    expect(walletCall).toBeDefined();
    expect(defaultCall).toBeDefined();
  });

  it('should exclude default facilitator when disableDefaultFallback is true', async () => {
    mockWalletSupported(['fab:aws']);

    const server = await buildFABResourceServer({
      fabNetworks: ['fab:aws'],
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
      signingKeys,
      serviceUrl: 'https://api.example.com',
      disableDefaultFallback: true,
    });

    expect(server.hasRegisteredScheme('fab:aws', 'fab')).toBe(true);
    // Only the wallet's x402-supported should have been called
    const supportedCalls = mockFetch.mock.calls.filter(
      (c: any) => c[0].includes('x402-supported')
    );
    expect(supportedCalls.length).toBe(1);
  });

  it('should apply network filter so wallet only claims specified networks', async () => {
    // Wallet supports both fab:aws and fab:test, but we only want fab:aws
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/.well-known/x402-supported')) {
        return {
          ok: true,
          json: async () => ({
            kinds: [
              { x402Version: 2, scheme: 'fab', network: 'fab:aws', extra: {} },
              { x402Version: 2, scheme: 'fab', network: 'fab:test', extra: {} },
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

    const server = await buildFABResourceServer({
      fabNetworks: ['fab:aws'],
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
      signingKeys,
      serviceUrl: 'https://api.example.com',
    });

    // fab:aws should be registered (in fabNetworks)
    expect(server.hasRegisteredScheme('fab:aws', 'fab')).toBe(true);
    // fab:test should NOT have a supported kind (filtered out by networkFilter)
    expect(server.getSupportedKind(2, 'fab:test', 'fab')).toBeUndefined();
  });

  it('should throw on empty fabNetworks', async () => {
    await expect(
      buildFABResourceServer({
        fabNetworks: [],
        walletBaseUrl: 'https://wallet.example.com',
        walletId: 'test-wallet',
        signingKeys,
        serviceUrl: 'https://api.example.com',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should throw on invalid walletBaseUrl', async () => {
    await expect(
      buildFABResourceServer({
        fabNetworks: ['fab:aws'],
        walletBaseUrl: 'not-a-url',
        walletId: 'test-wallet',
        signingKeys,
        serviceUrl: 'https://api.example.com',
      })
    ).rejects.toThrow(ValidationError);
  });

  it('should throw on missing signingKeys', async () => {
    await expect(
      buildFABResourceServer({
        fabNetworks: ['fab:aws'],
        walletBaseUrl: 'https://wallet.example.com',
        walletId: 'test-wallet',
        signingKeys: undefined as any,
        serviceUrl: 'https://api.example.com',
      })
    ).rejects.toThrow(ValidationError);
  });
});
