/**
 * Tests for API Key authenticator
 */

import { describe, it, expect } from 'vitest';
import { ApiKeyAuthenticator } from '../../../src/auth/api-key';
import type { AuthenticatedRequest } from '../../../src/auth/types';

describe('ApiKeyAuthenticator', () => {
  it('should add API key to default header', async () => {
    const authenticator = new ApiKeyAuthenticator({
      type: 'apiKey',
      apiKey: 'test-key-123',
    });

    const request: AuthenticatedRequest = {
      url: 'https://pay.example.com/transactions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: '{"test": true}',
    };

    const result = await authenticator.authenticate(request);

    expect(result.headers['X-API-Key']).toBe('test-key-123');
    expect(result.headers['Content-Type']).toBe('application/json');
  });

  it('should add API key to custom header', async () => {
    const authenticator = new ApiKeyAuthenticator({
      type: 'apiKey',
      apiKey: 'test-key-456',
      headerName: 'Authorization',
    });

    const request: AuthenticatedRequest = {
      url: 'https://pay.example.com/transactions',
      method: 'POST',
      headers: {},
    };

    const result = await authenticator.authenticate(request);

    expect(result.headers['Authorization']).toBe('test-key-456');
  });

  it('should add API key with prefix', async () => {
    const authenticator = new ApiKeyAuthenticator({
      type: 'apiKey',
      apiKey: 'test-key-789',
      headerName: 'Authorization',
      prefix: 'Bearer ',
    });

    const request: AuthenticatedRequest = {
      url: 'https://pay.example.com/transactions',
      method: 'POST',
      headers: {},
    };

    const result = await authenticator.authenticate(request);

    expect(result.headers['Authorization']).toBe('Bearer test-key-789');
  });

  it('should throw error for empty API key', () => {
    expect(() => {
      new ApiKeyAuthenticator({
        type: 'apiKey',
        apiKey: '',
      });
    }).toThrow('API key cannot be empty');
  });

  it('should not modify original request', async () => {
    const authenticator = new ApiKeyAuthenticator({
      type: 'apiKey',
      apiKey: 'test-key',
    });

    const request: AuthenticatedRequest = {
      url: 'https://pay.example.com/transactions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const originalHeaders = { ...request.headers };
    await authenticator.authenticate(request);

    expect(request.headers).toEqual(originalHeaders);
  });
});
