import { describe, expect, it, vi, beforeEach } from 'vitest';
import { AgenticPayFacilitatorClient } from '../../../src/agentic-pay-facilitator-client';
import type { Network } from '@x402/core/types';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const AGENTIC_PAY_SUPPORTED_RESPONSE = {
  kinds: [
    { x402Version: 2, scheme: 'aws:marketplace', network: 'fab:aws', extra: { agenticPayId: 'w1' } },
    { x402Version: 2, scheme: 'aws:marketplace', network: 'fab:test', extra: { agenticPayId: 'w1' } },
    { x402Version: 2, scheme: 'aws:marketplace', network: 'eip155:8453', extra: { agenticPayId: 'w1' } },
  ],
  extensions: [],
  signers: { 'aws:*': ['w1'] },
};

describe('AgenticPayFacilitatorClient networkFilter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...AGENTIC_PAY_SUPPORTED_RESPONSE }),
    });
  });

  it('should return all networks when no filter is set', async () => {
    const client = new AgenticPayFacilitatorClient('https://pay.example.com');
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
    const client = new AgenticPayFacilitatorClient(
      'https://pay.example.com',
      undefined,
      filter
    );
    const supported = await client.getSupported();

    expect(supported.kinds).toHaveLength(1);
    expect(supported.kinds[0].network).toBe('fab:aws');
  });

  it('should return empty kinds when filter matches nothing', async () => {
    const filter = new Set(['solana:mainnet'] as Network[]);
    const client = new AgenticPayFacilitatorClient(
      'https://pay.example.com',
      undefined,
      filter
    );
    const supported = await client.getSupported();

    expect(supported.kinds).toHaveLength(0);
  });

  it('should filter to multiple specified networks', async () => {
    const filter = new Set(['fab:aws', 'eip155:8453'] as Network[]);
    const client = new AgenticPayFacilitatorClient(
      'https://pay.example.com',
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
