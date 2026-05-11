import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createFABResourceServer } from '../../../src/builders/resource-server-builder';
import { ValidationError } from '../../../src/types';
import * as jose from 'jose';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('createFABResourceServer', () => {
  let keys: { privateKey: jose.KeyLike; publicKey: jose.JWK; alg: 'RS256' };

  beforeEach(async () => {
    vi.clearAllMocks();
    const k = await jose.generateKeyPair('RS256');
    keys = { privateKey: k.privateKey, publicKey: await jose.exportJWK(k.publicKey), alg: 'RS256' };
  });

  function mockSupported(networks: string[]) {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('/.well-known/x402-supported')) {
        return {
          ok: true,
          json: async () => ({
            kinds: networks.map(n => ({ x402Version: 2, scheme: 'fab', network: n, extra: { agenticPayId: 'w' } })),
            extensions: [], signers: {},
          }),
        };
      }
      if (url.includes('/supported')) {
        return { ok: true, json: async () => ({ kinds: [], extensions: [], signers: {} }) };
      }
      return { ok: false, statusText: 'Not Found' };
    });
  }

  const base = { agenticPayBaseUrl: 'https://pay.example.com', agenticPayId: 'w', serviceUrl: 'https://api.example.com' };

  it('should create server and register networks individually', async () => {
    mockSupported(['fab:aws', 'eip155:8453']);
    const s = createFABResourceServer({ ...base, signingKeys: keys });
    s.registerNetwork('fab:aws');
    s.registerNetwork('eip155:8453');
    const server = await s.initialize({ disableDefaultFallback: true });
    expect(server.hasRegisteredScheme('fab:aws', 'fab')).toBe(true);
    expect(server.hasRegisteredScheme('eip155:8453', 'fab')).toBe(true);
  });

  it('should support method chaining', async () => {
    mockSupported(['fab:aws', 'eip155:8453']);
    const s = createFABResourceServer({ ...base, signingKeys: keys });
    const result = s.registerNetwork('fab:aws').registerNetwork('eip155:8453');
    expect(result).toBe(s);
    const server = await s.initialize({ disableDefaultFallback: true });
    expect(server.hasRegisteredScheme('fab:aws', 'fab')).toBe(true);
  });

  it('should be idempotent for duplicate registerNetwork calls', async () => {
    mockSupported(['fab:aws']);
    const s = createFABResourceServer({ ...base, signingKeys: keys });
    s.registerNetwork('fab:aws');
    s.registerNetwork('fab:aws');
    const server = await s.initialize({ disableDefaultFallback: true });
    expect(server.hasRegisteredScheme('fab:aws', 'fab')).toBe(true);
  });

  it('should throw on initialize with no networks', async () => {
    const s = createFABResourceServer({ ...base, signingKeys: keys });
    await expect(s.initialize()).rejects.toThrow(ValidationError);
  });

  it('should throw on invalid agenticPayBaseUrl', () => {
    expect(() => createFABResourceServer({ agenticPayBaseUrl: 'bad', agenticPayId: 'w', signingKeys: keys, serviceUrl: 'https://a.com' })).toThrow(ValidationError);
  });

  it('should throw on missing serviceUrl', () => {
    expect(() => createFABResourceServer({ agenticPayBaseUrl: 'https://w.com', agenticPayId: 'w', signingKeys: keys, serviceUrl: '' })).toThrow(ValidationError);
  });
});
