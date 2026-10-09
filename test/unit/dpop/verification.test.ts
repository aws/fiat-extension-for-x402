// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, vi } from 'vitest';
import { generateDPoPKeyPair, createDPoPProof } from '../../helpers/dpop';
import { verifyDPoPProof, extractDPoPThumbprint } from '../../../src/dpop/verification';
import { DPoPError, DPoPNonceStore } from '../../../src/types';

// Simple in-memory nonce store for testing
class InMemoryNonceStore implements DPoPNonceStore {
  private nonces = new Set<string>();

  async has(jti: string): Promise<boolean> {
    return this.nonces.has(jti);
  }

  async add(jti: string, expiresAt: number): Promise<void> {
    this.nonces.add(jti);
  }

  clear() {
    this.nonces.clear();
  }
}

describe('DPoP Proof Verification', () => {
  describe('verifyDPoPProof', () => {
    it('should verify valid DPoP proof', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      const payload = await verifyDPoPProof(proof, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      expect(payload).toBeDefined();
      expect(payload.htm).toBe('GET');
      expect(payload.htu).toBe('https://api.example.com/resource');
    });

    it('should verify proof with access token', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const accessToken = 'test-token-123';

      const proof = await createDPoPProof(keyPair, {
        method: 'POST',
        url: 'https://api.example.com/resource',
        accessToken,
      });

      const payload = await verifyDPoPProof(proof, {
        method: 'POST',
        url: 'https://api.example.com/resource',
        accessToken,
      });

      expect(payload.ath).toBeDefined();
    });

    it('should reject proof with wrong HTTP method', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      await expect(
        verifyDPoPProof(proof, {
          method: 'POST',
          url: 'https://api.example.com/resource',
        })
      ).rejects.toThrow(DPoPError);
    });

    it('should reject proof with wrong URL', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      await expect(
        verifyDPoPProof(proof, {
          method: 'GET',
          url: 'https://api.example.com/different',
        })
      ).rejects.toThrow(DPoPError);
    });

    it('should reject proof with wrong access token', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
        accessToken: 'token-1',
      });

      await expect(
        verifyDPoPProof(proof, {
          method: 'GET',
          url: 'https://api.example.com/resource',
          accessToken: 'token-2',
        })
      ).rejects.toThrow(DPoPError);
    });

    it('should reject a proof older than maxAge plus 5 seconds of clock skew', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });
      const iat = Math.floor(Date.now() / 1000);
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        vi.setSystemTime((iat + 6) * 1000);
        const options = { method: 'GET', url: 'https://api.example.com/resource', maxAge: 1 };
        await expect(verifyDPoPProof(proof, options)).resolves.toBeDefined();
        vi.setSystemTime((iat + 7) * 1000);
        await expect(verifyDPoPProof(proof, options)).rejects.toThrow('DPoP proof expired');
      } finally {
        vi.useRealTimers();
      }
    });

    it('should accept fresh proof within maxAge', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      const payload = await verifyDPoPProof(proof, {
        method: 'GET',
        url: 'https://api.example.com/resource',
        maxAge: 60,
      });

      expect(payload).toBeDefined();
    });

    it('should detect replay attacks with nonce store', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const nonceStore = new InMemoryNonceStore();

      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      // First verification should succeed
      await verifyDPoPProof(proof, {
        method: 'GET',
        url: 'https://api.example.com/resource',
        nonceStore,
      });

      // Second verification with same proof should fail
      await expect(
        verifyDPoPProof(proof, {
          method: 'GET',
          url: 'https://api.example.com/resource',
          nonceStore,
        })
      ).rejects.toThrow(DPoPError);
    });

    it('should allow different proofs with nonce store', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const nonceStore = new InMemoryNonceStore();

      const proof1 = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      const proof2 = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      // Both should succeed (different jti)
      await verifyDPoPProof(proof1, {
        method: 'GET',
        url: 'https://api.example.com/resource',
        nonceStore,
      });

      await verifyDPoPProof(proof2, {
        method: 'GET',
        url: 'https://api.example.com/resource',
        nonceStore,
      });
    });

    it('should reject proof with invalid signature', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      // Tamper with the proof
      const parts = proof.split('.');
      parts[2] = parts[2].slice(0, -5) + 'xxxxx';
      const tamperedProof = parts.join('.');

      await expect(
        verifyDPoPProof(tamperedProof, {
          method: 'GET',
          url: 'https://api.example.com/resource',
        })
      ).rejects.toThrow(DPoPError);
    });

    it('should work with RS256 keys', async () => {
      const keyPair = await generateDPoPKeyPair('RS256');
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      const payload = await verifyDPoPProof(proof, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      expect(payload).toBeDefined();
    });

    it('should normalize method case in verification', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const proof = await createDPoPProof(keyPair, {
        method: 'get',
        url: 'https://api.example.com/resource',
      });

      // Verify with uppercase
      const payload = await verifyDPoPProof(proof, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      expect(payload).toBeDefined();
    });
  });

  describe('extractDPoPThumbprint', () => {
    it('should extract thumbprint from proof', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      const thumbprint = await extractDPoPThumbprint(proof);

      expect(thumbprint).toBeDefined();
      expect(typeof thumbprint).toBe('string');
      expect(thumbprint.length).toBeGreaterThan(0);
    });

    it('should extract same thumbprint as direct computation', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      const thumbprintFromProof = await extractDPoPThumbprint(proof);

      // Compute directly from public key
      const jose = await import('jose');
      const thumbprintDirect = await jose.calculateJwkThumbprint(keyPair.publicKey, 'sha256');

      expect(thumbprintFromProof).toBe(thumbprintDirect);
    });
  });
});
