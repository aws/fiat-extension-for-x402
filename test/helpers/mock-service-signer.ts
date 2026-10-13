// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Mock service signer for testing
 * Simulates service signing behavior
 */

import * as jose from 'jose';
import type { QuoteSigner } from '../../src/signers/protocol';

/**
 * Create a mock service signer for testing
 */
export async function createMockServiceSigner(
  serviceUrl: string = 'https://api.example.com'
): Promise<{
  signer: QuoteSigner;
  privateKey: jose.KeyLike;
  publicKey: jose.KeyLike;
}> {
  // Generate test key pair
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');

  const signer: QuoteSigner = {
    signQuote: async (payload) => {
      return await new jose.SignJWT({ ...payload })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);
    },

    getServiceUrl: () => serviceUrl,
  };

  return {
    signer,
    privateKey,
    publicKey,
  };
}
