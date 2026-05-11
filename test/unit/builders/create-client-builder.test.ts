import { describe, expect, it } from 'vitest';
import { createFABClient } from '../../../src/builders/client-builder';
import { ValidationError } from '../../../src/types';
import { x402Client } from '@x402/core/client';

describe('createFABClient', () => {
  it('should create client and register networks individually', () => {
    const c = createFABClient({ agenticPayBaseUrl: 'https://pay.example.com', agenticPayId: 'w' });
    c.registerNetwork('fab:aws');
    c.registerNetwork('eip155:8453');
    expect(c.client).toBeInstanceOf(x402Client);
  });

  it('should support method chaining', () => {
    const c = createFABClient({ agenticPayBaseUrl: 'https://pay.example.com', agenticPayId: 'w' });
    const result = c.registerNetwork('fab:aws').registerNetwork('eip155:8453');
    expect(result).toBe(c);
  });

  it('should be idempotent for duplicate registerNetwork calls', () => {
    const c = createFABClient({ agenticPayBaseUrl: 'https://pay.example.com', agenticPayId: 'w' });
    c.registerNetwork('fab:aws');
    c.registerNetwork('fab:aws');
    expect(c.client).toBeInstanceOf(x402Client);
  });

  it('should expose createPaymentPayload', () => {
    const c = createFABClient({ agenticPayBaseUrl: 'https://pay.example.com', agenticPayId: 'w' });
    expect(typeof c.createPaymentPayload).toBe('function');
  });

  it('should add networks to an existing x402Client', () => {
    const existing = new x402Client();
    const c = createFABClient({ agenticPayBaseUrl: 'https://pay.example.com', agenticPayId: 'w', existingClient: existing });
    c.registerNetwork('fab:aws');
    expect(c.client).toBe(existing);
  });

  it('should throw on invalid agenticPayBaseUrl', () => {
    expect(() => createFABClient({ agenticPayBaseUrl: 'bad', agenticPayId: 'w' })).toThrow(ValidationError);
  });

  it('should throw on missing agenticPayBaseUrl', () => {
    expect(() => createFABClient({ agenticPayBaseUrl: '', agenticPayId: 'w' })).toThrow(ValidationError);
  });
});
