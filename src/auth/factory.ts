// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Authentication factory
 * Creates appropriate authenticator based on configuration
 */

import type { AuthConfig, Authenticator } from './types';
import { ApiKeyAuthenticator } from './api-key';
import { AwsSigV4Authenticator } from './aws-sigv4';
import { OAuth2Authenticator } from './oauth2';
import { CustomAuthenticator } from './custom';
import { AuthenticationError } from './errors';

/**
 * Create an authenticator from configuration
 */
export function createAuthenticator(config: AuthConfig): Authenticator {
  switch (config.type) {
    case 'apiKey':
      return new ApiKeyAuthenticator(config);
    
    case 'awsSigV4':
      return new AwsSigV4Authenticator(config);
    
    case 'oauth2':
      return new OAuth2Authenticator(config);
    
    case 'custom':
      return new CustomAuthenticator(config);
    
    default:
      // TypeScript should prevent this, but handle it anyway
      throw new AuthenticationError(
        `Unknown authentication type: ${(config as any).type}`,
        'unknown'
      );
  }
}
