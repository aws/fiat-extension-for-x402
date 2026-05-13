/**
 * AWS SigV4 Authenticator Tests
 * 
 * Verifies that the SigV4 authenticator:
 * - Adds AWS4-HMAC-SHA256 Authorization header
 * - Adds x-amz-date header
 * - Adds x-amz-security-token when session token is present
 * - Validates credentials (throws on missing)
 * - Supports credential providers with caching
 */

import { describe, it, expect, vi } from 'vitest';
import { AwsSigV4Authenticator, createEnvCredentialProvider } from '../../../src/auth/aws-sigv4';
import { MissingCredentialsError, InvalidCredentialsError } from '../../../src/auth/errors';

describe('AwsSigV4Authenticator', () => {
  const validConfig = {
    type: 'awsSigV4' as const,
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    },
  };

  describe('constructor validation', () => {
    it('should throw MissingCredentialsError when region is empty', () => {
      expect(() => new AwsSigV4Authenticator({
        ...validConfig,
        region: '',
      })).toThrow(MissingCredentialsError);
    });

    it('should throw MissingCredentialsError when no credentials or provider', () => {
      expect(() => new AwsSigV4Authenticator({
        type: 'awsSigV4',
        region: 'us-east-1',
      } as any)).toThrow(MissingCredentialsError);
    });

    it('should accept valid static credentials', () => {
      expect(() => new AwsSigV4Authenticator(validConfig)).not.toThrow();
    });

    it('should accept credential provider', () => {
      expect(() => new AwsSigV4Authenticator({
        type: 'awsSigV4',
        region: 'us-east-1',
        credentialProvider: async () => ({
          accessKeyId: 'AKIA...',
          secretAccessKey: 'secret',
        }),
      })).not.toThrow();
    });
  });

  describe('authenticate', () => {
    it('should add AWS4-HMAC-SHA256 Authorization header', async () => {
      const auth = new AwsSigV4Authenticator(validConfig);
      const request = {
        url: 'https://pay.aws.amazon.com/CreateAgentPayment',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"quoteToken":"..."}',
      };

      const signed = await auth.authenticate(request);

      expect(signed.headers['authorization']).toBeDefined();
      expect(signed.headers['authorization']).toContain('AWS4-HMAC-SHA256');
      expect(signed.headers['authorization']).toContain('Credential=AKIAIOSFODNN7EXAMPLE');
      expect(signed.headers['authorization']).toContain('us-east-1');
      expect(signed.headers['authorization']).toContain('execute-api');
    });

    it('should add x-amz-date header', async () => {
      const auth = new AwsSigV4Authenticator(validConfig);
      const request = {
        url: 'https://pay.aws.amazon.com/CreateAgentPayment',
        method: 'POST',
        headers: {},
      };

      const signed = await auth.authenticate(request);

      expect(signed.headers['x-amz-date']).toBeDefined();
      expect(signed.headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
    });

    it('should add host header', async () => {
      const auth = new AwsSigV4Authenticator(validConfig);
      const request = {
        url: 'https://pay.aws.amazon.com/CreateAgentPayment',
        method: 'POST',
        headers: {},
      };

      const signed = await auth.authenticate(request);

      expect(signed.headers['host']).toBe('pay.aws.amazon.com');
    });

    it('should add x-amz-security-token when session token is present', async () => {
      const auth = new AwsSigV4Authenticator({
        ...validConfig,
        credentials: {
          ...validConfig.credentials,
          sessionToken: 'FwoGZXIvYXdzEBY...',
        },
      });
      const request = {
        url: 'https://pay.aws.amazon.com/CreateAgentPayment',
        method: 'POST',
        headers: {},
      };

      const signed = await auth.authenticate(request);

      expect(signed.headers['x-amz-security-token']).toBe('FwoGZXIvYXdzEBY...');
    });

    it('should NOT add x-amz-security-token when no session token', async () => {
      const auth = new AwsSigV4Authenticator(validConfig);
      const request = {
        url: 'https://pay.aws.amazon.com/CreateAgentPayment',
        method: 'POST',
        headers: {},
      };

      const signed = await auth.authenticate(request);

      expect(signed.headers['x-amz-security-token']).toBeUndefined();
    });

    it('should preserve existing headers', async () => {
      const auth = new AwsSigV4Authenticator(validConfig);
      const request = {
        url: 'https://pay.aws.amazon.com/CreateAgentPayment',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Custom': 'value' },
      };

      const signed = await auth.authenticate(request);

      expect(signed.headers['Content-Type']).toBe('application/json');
      expect(signed.headers['X-Custom']).toBe('value');
    });

    it('should use custom service name', async () => {
      const auth = new AwsSigV4Authenticator({
        ...validConfig,
        service: 'marketplace',
      });
      const request = {
        url: 'https://pay.aws.amazon.com/CreateAgentPayment',
        method: 'POST',
        headers: {},
      };

      const signed = await auth.authenticate(request);

      expect(signed.headers['authorization']).toContain('marketplace');
    });
  });

  describe('credential provider', () => {
    it('should call credential provider when no static credentials', async () => {
      const provider = vi.fn().mockResolvedValue({
        accessKeyId: 'AKIA-FROM-PROVIDER',
        secretAccessKey: 'secret-from-provider',
      });

      const auth = new AwsSigV4Authenticator({
        type: 'awsSigV4',
        region: 'us-west-2',
        credentialProvider: provider,
      });

      const request = {
        url: 'https://pay.aws.amazon.com/CreateAgentPayment',
        method: 'POST',
        headers: {},
      };

      const signed = await auth.authenticate(request);

      expect(provider).toHaveBeenCalledOnce();
      expect(signed.headers['authorization']).toContain('AKIA-FROM-PROVIDER');
    });

    it('should cache credentials from provider', async () => {
      const provider = vi.fn().mockResolvedValue({
        accessKeyId: 'AKIA-CACHED',
        secretAccessKey: 'secret',
        sessionToken: 'token',
      });

      const auth = new AwsSigV4Authenticator({
        type: 'awsSigV4',
        region: 'us-east-1',
        credentialProvider: provider,
      });

      const request = { url: 'https://example.com/api', method: 'POST', headers: {} };

      await auth.authenticate(request);
      await auth.authenticate(request);

      // Provider should only be called once (cached)
      expect(provider).toHaveBeenCalledOnce();
    });

    it('should throw InvalidCredentialsError when provider fails', async () => {
      const provider = vi.fn().mockRejectedValue(new Error('Network error'));

      const auth = new AwsSigV4Authenticator({
        type: 'awsSigV4',
        region: 'us-east-1',
        credentialProvider: provider,
      });

      const request = { url: 'https://example.com/api', method: 'POST', headers: {} };

      await expect(auth.authenticate(request)).rejects.toThrow(InvalidCredentialsError);
    });

    it('should throw MissingCredentialsError when provider returns empty accessKeyId', async () => {
      const provider = vi.fn().mockResolvedValue({
        accessKeyId: '',
        secretAccessKey: 'secret',
      });

      const auth = new AwsSigV4Authenticator({
        type: 'awsSigV4',
        region: 'us-east-1',
        credentialProvider: provider,
      });

      const request = { url: 'https://example.com/api', method: 'POST', headers: {} };

      await expect(auth.authenticate(request)).rejects.toThrow(MissingCredentialsError);
    });
  });

  describe('createEnvCredentialProvider', () => {
    it('should read from environment variables', async () => {
      process.env.AWS_ACCESS_KEY_ID = 'AKIA-ENV';
      process.env.AWS_SECRET_ACCESS_KEY = 'secret-env';
      process.env.AWS_SESSION_TOKEN = 'token-env';

      const provider = createEnvCredentialProvider();
      const creds = await provider();

      expect(creds.accessKeyId).toBe('AKIA-ENV');
      expect(creds.secretAccessKey).toBe('secret-env');
      expect(creds.sessionToken).toBe('token-env');

      // Cleanup
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;
      delete process.env.AWS_SESSION_TOKEN;
    });

    it('should throw when env vars are missing', async () => {
      delete process.env.AWS_ACCESS_KEY_ID;
      delete process.env.AWS_SECRET_ACCESS_KEY;

      const provider = createEnvCredentialProvider();

      await expect(provider()).rejects.toThrow(MissingCredentialsError);
    });
  });
});
