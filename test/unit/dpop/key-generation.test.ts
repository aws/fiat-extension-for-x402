// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { generateDPoPKeyPair } from '../../../src/dpop/key-generation';
import { DPoPError } from '../../../src/types';
import * as jose from 'jose';

describe('DPoP Key Generation', () => {
  describe('generateDPoPKeyPair', () => {
    it('should generate ES256 key pair by default', async () => {
      const keyPair = await generateDPoPKeyPair();

      expect(keyPair).toBeDefined();
      expect(keyPair.privateKey).toBeDefined();
      expect(keyPair.publicKey).toBeDefined();
      expect(keyPair.publicKey.kty).toBe('EC');
      expect(keyPair.publicKey.crv).toBe('P-256');
      expect(keyPair.publicKey.alg).toBe('ES256');
      expect(keyPair.publicKey.use).toBe('sig');
    });

    it('should generate ES256 key pair explicitly', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');

      expect(keyPair.publicKey.kty).toBe('EC');
      expect(keyPair.publicKey.crv).toBe('P-256');
      expect(keyPair.publicKey.alg).toBe('ES256');
    });

    it('should generate RS256 key pair', async () => {
      const keyPair = await generateDPoPKeyPair('RS256');

      expect(keyPair.publicKey.kty).toBe('RSA');
      expect(keyPair.publicKey.alg).toBe('RS256');
      expect(keyPair.publicKey.use).toBe('sig');
    });

    it('should generate unique key pairs', async () => {
      const keyPair1 = await generateDPoPKeyPair('ES256');
      const keyPair2 = await generateDPoPKeyPair('ES256');

      // Public keys should be different
      expect(keyPair1.publicKey.x).not.toBe(keyPair2.publicKey.x);
      expect(keyPair1.publicKey.y).not.toBe(keyPair2.publicKey.y);
    });

    it('should generate keys that can sign and verify', async () => {
      const keyPair = await generateDPoPKeyPair('ES256');

      // Create a test JWT
      const jwt = await new jose.SignJWT({ test: 'data' })
        .setProtectedHeader({ alg: 'ES256' })
        .sign(keyPair.privateKey);

      // Verify with public key
      const publicKey = await jose.importJWK(keyPair.publicKey, 'ES256');
      const { payload } = await jose.jwtVerify(jwt, publicKey);

      expect(payload.test).toBe('data');
    });

    it('should throw error for unsupported algorithm', async () => {
      await expect(
        generateDPoPKeyPair('PS256' as any)
      ).rejects.toThrow(DPoPError);
    });
  });
});
