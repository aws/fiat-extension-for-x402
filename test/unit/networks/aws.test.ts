import { describe, it, expect } from 'vitest';
import { FABAWSClientScheme, FABAWSServerScheme, FABAWSFacilitatorScheme } from '../../../src/networks/aws';
import * as jose from 'jose';

describe('AWS Network Schemes', () => {
  describe('FABAWSClientScheme', () => {
    it('should create client scheme with AWS Agentic Pay configuration', () => {
      const scheme = new FABAWSClientScheme({ agenticPayId: 'test-agentic-pay-123' });
      
      expect(scheme).toBeDefined();
      expect(scheme.scheme).toBe('fab');
      // Network is set during initialization, not exposed as property
    });

    it('should accept different Agentic Pay IDs', () => {
      const scheme1 = new FABAWSClientScheme({ agenticPayId: 'agentic-pay-1' });
      const scheme2 = new FABAWSClientScheme({ agenticPayId: 'agentic-pay-2' });
      
      expect(scheme1).toBeDefined();
      expect(scheme2).toBeDefined();
      expect(scheme1.scheme).toBe('fab');
      expect(scheme2.scheme).toBe('fab');
    });

    it('should be instance of base client scheme', () => {
      const scheme = new FABAWSClientScheme({ agenticPayId: 'test' });
      expect(scheme.scheme).toBe('fab');
    });
  });

  describe('FABAWSServerScheme', () => {
    it('should create server scheme with AWS Agentic Pay configuration', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK(publicKey);
      
      const scheme = new FABAWSServerScheme({
        signingKeys: {
          privateKey,
          publicKey: publicJWK,
          alg: 'RS256'
        },
        serviceUrl: 'https://api.example.com'
      });
      
      expect(scheme).toBeDefined();
      expect(scheme.scheme).toBe('fab');
    });

    it('should work with ES256 keys', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
      const publicJWK = await jose.exportJWK(publicKey);
      
      const scheme = new FABAWSServerScheme({
        signingKeys: {
          privateKey,
          publicKey: publicJWK,
          alg: 'ES256'
        },
        serviceUrl: 'https://api.example.com'
      });
      
      expect(scheme).toBeDefined();
      expect(scheme.scheme).toBe('fab');
    });

    it('should accept different service URLs', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK(publicKey);
      
      const scheme1 = new FABAWSServerScheme({
        signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
        serviceUrl: 'https://api1.example.com'
      });
      
      const scheme2 = new FABAWSServerScheme({
        signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
        serviceUrl: 'https://api2.example.com'
      });
      
      expect(scheme1).toBeDefined();
      expect(scheme2).toBeDefined();
    });
  });

  describe('FABAWSFacilitatorScheme', () => {
    it('should create facilitator scheme with default Agentic Pay ID', () => {
      const scheme = new FABAWSFacilitatorScheme();
      
      expect(scheme).toBeDefined();
      expect(scheme.scheme).toBe('fab');
    });

    it('should create facilitator scheme with custom Agentic Pay ID', () => {
      const scheme = new FABAWSFacilitatorScheme('custom-agentic-pay-id');
      
      expect(scheme).toBeDefined();
      expect(scheme.scheme).toBe('fab');
    });

    it('should accept different Agentic Pay IDs', () => {
      const scheme1 = new FABAWSFacilitatorScheme('agentic-pay-1');
      const scheme2 = new FABAWSFacilitatorScheme('agentic-pay-2');
      
      expect(scheme1).toBeDefined();
      expect(scheme2).toBeDefined();
      expect(scheme1.scheme).toBe('fab');
      expect(scheme2.scheme).toBe('fab');
    });
  });
});
