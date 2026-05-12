import { describe, expect, it } from 'vitest';
import { buildAgenticPayClient, createAgenticPayClient } from '../../../src/builders/client-builder';
import { ValidationError } from '../../../src/types';
import { x402Client } from '@x402/core/client';

describe('buildAgenticPayClient (legacy convenience builder)', () => {
  it('should register Agentic Pay client scheme for all specified networks', () => {
    const client = buildAgenticPayClient({
      networks: ['fab:aws', 'eip155:8453'],
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    });
    expect(client).toBeInstanceOf(x402Client);
  });

  it('should add Agentic Pay networks to an existing client', () => {
    const existing = new x402Client();
    const client = buildAgenticPayClient({
      networks: ['fab:aws'],
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
      existingClient: existing,
    });
    expect(client).toBe(existing);
  });

  it('should throw on empty networks', () => {
    expect(() => buildAgenticPayClient({
      networks: [],
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    })).toThrow(ValidationError);
  });

  it('should throw on invalid agenticPayBaseUrl', () => {
    expect(() => buildAgenticPayClient({
      networks: ['fab:aws'],
      agenticPayBaseUrl: 'not-a-url',
      agenticPayId: 'test-agentic-pay',
    })).toThrow(ValidationError);
  });

  it('should throw on missing agenticPayBaseUrl', () => {
    expect(() => buildAgenticPayClient({
      networks: ['fab:aws'],
      agenticPayBaseUrl: '',
      agenticPayId: 'test-agentic-pay',
    })).toThrow(ValidationError);
  });
});

describe('createAgenticPayClient (two-phase API)', () => {
  it('should create client and register networks individually', () => {
    const apClient = createAgenticPayClient({
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    });
    apClient.registerNetwork('fab:aws');
    apClient.registerNetwork('eip155:8453');
    expect(apClient.client).toBeInstanceOf(x402Client);
  });

  it('should support method chaining on registerNetwork', () => {
    const apClient = createAgenticPayClient({
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    });
    const result = apClient
      .registerNetwork('fab:aws')
      .registerNetwork('eip155:8453');
    expect(result).toBe(apClient);
  });

  it('should be idempotent — registering same network twice is fine', () => {
    const apClient = createAgenticPayClient({
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    });
    apClient.registerNetwork('fab:aws');
    apClient.registerNetwork('fab:aws');
    expect(apClient.client).toBeInstanceOf(x402Client);
  });

  it('should expose createPaymentPayload from the underlying client', () => {
    const apClient = createAgenticPayClient({
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
    });
    expect(typeof apClient.createPaymentPayload).toBe('function');
  });

  it('should add networks to an existing x402Client', () => {
    const existing = new x402Client();
    const apClient = createAgenticPayClient({
      agenticPayBaseUrl: 'https://pay.example.com',
      agenticPayId: 'test-agentic-pay',
      existingClient: existing,
    });
    apClient.registerNetwork('fab:aws');
    expect(apClient.client).toBe(existing);
  });

  it('should throw on invalid agenticPayBaseUrl', () => {
    expect(() => createAgenticPayClient({
      agenticPayBaseUrl: 'not-a-url',
      agenticPayId: 'test-agentic-pay',
    })).toThrow(ValidationError);
  });

  it('should throw on missing agenticPayBaseUrl', () => {
    expect(() => createAgenticPayClient({
      agenticPayBaseUrl: '',
      agenticPayId: 'test-agentic-pay',
    })).toThrow(ValidationError);
  });
});
