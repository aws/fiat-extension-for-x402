/**
 * Default Agentic Pay client implementation
 * Handles HTTP communication with Agentic Pay provider endpoints
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { AgenticPayClient, AgenticPayConfig } from './config';
import { ValidationError } from './types';
import type { Authenticator, AuthenticatedRequest } from './auth/types';
import { createAuthenticator } from './auth/factory';

/**
 * JWKS cache entry
 */
interface JWKSCacheEntry {
  jwks: ReturnType<typeof createRemoteJWKSet>;
  expiresAt: number;
}

/**
 * Default Agentic Pay client implementation
 * Uses standardized endpoints derived from baseUrl
 */
export class DefaultAgenticPayClient implements AgenticPayClient {
  private readonly baseUrl: string;
  private readonly authenticator?: Authenticator;
  private jwksCache: Map<string, JWKSCacheEntry> = new Map();
  private readonly JWKS_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

  /**
   * Create a new default Agentic Pay client
   * 
   * @param config - Agentic Pay configuration with baseUrl and optional auth
   */
  constructor(config: AgenticPayConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    
    // Create authenticator if auth config provided
    if (config.auth) {
      this.authenticator = createAuthenticator(config.auth);
    }
  }

  /**
   * Authorize a payment with the Agentic Pay provider
   * Calls POST /transactions endpoint
   * 
   * @param payload - Payment authorization request
   * @returns Transaction ID and signed payment token
   */
  async authorize(payload: {
    network: string;
    amount: string;
    currency: string;
    payTo: string;
    quoteToken: string;
    agenticPayId: string;
  }): Promise<{
    transactionId: string;
    paymentToken: string;
  }> {
    const url = `${this.baseUrl}/transactions`;
    const body = JSON.stringify(payload);
    
    try {
      // Prepare request
      let request: AuthenticatedRequest = {
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      };
      
      // Apply authentication if configured
      if (this.authenticator) {
        request = await this.authenticator.authenticate(request);
      }
      
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new ValidationError(
          `Agentic Pay authorization failed (${response.status}): ${errorText}`
        );
      }

      const result = await response.json() as any;
      
      if (!result.transactionId || !result.paymentToken) {
        throw new ValidationError(
          'Invalid Agentic Pay response: missing transactionId or paymentToken'
        );
      }

      return {
        transactionId: result.transactionId as string,
        paymentToken: result.paymentToken as string,
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to authorize payment with Agentic Pay: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Verify a payment token's signature
   * Fetches Agentic Pay's public keys from JWKS endpoint and verifies JWT
   * 
   * @param token - Payment token JWT to verify
   * @returns Decoded and verified payment token payload
   */
  async verifyPaymentToken(token: string): Promise<{
    iss: string;
    sub: string;
    aud: string;
    iat: number;
    exp: number;
    payment_context: {
      transaction_id: string;
      quote_token: string;
    };
  }> {
    try {
      // Get JWKS (cached)
      const jwks = await this.getJWKS();
      
      // Verify JWT signature
      const { payload } = await jwtVerify(token, jwks);
      
      // Validate required fields
      if (!payload.iss || !payload.sub || !payload.aud || !payload.iat || !payload.exp) {
        throw new ValidationError('Invalid payment token: missing required fields');
      }
      
      const paymentContext = payload.payment_context as any;
      if (!paymentContext?.transaction_id || !paymentContext?.quote_token) {
        throw new ValidationError('Invalid payment token: missing payment_context');
      }

      return {
        iss: payload.iss as string,
        sub: payload.sub as string,
        aud: payload.aud as string,
        iat: payload.iat as number,
        exp: payload.exp as number,
        payment_context: {
          transaction_id: paymentContext.transaction_id,
          quote_token: paymentContext.quote_token,
        },
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to verify payment token: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Capture/settle a payment with the Agentic Pay provider
   * Calls POST /capture endpoint
   * 
   * @param transactionId - Transaction ID from payment token
   * @param amount - Amount to capture
   * @param currency - Currency code
   * @returns Capture result with confirmation
   */
  async capturePayment(
    transactionId: string,
    amount: string,
    currency: string
  ): Promise<{
    success: boolean;
    captureId: string;
    timestamp: number;
  }> {
    const url = `${this.baseUrl}/capture`;
    const body = JSON.stringify({
      transactionId,
      amount,
      currency,
    });
    
    try {
      // Prepare request
      let request: AuthenticatedRequest = {
        url,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body,
      };
      
      // Apply authentication if configured
      if (this.authenticator) {
        request = await this.authenticator.authenticate(request);
      }
      
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => response.statusText);
        throw new ValidationError(
          `Payment capture failed (${response.status}): ${errorText}`
        );
      }

      const result = await response.json() as any;
      
      if (typeof result.success !== 'boolean' || !result.captureId) {
        throw new ValidationError(
          'Invalid capture response: missing success or captureId'
        );
      }

      return {
        success: result.success as boolean,
        captureId: result.captureId as string,
        timestamp: (result.timestamp as number | undefined) || Date.now(),
      };
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError(
        `Failed to capture payment: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get JWKS for signature verification (with caching)
   * 
   * @returns JWKS remote set
   */
  private async getJWKS(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    const jwksUrl = `${this.baseUrl}/.well-known/jwks.json`;
    const now = Date.now();
    
    // Check cache
    const cached = this.jwksCache.get(jwksUrl);
    if (cached && cached.expiresAt > now) {
      return cached.jwks;
    }
    
    // Create new JWKS remote set
    const jwks = createRemoteJWKSet(new URL(jwksUrl));
    
    // Cache it
    this.jwksCache.set(jwksUrl, {
      jwks,
      expiresAt: now + this.JWKS_CACHE_TTL_MS,
    });
    
    return jwks;
  }
}
