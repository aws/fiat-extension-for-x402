import { describe, expect, it } from 'vitest';
import { createFABClient } from '../../../src/builders/client-builder';
import { ValidationError } from '../../../src/types';
import { x402Client } from '@x402/core/client';

describe('createFABClient', () => {
  it('should create client and register networks individually', () => {
    const c = createFABClient({ walletBaseUrl: 'https://wallet.example.com', walletId: 'w' });
    c.registerNetwork('fab:aws');
    c.registerNetwork('eip155:8453');
    expect(c.client).toBeInstanceOf(x402Client);
  });

  it('should support method chaining', () => {
    const c = createFABClient({ walletBaseUrl: 'https://wallet.example.com', walletId: 'w' });
    const result = c.registerNetwork('fab:aws').registerNetwork('eip155:8453');
    expect(result).toBe(c);
  });

  it('should be idempotent for duplicate registerNetwork calls', () => {
    const c = createFABClient({ walletBaseUrl: 'https://wallet.example.com', walletId: 'w' });
    c.registerNetwork('fab:aws');
    c.registerNetwork('fab:aws');
    expect(c.client).toBeInstanceOf(x402Client);
  });

  it('should expose createPaymentPayload', () => {
    const c = createFABClient({ walletBaseUrl: 'https://wallet.example.com', walletId: 'w' });
    expect(typeof c.createPaymentPayload).toBe('function');
  });

  it('should add networks to an existing x402Client', () => {
    const existing = new x402Client();
    const c = createFABClient({ walletBaseUrl: 'https://wallet.example.com', walletId: 'w', existingClient: existing });
    c.registerNetwork('fab:aws');
    expect(c.client).toBe(existing);
  });

  it('should throw on invalid walletBaseUrl', () => {
    expect(() => createFABClient({ walletBaseUrl: 'bad', walletId: 'w' })).toThrow(ValidationError);
  });

  it('should throw on missing walletBaseUrl', () => {
    expect(() => createFABClient({ walletBaseUrl: '', walletId: 'w' })).toThrow(ValidationError);
  });
});
