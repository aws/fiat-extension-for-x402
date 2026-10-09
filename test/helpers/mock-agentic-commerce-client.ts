// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Mock Agentic Commerce client for testing
 * Simulates Agentic Commerce Service behavior without making HTTP calls
 */

import * as jose from 'jose';
import type { AgenticCommerceClientForFacilitator } from '../../src/config';

/** Payment creation request body, as the Agentic Commerce Service accepts it */
export interface CreatePaymentRequest {
  quoteToken: string;
  clientToken?: string;
  dpopJwk?: { kty: 'EC'; crv: 'P-256' | 'P-384' | 'P-521'; x: string; y: string };
}

/** Payment creation response body */
export interface CreatePaymentResponse {
  paymentId: string;
  paymentToken: string;
  createdAt: string;
}

/** The fake service: creates payments (buyer side) and verifies their tokens (facilitator side) */
export interface MockAgenticCommerceClient extends AgenticCommerceClientForFacilitator {
  createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResponse>;
}

/**
 * Create a mock Agentic Commerce client for testing
 * Uses in-memory key pairs to simulate Agentic Commerce Service signing
 */
export async function createMockAgenticCommerceClient(
  agenticCommerceId: string = 'test-agentic-commerce-123'
): Promise<{
  agenticCommerceClient: MockAgenticCommerceClient;
  privateKey: jose.KeyLike;
  publicKey: jose.KeyLike;
}> {
  // Generate test key pair (ES384 to match production, but RS256 works for tests)
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');

  // In-memory payment store for idempotency
  const paymentStore = new Map<string, CreatePaymentResponse>();
  let paymentCounter = 0;

  const agenticCommerceClient: MockAgenticCommerceClient = {
    // Client-side: create payment (matches Agentic Commerce API)
    createPayment: async (request: CreatePaymentRequest): Promise<CreatePaymentResponse> => {
      // Check idempotency
      if (request.clientToken && paymentStore.has(request.clientToken)) {
        return paymentStore.get(request.clientToken)!;
      }

      paymentCounter++;
      const paymentId = `awsmp-00000000-0000-0000-0000-${String(paymentCounter).padStart(12, '0')}`;

      // Create payment token (simulating Agentic Commerce Service signing)
      const now = Math.floor(Date.now() / 1000);
      const paymentTokenPayload: Record<string, unknown> = {
        iss: 'awsmp-agentpay.amazonaws.com',
        sub: agenticCommerceId,
        iat: now,
        exp: now + 3600,
        payment_id: paymentId,
        payment_context: {
          transaction_id: paymentId,
          quote_token: request.quoteToken,
        },
      };

      // Add DPoP binding if key provided
      if (request.dpopJwk) {
        const thumbprint = await jose.calculateJwkThumbprint(request.dpopJwk as jose.JWK);
        paymentTokenPayload.cnf = { jkt: thumbprint };
      }

      const paymentToken = await new jose.SignJWT(paymentTokenPayload)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const response: CreatePaymentResponse = {
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
        payment_context: payload.payment_context as
          | {
              transaction_id: string;
              quote_token: string;
            }
          | undefined,
        cnf: payload.cnf as { jkt: string } | undefined,
      };
    },
  };

  return {
    agenticCommerceClient,
    privateKey,
    publicKey,
  };
}
