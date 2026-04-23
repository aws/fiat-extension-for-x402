/**
 * OAuth2 authentication implementation
 */

import type { OAuth2AuthConfig, Authenticator, AuthenticatedRequest } from './types';
import { InvalidCredentialsError, ExpiredCredentialsError } from './errors';

/**
 * OAuth2 authenticator
 * Adds bearer token to Authorization header
 * Supports token refresh
 */
export class OAuth2Authenticator implements Authenticator {
  private accessToken: string;
  private readonly refreshToken?: string;
  private readonly tokenEndpoint?: string;
  private readonly clientId?: string;
  private readonly clientSecret?: string;
  private readonly onTokenRefresh?: (newToken: string) => void;
  private refreshInProgress: Promise<void> | null = null;

  constructor(config: OAuth2AuthConfig) {
    if (!config.accessToken || config.accessToken.trim().length === 0) {
      throw new InvalidCredentialsError('oauth2', 'Access token cannot be empty');
    }

    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken;
    this.tokenEndpoint = config.tokenEndpoint;
    this.clientId = config.clientId;
    this.clientSecret = config.clientSecret;
    this.onTokenRefresh = config.onTokenRefresh;
  }

  async authenticate(request: AuthenticatedRequest): Promise<AuthenticatedRequest> {
    // Wait for any in-progress refresh
    if (this.refreshInProgress) {
      await this.refreshInProgress;
    }

    return {
      ...request,
      headers: {
        ...request.headers,
        'Authorization': `Bearer ${this.accessToken}`
      }
    };
  }

  /**
   * Refresh the access token using the refresh token
   * This should be called when a 401 response is received
   */
  async refreshAccessToken(): Promise<void> {
    // Prevent concurrent refresh attempts
    if (this.refreshInProgress) {
      return this.refreshInProgress;
    }

    if (!this.refreshToken) {
      throw new ExpiredCredentialsError('oauth2', 'No refresh token available');
    }

    if (!this.tokenEndpoint) {
      throw new InvalidCredentialsError('oauth2', 'Token endpoint not configured');
    }

    this.refreshInProgress = this._performRefresh();
    
    try {
      await this.refreshInProgress;
    } finally {
      this.refreshInProgress = null;
    }
  }

  private async _performRefresh(): Promise<void> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: this.refreshToken!
    });

    if (this.clientId) {
      body.append('client_id', this.clientId);
    }

    if (this.clientSecret) {
      body.append('client_secret', this.clientSecret);
    }

    const response = await fetch(this.tokenEndpoint!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    if (!response.ok) {
      throw new ExpiredCredentialsError(
        'oauth2',
        `Token refresh failed: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();

    if (!data.access_token) {
      throw new InvalidCredentialsError('oauth2', 'No access token in refresh response');
    }

    this.accessToken = data.access_token;

    // Notify callback
    if (this.onTokenRefresh) {
      this.onTokenRefresh(this.accessToken);
    }
  }

  /**
   * Get the current access token
   */
  getAccessToken(): string {
    return this.accessToken;
  }
}
