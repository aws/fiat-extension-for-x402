/**
 * Authentication module exports
 */

// Types
export type {
  AuthConfig,
  ApiKeyAuthConfig,
  AwsSigV4AuthConfig,
  OAuth2AuthConfig,
  CustomAuthConfig,
  AwsCredentials,
  AuthenticatedRequest,
  Authenticator
} from './types';

// Errors
export {
  AuthenticationError,
  InvalidCredentialsError,
  ExpiredCredentialsError,
  MissingCredentialsError,
  AuthenticationTimeoutError
} from './errors';

// Authenticators
export { ApiKeyAuthenticator } from './api-key';
export { AwsSigV4Authenticator, createEnvCredentialProvider } from './aws-sigv4';
export { OAuth2Authenticator } from './oauth2';
export { CustomAuthenticator } from './custom';

// Factory
export { createAuthenticator } from './factory';
