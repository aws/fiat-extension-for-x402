import { describe, expect, it } from 'vitest';
import { buildFABClient, createFABClient } from '../../../src/builders/client-builder';
import { ValidationError } from '../../../src/types';
import { x402Client } from '@x402/core/client';

describe('buildFABClient (legacy convenience builder)', () => {
  it('should register FAB client scheme for all specified networks', () => {
    const client = buildFABClient({
      fabNetworks: ['fab:aws', 'eip155:8453'],
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
    });
    expect(client).toBeInstanceOf(x402Client);
  });

  it('should add FAB networks to an existing client', () => {
    const existing = new x402Client();
    const client = buildFABClient({
      fabNetworks: ['fab:aws'],
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
      existingClient: existing,
    });
    expect(client).toBe(existing);
  });

  it('should throw on empty fabNetworks', () => {
    expect(() => buildFABClient({
      fabNetworks: [],
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
    })).toThrow(ValidationError);
  });

  it('should throw on invalid walletBaseUrl', () => {
    expect(() => buildFABClient({
      fabNetworks: ['fab:aws'],
      walletBaseUrl: 'not-a-url',
      walletId: 'test-wallet',
    })).toThrow(ValidationError);
  });

  it('should throw on missing walletBaseUrl', () => {
    expect(() => buildFABClient({
      fabNetworks: ['fab:aws'],
      walletBaseUrl: '',
      walletId: 'test-wallet',
    })).toThrow(ValidationError);
  });
});

describe('createFABClient (two-phase API)', () => {
  it('should create client and register networks individually', () => {
    const fabClient = createFABClient({
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
    });
    fabClient.registerNetwork('fab:aws');
    fabClient.registerNetwork('eip155:8453');
    expect(fabClient.client).toBeInstanceOf(x402Client);
  });

  it('should support method chaining on registerNetwork', () => {
    const fabClient = createFABClient({
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
    });
    const result = fabClient
      .registerNetwork('fab:aws')
      .registerNetwork('eip155:8453');
    expect(result).toBe(fabClient);
  });

  it('should be idempotent — registering same network twice is fine', () => {
    const fabClient = createFABClient({
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
    });
    fabClient.registerNetwork('fab:aws');
    fabClient.registerNetwork('fab:aws');
    expect(fabClient.client).toBeInstanceOf(x402Client);
  });

  it('should expose createPaymentPayload from the underlying client', () => {
    const fabClient = createFABClient({
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
    });
    expect(typeof fabClient.createPaymentPayload).toBe('function');
  });

  it('should add networks to an existing x402Client', () => {
    const existing = new x402Client();
    const fabClient = createFABClient({
      walletBaseUrl: 'https://wallet.example.com',
      walletId: 'test-wallet',
      existingClient: existing,
    });
    fabClient.registerNetwork('fab:aws');
    expect(fabClient.client).toBe(existing);
  });

  it('should throw on invalid walletBaseUrl', () => {
    expect(() => createFABClient({
      walletBaseUrl: 'not-a-url',
      walletId: 'test-wallet',
    })).toThrow(ValidationError);
  });

  it('should throw on missing walletBaseUrl', () => {
    expect(() => createFABClient({
      walletBaseUrl: '',
      walletId: 'test-wallet',
    })).toThrow(ValidationError);
  });
});
