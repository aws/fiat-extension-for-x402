/**
 * Mock service signer for testing
 * Simulates service signing behavior
 */

import * as jose from 'jose';
import type { ServiceFABSigner } from '../../src/config';

/**
 * Create a mock service signer for testing
 */
export async function createMockServiceSigner(serviceUrl: string = 'https://api.example.com'): Promise<{
  signer: ServiceFABSigner;
  privateKey: jose.KeyLike;
  publicKey: jose.KeyLike;
}> {
  // Generate test key pair
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  
  const signer: ServiceFABSigner = {
    signQuote: async (payload) => {
      return await new jose.SignJWT(payload as any)
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);
    },
    
    getPublicKey: () => publicKey,
    
    getServiceUrl: () => serviceUrl
  };
  
  return {
    signer,
    privateKey,
    publicKey
  };
}
