/**
 * AWS SigV4 authentication implementation
 * 
 * Note: This is a simplified implementation for demonstration.
 * For production use, consider using @aws-sdk/signature-v4 or @smithy/signature-v4
 */

import type { AwsSigV4AuthConfig, Authenticator, AuthenticatedRequest, AwsCredentials } from './types';
import { InvalidCredentialsError, MissingCredentialsError, ExpiredCredentialsError } from './errors';

interface CachedCredentials {
  credentials: AwsCredentials;
  expiresAt?: number;
}

/**
 * AWS SigV4 authenticator
 * Signs requests using AWS Signature Version 4
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
    
    // For now, we'll add a placeholder for AWS SigV4 signing
    // In production, this should use @aws-sdk/signature-v4
    const signedHeaders = await this.signRequest(request, credentials);

    return {
      ...request,
      headers: {
        ...request.headers,
        ...signedHeaders
      }
    };
  }

  private async getCredentials(): Promise<AwsCredentials> {
    // Use static credentials if provided
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

    // Fetch from provider
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
          : undefined
      };

      return credentials;
    } catch (error) {
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
    // This is a placeholder implementation
    // In production, use @aws-sdk/signature-v4 or @smithy/signature-v4
    
    const timestamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const date = timestamp.slice(0, 8);

    // Parse URL
    const url = new URL(request.url);
    const host = url.host;

    // Create canonical request components
    const headers: Record<string, string> = {
      'host': host,
      'x-amz-date': timestamp
    };

    if (credentials.sessionToken) {
      headers['x-amz-security-token'] = credentials.sessionToken;
    }

    // Add authorization header (simplified - not actual SigV4)
    // In production, this should compute the actual signature
    headers['Authorization'] = `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${date}/${this.region}/${this.service}/aws4_request, SignedHeaders=host;x-amz-date, Signature=placeholder`;

    return headers;
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
      sessionToken
    };
  };
}
