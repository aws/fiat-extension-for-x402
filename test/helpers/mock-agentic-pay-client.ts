/**
 * Mock Agentic Pay client for testing
 * Simulates Agent Pay Service behavior without making HTTP calls
 */

import * as jose from 'jose';
import type { AgenticPayClient, CreateAgentPaymentRequest, CreateAgentPaymentResponse } from '../../src/config';

/**
 * Create a mock Agentic Pay client for testing
 * Uses in-memory key pairs to simulate Agent Pay Service signing
 */
export async function createMockAgenticPayClient(agenticPayId: string = 'test-agentic-pay-123'): Promise<{
  agenticPayClient: AgenticPayClient;
  privateKey: jose.KeyLike;
  publicKey: jose.KeyLike;
}> {
  // Generate test key pair (ES384 to match production, but RS256 works for tests)
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  
  // In-memory payment store for idempotency
  const paymentStore = new Map<string, CreateAgentPaymentResponse>();
  let paymentCounter = 0;

  const agenticPayClient: AgenticPayClient = {
    // Client-side: create payment (matches Agent Pay API)
    createPayment: async (request: CreateAgentPaymentRequest): Promise<CreateAgentPaymentResponse> => {
      // Check idempotency
      if (request.clientToken && paymentStore.has(request.clientToken)) {
        return paymentStore.get(request.clientToken)!;
      }

      paymentCounter++;
      const paymentId = `awsmp-00000000-0000-0000-0000-${String(paymentCounter).padStart(12, '0')}`;
      
      // Create payment token (simulating Agent Pay Service signing)
      const now = Math.floor(Date.now() / 1000);
      const paymentTokenPayload: Record<string, unknown> = {
        iss: 'aws-marketplace',
        sub: agenticPayId,
        iat: now,
        exp: now + 3600,
        payment_id: paymentId,
        payment_context: {
          transaction_id: paymentId,
          quote_token: request.quoteToken
        }
      };

      // Add DPoP binding if key provided
      if (request.dpopJwk) {
        const thumbprint = await jose.calculateJwkThumbprint(request.dpopJwk as jose.JWK);
        paymentTokenPayload.cnf = { jkt: thumbprint };
      }
      
      const paymentToken = await new jose.SignJWT(paymentTokenPayload)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);
      
      const response: CreateAgentPaymentResponse = {
        paymentId,
        paymentToken,
        createdAt: new Date().toISOString(),
      };

      // Store for idempotency
      if (request.clientToken) {
        paymentStore.set(request.clientToken, response);
      }

      return response;
    },
    
    // Facilitator-side: verify payment token
    verifyPaymentToken: async (token) => {
      const { payload } = await jose.jwtVerify(token, publicKey);
      
      return {
        iss: payload.iss as string,
        sub: payload.sub as string | undefined,
        aud: payload.aud as string | undefined,
        iat: payload.iat as number,
        exp: payload.exp as number,
        payment_id: (payload.payment_id as string) || '',
        payment_context: payload.payment_context as {
          transaction_id: string;
          quote_token: string;
        } | undefined,
        cnf: payload.cnf as { jkt: string } | undefined,
      };
    },
  };
  
  return {
    agenticPayClient,
    privateKey,
    publicKey
  };
}
