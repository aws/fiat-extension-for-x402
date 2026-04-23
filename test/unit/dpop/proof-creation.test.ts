import { describe, it, expect } from 'vitest';
import { generateDPoPKeyPair } from '../../../src/dpop/key-generation';
import { createDPoPProof, computeJWKThumbprint } from '../../../src/dpop/proof-creation';
import { DPoPError, DPoPProofPayload } from '../../../src/types';
import * as jose from 'jose';
import * as crypto from 'crypto';

describe('DPoP Proof Creation', () => {
  describe('computeJWKThumbprint', () => {
    it('should compute thumbprint for EC key', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const thumbprint = await computeJWKThumbprint(keyPair.publicKey);

      expect(thumbprint).toBeDefined();
      expect(typeof thumbprint).toBe('string');
      expect(thumbprint.length).toBeGreaterThan(0);
    });

    it('should compute thumbprint for RSA key', async () => {
      const keyPair = await generateDPoPKeyPair('RS256');
      const thumbprint = await computeJWKThumbprint(keyPair.publicKey);

      expect(thumbprint).toBeDefined();
      expect(typeof thumbprint).toBe('string');
    });

    it('should compute same thumbprint for same key', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const thumbprint1 = await computeJWKThumbprint(keyPair.publicKey);
      const thumbprint2 = await computeJWKThumbprint(keyPair.publicKey);

      expect(thumbprint1).toBe(thumbprint2);
    });

    it('should compute different thumbprints for different keys', async () => {
      const keyPair1 = await generateDPoPKeyPair('ES256');
      const keyPair2 = await generateDPoPKeyPair('ES256');
      
      const thumbprint1 = await computeJWKThumbprint(keyPair1.publicKey);
      const thumbprint2 = await computeJWKThumbprint(keyPair2.publicKey);

      expect(thumbprint1).not.toBe(thumbprint2);
    });
  });

  describe('createDPoPProof', () => {
    it('should create valid DPoP proof', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      expect(proof).toBeDefined();
      expect(typeof proof).toBe('string');
      
      // Decode and verify structure
      const header = jose.decodeProtectedHeader(proof);
      expect(header.typ).toBe('dpop+jwt');
      expect(header.alg).toBe('ES256');
      expect(header.jwk).toBeDefined();

      const payload = jose.decodeJwt(proof) as DPoPProofPayload;
      expect(payload.jti).toBeDefined();
      expect(payload.htm).toBe('GET');
      expect(payload.htu).toBe('https://api.example.com/resource');
      expect(payload.iat).toBeDefined();
    });

    it('should create proof with access token hash', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const accessToken = 'test-access-token';
      
      const proof = await createDPoPProof(keyPair, {
        method: 'POST',
        url: 'https://api.example.com/resource',
        accessToken,
      });

      const payload = jose.decodeJwt(proof) as DPoPProofPayload;
      expect(payload.ath).toBeDefined();
      
      // Verify hash is correct
      const expectedHash = jose.base64url.encode(
        crypto.createHash('sha256').update(accessToken).digest()
      );
      expect(payload.ath).toBe(expectedHash);
    });

    it('should create proof with nonce', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      const nonce = 'test-nonce-123';
      
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
        nonce,
      });

      const payload = jose.decodeJwt(proof) as any;
      expect(payload.nonce).toBe(nonce);
    });

    it('should normalize HTTP method to uppercase', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      
      const proof = await createDPoPProof(keyPair, {
        method: 'get',
        url: 'https://api.example.com/resource',
      });

      const payload = jose.decodeJwt(proof) as DPoPProofPayload;
      expect(payload.htm).toBe('GET');
    });

    it('should generate unique jti for each proof', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      
      const proof1 = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });
      
      const proof2 = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      const payload1 = jose.decodeJwt(proof1) as DPoPProofPayload;
      const payload2 = jose.decodeJwt(proof2) as DPoPProofPayload;
      
      expect(payload1.jti).not.toBe(payload2.jti);
    });

    it('should create verifiable proof', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      // Verify signature
      const header = jose.decodeProtectedHeader(proof);
      const publicKey = await jose.importJWK(header.jwk!, 'ES256');
      
      await expect(
        jose.jwtVerify(proof, publicKey, { typ: 'dpop+jwt' })
      ).resolves.toBeDefined();
    });

    it('should throw error if method is missing', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      
      await expect(
        createDPoPProof(keyPair, {
          method: '',
          url: 'https://api.example.com/resource',
        })
      ).rejects.toThrow(DPoPError);
    });

    it('should throw error if url is missing', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');
      
      await expect(
        createDPoPProof(keyPair, {
          method: 'GET',
          url: '',
        })
      ).rejects.toThrow(DPoPError);
    });

    it('should work with RS256 keys', async () => {
      const keyPair = await generateDPoPKeyPair('RS256');
      
      const proof = await createDPoPProof(keyPair, {
        method: 'GET',
        url: 'https://api.example.com/resource',
      });

      const header = jose.decodeProtectedHeader(proof);
      expect(header.alg).toBe('RS256');
    });
  });
});
