/**
 * Tests for Custom authenticator
 */

import { describe, it, expect, vi } from 'vitest';
import { CustomAuthenticator } from '../../../src/auth/custom';
import type { AuthenticatedRequest } from '../../../src/auth/types';

describe('CustomAuthenticator', () => {
  it('should call custom authenticate function', async () => {
    const customAuth = vi.fn(async (req: AuthenticatedRequest) => ({
      ...req,
      headers: {
        ...req.headers,
        'X-Custom-Auth': 'custom-value',
      },
    }));

    const authenticator = new CustomAuthenticator({
      type: 'custom',
      authenticate: customAuth,
    });

    const request: AuthenticatedRequest = {
      url: 'https://wallet.example.com/transactions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const result = await authenticator.authenticate(request);

    expect(customAuth).toHaveBeenCalledWith(request);
    expect(result.headers['X-Custom-Auth']).toBe('custom-value');
  });

  it('should validate that custom function returns AuthenticatedRequest', async () => {
    const invalidAuth = vi.fn(async () => ({
      // Missing required fields
      url: 'https://wallet.example.com/transactions',
    }));

    const authenticator = new CustomAuthenticator({
      type: 'custom',
      authenticate: invalidAuth as any,
    });

    const request: AuthenticatedRequest = {
      url: 'https://wallet.example.com/transactions',
      method: 'POST',
      headers: {},
    };

    await expect(authenticator.authenticate(request)).rejects.toThrow(
      'Custom authenticate function must return a valid AuthenticatedRequest'
    );
  });

  it('should handle errors from custom function', async () => {
    const errorAuth = vi.fn(async () => {
      throw new Error('Custom auth failed');
    });

    const authenticator = new CustomAuthenticator({
      type: 'custom',
      authenticate: errorAuth,
    });

    const request: AuthenticatedRequest = {
      url: 'https://wallet.example.com/transactions',
      method: 'POST',
      headers: {},
    };

    await expect(authenticator.authenticate(request)).rejects.toThrow(
      'Custom authentication failed'
    );
  });

  it('should allow modifying all request properties', async () => {
    const customAuth = async (req: AuthenticatedRequest): Promise<AuthenticatedRequest> => ({
      url: req.url + '?authenticated=true',
      method: req.method,
      headers: {
        ...req.headers,
        'X-Signature': 'sig-123',
      },
      body: req.body,
    });

    const authenticator = new CustomAuthenticator({
      type: 'custom',
      authenticate: customAuth,
    });

    const request: AuthenticatedRequest = {
      url: 'https://wallet.example.com/transactions',
      method: 'POST',
      headers: {},
      body: '{"test": true}',
    };

    const result = await authenticator.authenticate(request);

    expect(result.url).toBe('https://wallet.example.com/transactions?authenticated=true');
    expect(result.headers['X-Signature']).toBe('sig-123');
  });
});
