import { describe, expect, it } from 'vitest';
import { createAgentPayClient } from '../../../src/builders/client-builder';
import { ValidationError } from '../../../src/types';
import { x402Client } from '@x402/core/client';

describe('createAgentPayClient', () => {
  it('should create client and register networks individually', () => {
    const c = createAgentPayClient({ agentPayBaseUrl: 'https://pay.example.com', agentPayId: 'w' });
    c.registerNetwork('fab:aws');
    c.registerNetwork('eip155:8453');
    expect(c.client).toBeInstanceOf(x402Client);
  });

  it('should support method chaining', () => {
    const c = createAgentPayClient({ agentPayBaseUrl: 'https://pay.example.com', agentPayId: 'w' });
    const result = c.registerNetwork('fab:aws').registerNetwork('eip155:8453');
    expect(result).toBe(c);
  });

  it('should be idempotent for duplicate registerNetwork calls', () => {
    const c = createAgentPayClient({ agentPayBaseUrl: 'https://pay.example.com', agentPayId: 'w' });
    c.registerNetwork('fab:aws');
    c.registerNetwork('fab:aws');
    expect(c.client).toBeInstanceOf(x402Client);
  });

  it('should expose createPaymentPayload', () => {
    const c = createAgentPayClient({ agentPayBaseUrl: 'https://pay.example.com', agentPayId: 'w' });
    expect(typeof c.createPaymentPayload).toBe('function');
  });

  it('should add networks to an existing x402Client', () => {
    const existing = new x402Client();
    const c = createAgentPayClient({ agentPayBaseUrl: 'https://pay.example.com', agentPayId: 'w', existingClient: existing });
    c.registerNetwork('fab:aws');
    expect(c.client).toBe(existing);
  });

  it('should throw on invalid agentPayBaseUrl', () => {
    expect(() => createAgentPayClient({ agentPayBaseUrl: 'bad', agentPayId: 'w' })).toThrow(ValidationError);
  });

  it('should throw on missing agentPayBaseUrl', () => {
    expect(() => createAgentPayClient({ agentPayBaseUrl: '', agentPayId: 'w' })).toThrow(ValidationError);
  });
});
