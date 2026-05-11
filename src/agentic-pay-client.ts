/**
 * Default Agentic Pay client implementation
 * Handles HTTP communication with the AWS Marketplace Agent Pay Service
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import type {
  AgenticPayClient,
  AgenticPayConfig,
  CreateAgentPaymentRequest,
  CreateAgentPaymentResponse,
  GetAgentPaymentResponse,
  ListAgentPaymentsRequest,
  ListAgentPaymentsResponse,
} from './config';
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
 * Communicates with the AWS Marketplace Agent Pay Service API
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
   * Create a payment with the Agent Pay Service.
   * Sends the seller-signed quote token; Agent Pay verifies, captures,
   * and returns a signed payment JWT.
   * 
   * Maps to: POST /CreateAgentPayment
   */
  async createPayment(request: CreateAgentPaymentRequest): Promise<CreateAgentPaymentResponse> {
    const url = `${this.baseUrl}/CreateAgentPayment`;
    const body = JSON.stringify({
      quoteToken: request.quoteToken,
      ...(request.clientToken && { clientToken: request.clientToken }),
      ...(request.dpopJwk && { dpopJwk: request.dpopJwk }),
    });
    
    try {
      let httpRequest: AuthenticatedRequest = {
        url,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      };
      
      if (this.authenticator) {
        httpRequest = await this.authenticator.authenticate(httpRequest);
      }
      
      const response = await fetch(httpRequest.url, {
        method: httpRequest.method,
        headers: httpRequest.headers,
        body: httpRequest.body,
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => ({ message: response.statusText })) as Record<string, unknown>;
        const message = (errorBody.message as string) || response.statusText;
        throw new ValidationError(
          `Agentic Pay authorization failed (${response.status}): ${message}`
        );
      }

      const result = await response.json() as CreateAgentPaymentResponse;
      
      if (!result.paymentId || !result.paymentToken) {
        throw new ValidationError(
          'Invalid Agentic Pay response: missing paymentId or paymentToken'
        );
      }

      return result;
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
   * Get full payment detail by ID.
   * 
   * Maps to: GET /GetAgentPayment/{paymentId}
   */
  async getPayment(paymentId: string): Promise<GetAgentPaymentResponse> {
    const url = `${this.baseUrl}/GetAgentPayment/${paymentId}`;
    
    let httpRequest: AuthenticatedRequest = {
      url,
      method: 'GET',
      headers: {},
    };
    
    if (this.authenticator) {
      httpRequest = await this.authenticator.authenticate(httpRequest);
    }
    
    const response = await fetch(httpRequest.url, {
      method: httpRequest.method,
      headers: httpRequest.headers,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: response.statusText })) as Record<string, unknown>;
      throw new ValidationError(
        `Failed to get payment (${response.status}): ${(errorBody.message as string) || response.statusText}`
      );
    }

    return await response.json() as GetAgentPaymentResponse;
  }

  /**
   * List payments for the caller's account.
   * 
   * Maps to: POST /ListAgentPayments
   */
  async listPayments(request?: ListAgentPaymentsRequest): Promise<ListAgentPaymentsResponse> {
    const url = `${this.baseUrl}/ListAgentPayments`;
    const body = JSON.stringify(request || {});
    
    let httpRequest: AuthenticatedRequest = {
      url,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    };
    
    if (this.authenticator) {
      httpRequest = await this.authenticator.authenticate(httpRequest);
    }
    
    const response = await fetch(httpRequest.url, {
      method: httpRequest.method,
      headers: httpRequest.headers,
      body: httpRequest.body,
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ message: response.statusText })) as Record<string, unknown>;
      throw new ValidationError(
        `Failed to list payments (${response.status}): ${(errorBody.message as string) || response.statusText}`
      );
    }

    return await response.json() as ListAgentPaymentsResponse;
  }

  /**
   * Verify a payment token's signature.
   * Fetches Agentic Pay's public keys from JWKS endpoint and verifies JWT.
   * 
   * @param token - Payment token JWT to verify
   * @returns Decoded and verified payment token payload
   */
  async verifyPaymentToken(token: string): Promise<{
    iss: string;
    sub?: string;
    aud?: string;
    iat: number;
    exp: number;
    payment_id: string;
    payment_context?: {
      transaction_id: string;
      quote_token: string;
    };
    cnf?: {
      jkt: string;
    };
  }> {
    try {
      const jwks = await this.getJWKS();
      const { payload } = await jwtVerify(token, jwks);
      
      if (!payload.iss || !payload.iat || !payload.exp) {
        throw new ValidationError('Invalid payment token: missing required fields');
      }

      // Agent Pay uses payment_id at top level
      const paymentId = (payload.payment_id as string) ||
        (payload.payment_context as any)?.transaction_id || '';

      return {
        iss: payload.iss as string,
        sub: payload.sub as string | undefined,
        aud: payload.aud as string | undefined,
        iat: payload.iat as number,
        exp: payload.exp as number,
        payment_id: paymentId,
        payment_context: payload.payment_context as any,
        cnf: payload.cnf as any,
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
   * Get JWKS for signature verification (with caching)
   */
  private async getJWKS(): Promise<ReturnType<typeof createRemoteJWKSet>> {
    const jwksUrl = `${this.baseUrl}/.well-known/jwks.json`;
    const now = Date.now();
    
    const cached = this.jwksCache.get(jwksUrl);
    if (cached && cached.expiresAt > now) {
      return cached.jwks;
    }
    
    const jwks = createRemoteJWKSet(new URL(jwksUrl));
    this.jwksCache.set(jwksUrl, {
      jwks,
      expiresAt: now + this.JWKS_CACHE_TTL_MS,
    });
    
    return jwks;
  }
}
