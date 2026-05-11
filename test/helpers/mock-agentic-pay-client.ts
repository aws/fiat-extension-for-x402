/**
 * Mock Agentic Pay client for testing
 * Simulates Agentic Pay provider behavior without making HTTP calls
 */

import * as jose from 'jose';
import type { AgenticPayClient } from '../../src/config';
import { generateTransactionId } from '../../src/utils';

/**
 * Create a mock Agentic Pay client for testing
 * Uses in-memory key pairs to simulate Agentic Pay provider signing
 */
export async function createMockAgenticPayClient(agenticPayId: string = 'test-agentic-pay-123'): Promise<{
  agenticPayClient: AgenticPayClient;
  privateKey: jose.KeyLike;
  publicKey: jose.KeyLike;
}> {
  // Generate test key pair
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  
  const agenticPayClient: AgenticPayClient = {
    // Client-side: authorize payment
    authorize: async (payload) => {
      const transactionId = generateTransactionId(payload.network, agenticPayId);
      
      // Create payment token (simulating Agentic Pay provider signing)
      const now = Math.floor(Date.now() / 1000);
      const paymentTokenPayload = {
        iss: agenticPayId,
        sub: agenticPayId,
        aud: payload.payTo,
        iat: now,
        exp: now + 300,
        payment_context: {
          transaction_id: transactionId,
          quote_token: payload.quoteToken
        }
      };
      
      const paymentToken = await new jose.SignJWT(paymentTokenPayload as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);
      
      return {
        transactionId,
        paymentToken
      };
    },
    
    // Facilitator-side: verify payment token
    verifyPaymentToken: async (token) => {
      const { payload } = await jose.jwtVerify(token, publicKey);
      
      return {
        iss: payload.iss as string,
        sub: payload.sub as string,
        aud: payload.aud as string,
        iat: payload.iat as number,
        exp: payload.exp as number,
        payment_context: payload.payment_context as {
          transaction_id: string;
          quote_token: string;
        }
      };
    },
    
    // Facilitator-side: capture payment
    capturePayment: async (transactionId, amount, currency) => {
      return {
        success: true,
        captureId: `capture_${transactionId}`,
        timestamp: Date.now()
      };
    }
  };
  
  return {
    agenticPayClient,
    privateKey,
    publicKey
  };
}
