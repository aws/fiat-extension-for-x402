// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for authentication factory
 */

import { describe, it, expect } from 'vitest';
import { createAuthenticator } from '../../../src/auth/factory';
import { ApiKeyAuthenticator } from '../../../src/auth/api-key';
import { AwsSigV4Authenticator } from '../../../src/auth/aws-sigv4';
import { OAuth2Authenticator } from '../../../src/auth/oauth2';
import { CustomAuthenticator } from '../../../src/auth/custom';
import type { AuthConfig } from '../../../src/auth/types';

describe('createAuthenticator', () => {
  it('should create ApiKeyAuthenticator', () => {
    const config: AuthConfig = {
      type: 'apiKey',
      apiKey: 'test-key',
    };

    const authenticator = createAuthenticator(config);

    expect(authenticator).toBeInstanceOf(ApiKeyAuthenticator);
  });

  it('should create AwsSigV4Authenticator', () => {
    const config: AuthConfig = {
      type: 'awsSigV4',
      region: 'us-east-1',
      credentials: {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      },
    };

    const authenticator = createAuthenticator(config);

    expect(authenticator).toBeInstanceOf(AwsSigV4Authenticator);
  });

  it('should create OAuth2Authenticator', () => {
    const config: AuthConfig = {
      type: 'oauth2',
      accessToken: 'test-token',
    };

    const authenticator = createAuthenticator(config);

    expect(authenticator).toBeInstanceOf(OAuth2Authenticator);
  });

  it('should create CustomAuthenticator', () => {
    const config: AuthConfig = {
      type: 'custom',
      authenticate: async (req) => req,
    };

    const authenticator = createAuthenticator(config);

    expect(authenticator).toBeInstanceOf(CustomAuthenticator);
  });

  it('should throw error for unknown auth type', () => {
    const config = {
      type: 'unknown',
    } as any;

    expect(() => createAuthenticator(config)).toThrow('Unknown authentication type');
  });
});
