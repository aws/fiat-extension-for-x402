// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Authentication types for client-to-agent-pay communication
 */

/**
 * AWS credentials for SigV4 signing
 */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * API Key authentication configuration
 */
export interface ApiKeyAuthConfig {
  type: 'apiKey';
  apiKey: string;
  headerName?: string; // Default: 'X-API-Key'
  prefix?: string; // Optional prefix like 'Bearer '
}

/**
 * AWS SigV4 authentication configuration
 */
export interface AwsSigV4AuthConfig {
  type: 'awsSigV4';
  credentials?: AwsCredentials;
  region: string;
  service?: string; // Default: 'execute-api'
  credentialProvider?: () => Promise<AwsCredentials>;
}

/**
 * OAuth2 authentication configuration
 */
export interface OAuth2AuthConfig {
  type: 'oauth2';
  accessToken: string;
  refreshToken?: string;
  tokenEndpoint?: string;
  clientId?: string;
  clientSecret?: string;
  onTokenRefresh?: (newToken: string) => void;
}

/**
 * Custom authentication configuration
 */
export interface CustomAuthConfig {
  type: 'custom';
  authenticate: (request: AuthenticatedRequest) => Promise<AuthenticatedRequest>;
}

/**
 * Union type of all authentication configurations
 */
export type AuthConfig =
  | ApiKeyAuthConfig
  | AwsSigV4AuthConfig
  | OAuth2AuthConfig
  | CustomAuthConfig;

/**
 * HTTP request structure for authentication
 */
export interface AuthenticatedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/**
 * Base authenticator interface
 */
export interface Authenticator {
  authenticate(request: AuthenticatedRequest): Promise<AuthenticatedRequest>;
}
