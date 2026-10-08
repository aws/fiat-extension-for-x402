// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * AWS SigV4 authentication implementation
 *
 * Uses @smithy/signature-v4 for real AWS Signature Version 4 request signing.
 * This is the same signing library used by all official AWS SDK clients.
 */

import { SignatureV4 } from '@smithy/signature-v4';
import { HttpRequest } from '@smithy/protocol-http';
import { Sha256 } from '@aws-crypto/sha256-js';
import type {
  AwsSigV4AuthConfig,
  Authenticator,
  AuthenticatedRequest,
  AwsCredentials,
} from './types';
import { InvalidCredentialsError, MissingCredentialsError } from './errors';

interface CachedCredentials {
  credentials: AwsCredentials;
  expiresAt?: number;
}

/**
 * AWS SigV4 authenticator
 * Signs requests using AWS Signature Version 4 via @smithy/signature-v4
 */
export class AwsSigV4Authenticator implements Authenticator {
  private readonly region: string;
  private readonly service: string;
  private readonly staticCredentials?: AwsCredentials;
  private readonly credentialProvider?: () => Promise<AwsCredentials>;
  private cachedCredentials?: CachedCredentials;

  constructor(config: AwsSigV4AuthConfig) {
    if (!config.region || config.region.trim().length === 0) {
      throw new MissingCredentialsError('awsSigV4', 'region');
    }

    if (!config.credentials && !config.credentialProvider) {
      throw new MissingCredentialsError('awsSigV4', 'credentials or credentialProvider');
    }

    this.region = config.region;
    this.service = config.service || 'execute-api';
    this.staticCredentials = config.credentials;
    this.credentialProvider = config.credentialProvider;
  }

  async authenticate(request: AuthenticatedRequest): Promise<AuthenticatedRequest> {
    const credentials = await this.getCredentials();
    const signedHeaders = await this.signRequest(request, credentials);

    return {
      ...request,
      headers: {
        ...request.headers,
        ...signedHeaders,
      },
    };
  }

  private async getCredentials(): Promise<AwsCredentials> {
    if (this.staticCredentials) {
      this.validateCredentials(this.staticCredentials);
      return this.staticCredentials;
    }

    // Check cached credentials
    if (this.cachedCredentials) {
      const now = Date.now();
      if (!this.cachedCredentials.expiresAt || this.cachedCredentials.expiresAt > now) {
        return this.cachedCredentials.credentials;
      }
    }

    if (!this.credentialProvider) {
      throw new MissingCredentialsError('awsSigV4', 'credentials');
    }

    try {
      const credentials = await this.credentialProvider();
      this.validateCredentials(credentials);

      // Cache credentials (assume 1 hour expiry if session token present)
      this.cachedCredentials = {
        credentials,
        expiresAt: credentials.sessionToken
          ? Date.now() + 55 * 60 * 1000 // 55 minutes
          : undefined,
      };

      return credentials;
    } catch (error) {
      // Re-throw known credential errors as-is for consistent error types
      // regardless of whether static credentials or a provider is used
      if (error instanceof MissingCredentialsError || error instanceof InvalidCredentialsError) {
        throw error;
      }
      throw new InvalidCredentialsError(
        'awsSigV4',
        `Failed to fetch credentials: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private validateCredentials(credentials: AwsCredentials): void {
    if (!credentials.accessKeyId || credentials.accessKeyId.trim().length === 0) {
      throw new MissingCredentialsError('awsSigV4', 'accessKeyId');
    }

    if (!credentials.secretAccessKey || credentials.secretAccessKey.trim().length === 0) {
      throw new MissingCredentialsError('awsSigV4', 'secretAccessKey');
    }
  }

  private async signRequest(
    request: AuthenticatedRequest,
    credentials: AwsCredentials
  ): Promise<Record<string, string>> {
    const url = new URL(request.url);

    // Build the HttpRequest object for @smithy/signature-v4
    const httpRequest = new HttpRequest({
      method: request.method.toUpperCase(),
      hostname: url.hostname,
      port: url.port ? parseInt(url.port, 10) : undefined,
      path: url.pathname + url.search,
      headers: {
        host: url.host,
        ...(request.headers || {}),
      },
      body: request.body || undefined,
    });

    // Create signer with current credentials
    const signer = new SignatureV4({
      service: this.service,
      region: this.region,
      credentials: {
        accessKeyId: credentials.accessKeyId,
        secretAccessKey: credentials.secretAccessKey,
        sessionToken: credentials.sessionToken,
      },
      sha256: Sha256,
    });

    // Sign the request
    const signed = await signer.sign(httpRequest);

    // Extract the signed headers (Authorization, x-amz-date, x-amz-security-token, host)
    return signed.headers as Record<string, string>;
  }

  /**
   * Clear cached credentials
   */
  clearCache(): void {
    this.cachedCredentials = undefined;
  }
}

/**
 * Helper to create credential provider from environment variables
 */
export function createEnvCredentialProvider(): () => Promise<AwsCredentials> {
  return async () => {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const sessionToken = process.env.AWS_SESSION_TOKEN;

    if (!accessKeyId || !secretAccessKey) {
      throw new MissingCredentialsError(
        'awsSigV4',
        'AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY environment variable'
      );
    }

    return {
      accessKeyId,
      secretAccessKey,
      sessionToken,
    };
  };
}
