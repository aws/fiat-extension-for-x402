import { describe, expect, it } from 'vitest';
import { buildFABClient, createFABClient } from '../../../src/builders/client-builder';
import { ValidationError } from '../../../src/types';
import { x402Client } from '@x402/core/client';

describe('buildFABClient (legacy convenience builder)', () => {
  it('should register FAB client scheme for all specified networks', () => {
    const client = buildFABClient({
      fabNetworks: ['fab:aws', 'eip155:8453'],
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    });
    expect(client).toBeInstanceOf(x402Client);
  });

  it('should add FAB networks to an existing client', () => {
    const existing = new x402Client();
    const client = buildFABClient({
      fabNetworks: ['fab:aws'],
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
      existingClient: existing,
    });
    expect(client).toBe(existing);
  });

  it('should throw on empty fabNetworks', () => {
    expect(() => buildFABClient({
      fabNetworks: [],
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    })).toThrow(ValidationError);
  });

  it('should throw on invalid agenticPayBaseUrl', () => {
    expect(() => buildFABClient({
      fabNetworks: ['fab:aws'],
      agenticPayBaseUrl: 'not-a-url',
      agenticPayId: 'test-agentic-pay',
    })).toThrow(ValidationError);
  });

  it('should throw on missing agenticPayBaseUrl', () => {
    expect(() => buildFABClient({
      fabNetworks: ['fab:aws'],
      agenticPayBaseUrl: '',
      agenticPayId: 'test-agentic-pay',
    })).toThrow(ValidationError);
  });
});

describe('createFABClient (two-phase API)', () => {
  it('should create client and register networks individually', () => {
    const fabClient = createFABClient({
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    });
    fabClient.registerNetwork('fab:aws');
    fabClient.registerNetwork('eip155:8453');
    expect(fabClient.client).toBeInstanceOf(x402Client);
  });

  it('should support method chaining on registerNetwork', () => {
    const fabClient = createFABClient({
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    });
    const result = fabClient
      .registerNetwork('fab:aws')
      .registerNetwork('eip155:8453');
    expect(result).toBe(fabClient);
  });

  it('should be idempotent — registering same network twice is fine', () => {
    const fabClient = createFABClient({
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    });
    fabClient.registerNetwork('fab:aws');
    fabClient.registerNetwork('fab:aws');
    expect(fabClient.client).toBeInstanceOf(x402Client);
  });

  it('should expose createPaymentPayload from the underlying client', () => {
    const fabClient = createFABClient({
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    });
    expect(typeof fabClient.createPaymentPayload).toBe('function');
  });

  it('should add networks to an existing x402Client', () => {
    const existing = new x402Client();
    const fabClient = createFABClient({
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
      existingClient: existing,
    });
    fabClient.registerNetwork('fab:aws');
    expect(fabClient.client).toBe(existing);
  });

  it('should throw on invalid agenticPayBaseUrl', () => {
    expect(() => createFABClient({
      agenticPayBaseUrl: 'not-a-url',
      agenticPayId: 'test-agentic-pay',
    })).toThrow(ValidationError);
  });

  it('should throw on missing agenticPayBaseUrl', () => {
    expect(() => createFABClient({
      agenticPayBaseUrl: '',
      agenticPayId: 'test-agentic-pay',
    })).toThrow(ValidationError);
  });
});
