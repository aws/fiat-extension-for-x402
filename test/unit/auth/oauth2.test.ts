// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for OAuth2 authenticator
 */

import { describe, it, expect, vi } from 'vitest';
import { OAuth2Authenticator } from '../../../src/auth/oauth2';
import type { AuthenticatedRequest } from '../../../src/auth/types';

describe('OAuth2Authenticator', () => {
  it('should add bearer token to Authorization header', async () => {
    const authenticator = new OAuth2Authenticator({
      type: 'oauth2',
      accessToken: 'test-token-123',
    });

    const request: AuthenticatedRequest = {
      url: 'https://pay.example.com/transactions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const result = await authenticator.authenticate(request);

    expect(result.headers['Authorization']).toBe('Bearer test-token-123');
    expect(result.headers['Content-Type']).toBe('application/json');
  });

  it('should throw error for empty access token', () => {
    expect(() => {
      new OAuth2Authenticator({
        type: 'oauth2',
        accessToken: '',
      });
    }).toThrow('Access token cannot be empty');
  });

  it('should call onTokenRefresh callback when token is refreshed', async () => {
    const onTokenRefresh = vi.fn();
    const authenticator = new OAuth2Authenticator({
      type: 'oauth2',
      accessToken: 'old-token',
      refreshToken: 'refresh-token',
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'client-123',
      clientSecret: 'secret-456',
      onTokenRefresh,
    });

    // Mock fetch for token refresh
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'new-token',
        expires_in: 3600,
      }),
    });

    await authenticator.refreshAccessToken();

    expect(onTokenRefresh).toHaveBeenCalledWith('new-token');
  });

  it('should handle token refresh failure', async () => {
    const authenticator = new OAuth2Authenticator({
      type: 'oauth2',
      accessToken: 'old-token',
      refreshToken: 'refresh-token',
      tokenEndpoint: 'https://auth.example.com/token',
      clientId: 'client-123',
    });

    // Mock fetch to fail
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized',
    });

    await expect(authenticator.refreshAccessToken()).rejects.toThrow('Token refresh failed');
  });

  it('should not modify original request', async () => {
    const authenticator = new OAuth2Authenticator({
      type: 'oauth2',
      accessToken: 'test-token',
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
