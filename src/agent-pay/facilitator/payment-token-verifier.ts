// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Payment token verifier for the Agent Pay facilitator scheme
 *
 * Verifies payment token signatures against the Agent Pay provider's JWKS.
 */

import { createRemoteJWKSet, jwtVerify } from 'jose';
import { WELL_KNOWN_JWKS_PATH } from '../../constants';
import type { AgentPayClientForFacilitator, AgentPayConfig } from '../../config';
import { ValidationError } from '../../types';
import { ALLOWED_ALGORITHMS } from '../../security';

/**
 * Verifies payment tokens with the keys published at
 * `${baseUrl}/.well-known/jwks.json`.
 */
export class JwksPaymentTokenVerifier implements AgentPayClientForFacilitator {
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  /**
   * Create a new payment token verifier
   *
   * @param config - Agent Pay configuration with baseUrl
   */
  constructor(config: AgentPayConfig) {
    const baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
    // jose's RemoteJWKSet refetches on a kid miss and coalesces concurrent requests.
    this.jwks = createRemoteJWKSet(new URL(`${baseUrl}${WELL_KNOWN_JWKS_PATH}`));
  }

  /**
   * Verify a payment token's signature.
   * Fetches Agent Pay's public keys from JWKS endpoint and verifies JWT.
   *
   * @param token - Payment token JWT to verify
   * @returns Decoded and verified payment token payload
   */
  async verifyPaymentToken(
    token: string
  ): ReturnType<AgentPayClientForFacilitator['verifyPaymentToken']> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        algorithms: ALLOWED_ALGORITHMS,
      });

      if (!payload.iss || !payload.iat || !payload.exp) {
        throw new ValidationError('Invalid payment token: missing required fields');
      }

      // Agent Pay uses payment_id at top level
      const paymentId =
        (payload.payment_id as string) || (payload.payment_context as any)?.transaction_id || '';

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
}
