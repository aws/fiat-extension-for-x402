// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for authentication errors
 */

import { describe, it, expect } from 'vitest';
import {
  AuthenticationError,
  InvalidCredentialsError,
  ExpiredCredentialsError,
  MissingCredentialsError,
  AuthenticationTimeoutError,
} from '../../../src/auth/errors';

describe('Authentication Errors', () => {
  describe('AuthenticationError', () => {
    it('should create error with message and auth method', () => {
      const error = new AuthenticationError('Test error', 'apiKey');

      expect(error.message).toBe('Test error');
      expect(error.authMethod).toBe('apiKey');
      expect(error.retryable).toBe(false);
      expect(error.name).toBe('AuthenticationError');
    });

    it('should support retryable flag', () => {
      const error = new AuthenticationError('Test error', 'oauth2', undefined, true);

      expect(error.retryable).toBe(true);
    });

    it('should include original error', () => {
      const originalError = new Error('Original');
      const error = new AuthenticationError('Test error', 'custom', originalError);

      expect(error.originalError).toBe(originalError);
    });
  });

  describe('InvalidCredentialsError', () => {
    it('should create error with auth method', () => {
      const error = new InvalidCredentialsError('apiKey');

      expect(error.message).toBe('Invalid credentials for apiKey');
      expect(error.authMethod).toBe('apiKey');
      expect(error.retryable).toBe(false);
      expect(error.name).toBe('InvalidCredentialsError');
    });

    it('should include details in message', () => {
      const error = new InvalidCredentialsError('oauth2', 'token expired');

      expect(error.message).toBe('Invalid credentials for oauth2: token expired');
    });
  });

  describe('ExpiredCredentialsError', () => {
    it('should create error with auth method', () => {
      const error = new ExpiredCredentialsError('awsSigV4');

      expect(error.message).toBe('Expired credentials for awsSigV4');
      expect(error.authMethod).toBe('awsSigV4');
      expect(error.retryable).toBe(true);
      expect(error.name).toBe('ExpiredCredentialsError');
    });

    it('should include details in message', () => {
      const error = new ExpiredCredentialsError('oauth2', 'refresh token expired');

      expect(error.message).toBe('Expired credentials for oauth2: refresh token expired');
    });
  });

  describe('MissingCredentialsError', () => {
    it('should create error with missing field', () => {
      const error = new MissingCredentialsError('apiKey', 'apiKey');

      expect(error.message).toBe('Missing required credential field for apiKey: apiKey');
      expect(error.authMethod).toBe('apiKey');
      expect(error.retryable).toBe(false);
      expect(error.name).toBe('MissingCredentialsError');
    });
  });

  describe('AuthenticationTimeoutError', () => {
    it('should create error with timeout', () => {
      const error = new AuthenticationTimeoutError('oauth2', 5000);

      expect(error.message).toBe('Authentication timeout for oauth2 after 5000ms');
      expect(error.authMethod).toBe('oauth2');
      expect(error.retryable).toBe(true);
      expect(error.name).toBe('AuthenticationTimeoutError');
    });
  });
});
