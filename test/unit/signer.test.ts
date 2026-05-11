import { describe, it, expect, beforeEach } from 'vitest';
import * as jose from 'jose';
import { toServiceFABSigner, toAgenticPayFABSigner } from '../../src/signer';
import type { ServiceFABSigner, AgenticPayFABSigner } from '../../src/signer';
import type { QuoteTokenPayload, PaymentTokenPayload } from '../../src/types';

describe('FAB Signers', () => {
  describe('ServiceFABSigner', () => {
    let privateKey: jose.KeyLike;
    let publicKey: jose.KeyLike;
    let signer: ServiceFABSigner;

    beforeEach(async () => {
      // Generate test key pair
      const { privateKey: priv, publicKey: pub } = await jose.generateKeyPair('RS256');
      privateKey = priv;
      publicKey = pub;

      // Create mock signer
      signer = {
        signQuote: async (payload: QuoteTokenPayload) => {
          return await new jose.SignJWT(payload as any)
            .setProtectedHeader({ alg: 'RS256' })
            .sign(privateKey);
        },
        getPublicKey: () => publicKey,
        getServiceUrl: () => 'https://api.example.com'
      };
    });

    it('should sign quote tokens', async () => {
      const payload: QuoteTokenPayload = {
        iss: 'https://api.example.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_123',
        price: { amount: '1.50', currency: 'USD' },
        payTo: 'agentic-pay-test',
        capture: 'manual',
        reference: 'TEST'
      };

      const token = await signer.signQuote(payload);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format
      
      // Verify the token can be decoded
      const decoded = jose.decodeJwt(token);
      expect(decoded.iss).toBe(payload.iss);
      expect(decoded.jti).toBe(payload.jti);
    });

    it('should return service URL', () => {
      const url = signer.getServiceUrl();
      expect(url).toBe('https://api.example.com');
      expect(url).toMatch(/^https?:\/\//);
    });

    it('should return public key', () => {
      const key = signer.getPublicKey();
      expect(key).toBeDefined();
      expect(key).toBe(publicKey);
    });
  });

  describe('AgenticPayFABSigner', () => {
    let privateKey: jose.KeyLike;
    let publicKey: jose.KeyLike;
    let signer: AgenticPayFABSigner;

    beforeEach(async () => {
      // Generate test key pair
      const { privateKey: priv, publicKey: pub } = await jose.generateKeyPair('RS256');
      privateKey = priv;
      publicKey = pub;

      // Create mock signer
      signer = {
        signPayment: async (payload: PaymentTokenPayload) => {
          return await new jose.SignJWT(payload as any)
            .setProtectedHeader({ alg: 'RS256' })
            .sign(privateKey);
        },
        getPublicKey: () => publicKey,
        getAddresses: () => ['agentic-pay-test-123']
      };
    });

    it('should sign payment tokens', async () => {
      const payload: PaymentTokenPayload = {
        iss: 'agentic-pay-test-123',
        sub: 'client-456',
        aud: 'https://api.example.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: 'fab:test:txn_789',
          quote_token: 'eyJhbGc...'
        }
      };

      const token = await signer.signPayment(payload);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.split('.')).toHaveLength(3); // JWT format
      
      // Verify the token can be decoded
      const decoded = jose.decodeJwt(token);
      expect(decoded.iss).toBe(payload.iss);
      expect(decoded.sub).toBe(payload.sub);
    });

    it('should return Agentic Pay addresses', () => {
      const addresses = signer.getAddresses();
      expect(addresses).toBeDefined();
      expect(Array.isArray(addresses)).toBe(true);
      expect(addresses).toHaveLength(1);
      expect(addresses[0]).toBe('agentic-pay-test-123');
    });

    it('should return public key', () => {
      const key = signer.getPublicKey();
      expect(key).toBeDefined();
      expect(key).toBe(publicKey);
    });
  });

  describe('toServiceFABSigner adapter', () => {
    it('should create a ServiceFABSigner from jose keys', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK(publicKey);
      
      const signer = toServiceFABSigner(privateKey, publicJWK, 'https://api.test.com');
      
      expect(signer).toBeDefined();
      expect(signer.getServiceUrl()).toBe('https://api.test.com');
      expect(signer.getPublicKey()).toEqual(publicJWK);
    });

    it('should sign quote tokens correctly', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK(publicKey);
      
      const signer = toServiceFABSigner(privateKey, publicJWK, 'https://api.test.com');
      
      const payload: QuoteTokenPayload = {
        iss: 'https://api.test.com',
        aud: 'fab:test',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'quote_test',
        price: { amount: '5.00', currency: 'USD' },
        payTo: 'agentic-pay-id',
        capture: 'auto'
      };
      
      const token = await signer.signQuote(payload);
      
      // Verify token can be verified with public key
      const { payload: verified } = await jose.jwtVerify(token, publicKey);
      expect(verified.jti).toBe('quote_test');
    });
  });

  describe('toAgenticPayFABSigner adapter', () => {
    it('should create a AgenticPayFABSigner from jose keys', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK(publicKey);
      
      const signer = toAgenticPayFABSigner(privateKey, publicJWK, 'agentic-pay-provider-123');
      
      expect(signer).toBeDefined();
      expect(signer.getAddresses()).toEqual(['agentic-pay-provider-123']);
      expect(signer.getPublicKey()).toEqual(publicJWK);
    });

    it('should sign payment tokens correctly', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK(publicKey);
      
      const signer = toAgenticPayFABSigner(privateKey, publicJWK, 'agentic-pay-test');
      
      const payload: PaymentTokenPayload = {
        iss: 'agentic-pay-test',
        sub: 'client-789',
        aud: 'https://api.test.com',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        payment_context: {
          transaction_id: 'fab:test:txn_abc',
          quote_token: 'eyJhbGc...'
        }
      };
      
      const token = await signer.signPayment(payload);
      
      // Verify token can be verified with public key
      const { payload: verified } = await jose.jwtVerify(token, publicKey);
      expect(verified.sub).toBe('client-789');
    });

    it('should return Agentic Pay ID in addresses array', async () => {
      const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
      const publicJWK = await jose.exportJWK(publicKey);
      
      const signer = toAgenticPayFABSigner(privateKey, publicJWK, 'my-agentic-pay-id');
      
      const addresses = signer.getAddresses();
      expect(addresses).toHaveLength(1);
      expect(addresses[0]).toBe('my-agentic-pay-id');
    });
  });
});
