import { describe, expect, it, vi, beforeEach } from 'vitest';
import { WalletFacilitatorClient } from '../../../src/wallet-facilitator-client';
import type { Network } from '@x402/core/types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const WALLET_SUPPORTED_RESPONSE = {
  kinds: [
    { x402Version: 2, scheme: 'fab', network: 'fab:aws', extra: { walletId: 'w1' } },
    { x402Version: 2, scheme: 'fab', network: 'fab:test', extra: { walletId: 'w1' } },
    { x402Version: 2, scheme: 'fab', network: 'eip155:8453', extra: { walletId: 'w1' } },
  ],
  extensions: [],
  signers: { 'fab:*': ['w1'] },
};

describe('WalletFacilitatorClient networkFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...WALLET_SUPPORTED_RESPONSE }),
    });
  });

  it('should return all networks when no filter is set', async () => {
    const client = new WalletFacilitatorClient('https://wallet.example.com');
    const supported = await client.getSupported();

    expect(supported.kinds).toHaveLength(3);
    expect(supported.kinds.map(k => k.network)).toEqual([
      'fab:aws',
      'fab:test',
      'eip155:8453',
    ]);
  });

  it('should filter to only specified networks', async () => {
    const filter = new Set(['fab:aws'] as Network[]);
    const client = new WalletFacilitatorClient(
      'https://wallet.example.com',
      undefined,
      filter
    );
    const supported = await client.getSupported();

    expect(supported.kinds).toHaveLength(1);
    expect(supported.kinds[0].network).toBe('fab:aws');
  });

  it('should return empty kinds when filter matches nothing', async () => {
    const filter = new Set(['solana:mainnet'] as Network[]);
    const client = new WalletFacilitatorClient(
      'https://wallet.example.com',
      undefined,
      filter
    );
    const supported = await client.getSupported();

    expect(supported.kinds).toHaveLength(0);
  });

  it('should filter to multiple specified networks', async () => {
    const filter = new Set(['fab:aws', 'eip155:8453'] as Network[]);
    const client = new WalletFacilitatorClient(
      'https://wallet.example.com',
      undefined,
      filter
    );
    const supported = await client.getSupported();

    expect(supported.kinds).toHaveLength(2);
    expect(supported.kinds.map(k => k.network).sort()).toEqual([
      'eip155:8453',
      'fab:aws',
    ]);
  });
});
