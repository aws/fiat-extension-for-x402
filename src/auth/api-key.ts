// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * API Key authentication implementation
 */

import type { ApiKeyAuthConfig, Authenticator, AuthenticatedRequest } from './types';
import { InvalidCredentialsError } from './errors';

/**
 * API Key authenticator
 * Adds API key to request headers
 */
export class ApiKeyAuthenticator implements Authenticator {
  private readonly apiKey: string;
  private readonly headerName: string;
  private readonly prefix: string;

  constructor(config: ApiKeyAuthConfig) {
    if (!config.apiKey || config.apiKey.trim().length === 0) {
      throw new InvalidCredentialsError('apiKey', 'API key cannot be empty');
    }

    this.apiKey = config.apiKey;
    this.headerName = config.headerName || 'X-API-Key';
    this.prefix = config.prefix || '';
  }

  async authenticate(request: AuthenticatedRequest): Promise<AuthenticatedRequest> {
    const value = this.prefix ? `${this.prefix}${this.apiKey}` : this.apiKey;

    return {
      ...request,
      headers: {
        ...request.headers,
        [this.headerName]: value
      }
    };
  }
}
