// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { generateDPoPKeyPair } from '../../helpers/dpop';
import { computeJWKThumbprint } from '../../../src/dpop/proof-verification';
import { DPoPError } from '../../../src/types';

describe('DPoP JWK thumbprint', () => {
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

  it('should throw DPoPError for an invalid JWK', async () => {
    await expect(computeJWKThumbprint({ kty: 'EC' })).rejects.toThrow(DPoPError);
  });
});
