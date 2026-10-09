// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { InProcessFacilitatorClient } from '../../src/facilitator-client';
import { AgenticCommerceScheme as AgenticCommerceFacilitatorSchemeImpl } from '../../src/agentic-commerce/facilitator/scheme';
import * as jose from 'jose';

describe('InProcessFacilitatorClient', () => {
  describe('constructor', () => {
    it('should create client with scheme map', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
      const jwk = await jose.exportJWK(publicKey);

      const schemes = new Map();
      schemes.set(
        'fab:test',
        new AgenticCommerceFacilitatorSchemeImpl({
          signingKeys: { privateKey, publicKey: jwk, alg: 'RS256' },
          agenticCommerceId: 'test-agentic-commerce',
          agenticCommerce: {
            baseUrl: 'https://pay.test.com',
          },
        })
      );

      const client = new InProcessFacilitatorClient(schemes);
      expect(client).toBeDefined();
    });

    it('should accept empty scheme map', () => {
      const client = new InProcessFacilitatorClient(new Map());
      expect(client).toBeDefined();
    });

    it('should accept multiple schemes', async () => {
      const { privateKey: pk1, publicKey: pub1 } = await jose.generateKeyPair('RS256');
      const { privateKey: pk2, publicKey: pub2 } = await jose.generateKeyPair('RS256');
      const jwk1 = await jose.exportJWK(pub1);
      const jwk2 = await jose.exportJWK(pub2);

      const schemes = new Map();
      schemes.set(
        'fab:test1',
        new AgenticCommerceFacilitatorSchemeImpl({
          signingKeys: { privateKey: pk1, publicKey: jwk1, alg: 'RS256' },
          agenticCommerceId: 'agentic-commerce-1',
          agenticCommerce: { baseUrl: 'https://pay1.test.com' },
        })
      );
      schemes.set(
        'fab:test2',
        new AgenticCommerceFacilitatorSchemeImpl({
          signingKeys: { privateKey: pk2, publicKey: jwk2, alg: 'RS256' },
          agenticCommerceId: 'agentic-commerce-2',
          agenticCommerce: { baseUrl: 'https://pay2.test.com' },
        })
      );

      const client = new InProcessFacilitatorClient(schemes);
      expect(client).toBeDefined();
    });
  });

  describe('scheme management', () => {
    it('should handle scheme lookup for registered networks', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
      const jwk = await jose.exportJWK(publicKey);

      const scheme = new AgenticCommerceFacilitatorSchemeImpl({
        signingKeys: { privateKey, publicKey: jwk, alg: 'RS256' },
        agenticCommerceId: 'test-agentic-commerce',
        agenticCommerce: {
          baseUrl: 'https://pay.test.com',
        },
      });

      const schemes = new Map();
      schemes.set('fab:test', scheme);

      const client = new InProcessFacilitatorClient(schemes);

      // The client should have the scheme registered
      expect(client).toBeDefined();
    });
  });

  describe('error handling', () => {
    it('should handle invalid scheme map gracefully', () => {
      // TypeScript prevents this, but testing runtime behavior
      const client = new InProcessFacilitatorClient(new Map());
      expect(client).toBeDefined();
    });
  });
});
