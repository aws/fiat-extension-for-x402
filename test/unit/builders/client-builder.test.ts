import { describe, expect, it } from 'vitest';
import { buildAgentPayClient, createAgentPayClient } from '../../../src/builders/client-builder';
import { ValidationError } from '../../../src/types';
import { x402Client } from '@x402/core/client';

describe('buildAgentPayClient (legacy convenience builder)', () => {
  it('should register Agent Pay client scheme for all specified networks', () => {
    const client = buildAgentPayClient({
      networks: ['fab:aws', 'eip155:8453'],
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
    });
    expect(client).toBeInstanceOf(x402Client);
  });

  it('should add Agent Pay networks to an existing client', () => {
    const existing = new x402Client();
    const client = buildAgentPayClient({
      networks: ['fab:aws'],
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
      existingClient: existing,
    });
    expect(client).toBe(existing);
  });

  it('should throw on empty networks', () => {
    expect(() => buildAgentPayClient({
      networks: [],
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
    })).toThrow(ValidationError);
  });

  it('should throw on invalid agentPayBaseUrl', () => {
    expect(() => buildAgentPayClient({
      networks: ['fab:aws'],
      agentPayBaseUrl: 'not-a-url',
      agentPayId: 'test-agent-pay',
    })).toThrow(ValidationError);
  });

  it('should throw on missing agentPayBaseUrl', () => {
    expect(buildAgentPayClient({
      networks: ['fab:aws'],
      agentPayBaseUrl: '',
      agentPayId: 'test-agent-pay',
    })).toBeDefined();
  });
});

describe('createAgentPayClient (two-phase API)', () => {
  it('should create client and register networks individually', () => {
    const apClient = createAgentPayClient({
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
    });
    apClient.registerNetwork('fab:aws');
    apClient.registerNetwork('eip155:8453');
    expect(apClient.client).toBeInstanceOf(x402Client);
  });

  it('should support method chaining on registerNetwork', () => {
    const apClient = createAgentPayClient({
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
    });
    const result = apClient
      .registerNetwork('fab:aws')
      .registerNetwork('eip155:8453');
    expect(result).toBe(apClient);
  });

  it('should be idempotent — registering same network twice is fine', () => {
    const apClient = createAgentPayClient({
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
    });
    apClient.registerNetwork('fab:aws');
    apClient.registerNetwork('fab:aws');
    expect(apClient.client).toBeInstanceOf(x402Client);
  });

  it('should expose createPaymentPayload from the underlying client', () => {
    const apClient = createAgentPayClient({
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
    });
    expect(typeof apClient.createPaymentPayload).toBe('function');
  });

  it('should add networks to an existing x402Client', () => {
    const existing = new x402Client();
    const apClient = createAgentPayClient({
      agentPayBaseUrl: 'https://pay.example.com',
      agentPayId: 'test-agent-pay',
      existingClient: existing,
    });
    apClient.registerNetwork('fab:aws');
    expect(apClient.client).toBe(existing);
  });

  it('should throw on invalid agentPayBaseUrl', () => {
    expect(() => createAgentPayClient({
      agentPayBaseUrl: 'not-a-url',
      agentPayId: 'test-agent-pay',
    })).toThrow(ValidationError);
  });

  it('should use default agentPayBaseUrl when empty', () => {
    expect(createAgentPayClient({
      agentPayBaseUrl: '',
      agentPayId: 'test-agent-pay',
    })).toBeDefined();
  });
});
