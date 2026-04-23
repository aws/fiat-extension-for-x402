/**
 * Custom authentication implementation
 */

import type { CustomAuthConfig, Authenticator, AuthenticatedRequest } from './types';
import { AuthenticationError } from './errors';

/**
 * Custom authenticator
 * Delegates to user-provided authentication function
 */
export class CustomAuthenticator implements Authenticator {
  private readonly authenticateFn: (request: AuthenticatedRequest) => Promise<AuthenticatedRequest>;

  constructor(config: CustomAuthConfig) {
    if (!config.authenticate || typeof config.authenticate !== 'function') {
      throw new AuthenticationError(
        'Custom authenticate function must be provided',
        'custom'
      );
    }

    this.authenticateFn = config.authenticate;
  }

  async authenticate(request: AuthenticatedRequest): Promise<AuthenticatedRequest> {
    try {
      const authenticatedRequest = await this.authenticateFn(request);

      // Validate that the function returned a valid request
      if (!authenticatedRequest || typeof authenticatedRequest !== 'object') {
        throw new AuthenticationError(
          'Custom authenticate function must return an AuthenticatedRequest object',
          'custom'
        );
      }

      if (!authenticatedRequest.url || !authenticatedRequest.method || !authenticatedRequest.headers) {
        throw new AuthenticationError(
          'Custom authenticate function must return a valid AuthenticatedRequest with url, method, and headers',
          'custom'
        );
      }

      return authenticatedRequest;
    } catch (error) {
      if (error instanceof AuthenticationError) {
        throw error;
      }

      throw new AuthenticationError(
        `Custom authentication failed: ${error instanceof Error ? error.message : String(error)}`,
        'custom',
        error instanceof Error ? error : undefined
      );
    }
  }
}
