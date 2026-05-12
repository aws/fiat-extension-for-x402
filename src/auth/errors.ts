/**
 * Authentication error types
 */

import { AgenticPayError } from '../types';

/**
 * Base authentication error
 */
export class AuthenticationError extends AgenticPayError {
  constructor(
    message: string,
    public readonly authMethod: string,
    public readonly originalError?: Error,
    public readonly retryable: boolean = false
  ) {
    super(message, 'AUTHENTICATION_ERROR', { authMethod, retryable });
    this.name = 'AuthenticationError';
  }
}

/**
 * Invalid credentials error
 */
export class InvalidCredentialsError extends AuthenticationError {
  constructor(authMethod: string, details?: string) {
    super(
      `Invalid credentials for ${authMethod}${details ? `: ${details}` : ''}`,
      authMethod,
      undefined,
      false
    );
    this.name = 'InvalidCredentialsError';
  }
}

/**
 * Expired credentials error
 */
export class ExpiredCredentialsError extends AuthenticationError {
  constructor(authMethod: string, details?: string) {
    super(
      `Expired credentials for ${authMethod}${details ? `: ${details}` : ''}`,
      authMethod,
      undefined,
      true
    );
    this.name = 'ExpiredCredentialsError';
  }
}

/**
 * Missing credentials error
 */
export class MissingCredentialsError extends AuthenticationError {
  constructor(authMethod: string, missingField: string) {
    super(
      `Missing required credential field for ${authMethod}: ${missingField}`,
      authMethod,
      undefined,
      false
    );
    this.name = 'MissingCredentialsError';
  }
}

/**
 * Authentication timeout error
 */
export class AuthenticationTimeoutError extends AuthenticationError {
  constructor(authMethod: string, timeoutMs: number) {
    super(
      `Authentication timeout for ${authMethod} after ${timeoutMs}ms`,
      authMethod,
      undefined,
      true
    );
    this.name = 'AuthenticationTimeoutError';
  }
}
