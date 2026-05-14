/**
 * Zod Schema Validation Tests (Task 43)
 */

import { describe, it, expect } from 'vitest';
import * as jose from 'jose';
import {
  QuoteTokenPayloadSchema,
  QuoteTokenPriceSchema,
  AgentPaySettlementSchema,
  AgentPaySupportSchema,
  AgentPayTermsSchema,
  AgentPayPaymentExtraSchema,
  AgentPayPayloadV2Schema,
  DpopJwkSchema,
  CreateAgentPaymentRequestSchema,
  CreateAgentPaymentResponseSchema,
  parseQuoteToken,
  safeParseQuoteToken,
  parsePaymentPayload,
  parseCreatePaymentResponse,
} from '../../src/schemas';

describe('Zod Schemas', () => {
  describe('QuoteTokenPriceSchema', () => {
    it('should accept valid price', () => {
      expect(QuoteTokenPriceSchema.parse({ amount: '0.15', currency: 'USD' })).toEqual({ amount: '0.15', currency: 'USD' });
    });

    it('should reject non-decimal amount', () => {
      expect(() => QuoteTokenPriceSchema.parse({ amount: 'abc', currency: 'USD' })).toThrow();
    });

    it('should reject invalid currency length', () => {
      expect(() => QuoteTokenPriceSchema.parse({ amount: '1.00', currency: 'US' })).toThrow();
      expect(() => QuoteTokenPriceSchema.parse({ amount: '1.00', currency: 'USDD' })).toThrow();
    });
  });

  describe('AgentPaySettlementSchema', () => {
    it('should accept valid settlement', () => {
      expect(AgentPaySettlementSchema.parse({ method: 'INST' })).toEqual({ method: 'INST' });
      expect(AgentPaySettlementSchema.parse({ method: 'CLRG', cycle: 'MNTH' })).toEqual({ method: 'CLRG', cycle: 'MNTH' });
    });

    it('should reject invalid method', () => {
      expect(() => AgentPaySettlementSchema.parse({ method: 'INVALID' })).toThrow();
    });
  });

  describe('AgentPaySupportSchema', () => {
    it('should accept valid support', () => {
      const result = AgentPaySupportSchema.parse({ uri: 'https://support.example.com', method: 'human' });
      expect(result.method).toBe('human');
    });

    it('should reject invalid URI', () => {
      expect(() => AgentPaySupportSchema.parse({ uri: 'not-a-url', method: 'human' })).toThrow();
    });

    it('should reject invalid method', () => {
      expect(() => AgentPaySupportSchema.parse({ uri: 'https://x.com', method: 'bot' })).toThrow();
    });
  });

  describe('AgentPayTermsSchema', () => {
    it('should accept valid terms', () => {
      const result = AgentPayTermsSchema.parse({ description: 'TOS', uri: 'https://example.com/tos' });
      expect(result.description).toBe('TOS');
    });

    it('should reject empty description', () => {
      expect(() => AgentPayTermsSchema.parse({ description: '', uri: 'https://x.com' })).toThrow();
    });
  });

  describe('QuoteTokenPayloadSchema', () => {
    const validPayload = {
      iss: 'https://api.example.com',
      aud: 'aws-marketplace',
      iat: 1700000000,
      exp: 1700000300,
      jti: 'quote-001',
      price: { amount: '0.15', currency: 'USD' },
      payTo: 'seller-123',
      reference: 'API_ACCESS',
    };

    it('should accept valid payload', () => {
      const result = QuoteTokenPayloadSchema.parse(validPayload);
      expect(result.iss).toBe('https://api.example.com');
      expect(result.payTo).toBe('seller-123');
    });

    it('should accept payload with optional fields', () => {
      const result = QuoteTokenPayloadSchema.parse({
        ...validPayload,
        description: 'Premium API access',
        dimensions: { tokens: 1500, model: 'claude-4' },
        settlement: { method: 'INST' },
        support: { uri: 'https://support.example.com', method: 'agent' },
        terms: [{ description: 'TOS', uri: 'https://example.com/tos' }],
      });
      expect(result.description).toBe('Premium API access');
      expect(result.dimensions).toEqual({ tokens: 1500, model: 'claude-4' });
    });

    it('should accept array of prices', () => {
      const result = QuoteTokenPayloadSchema.parse({
        ...validPayload,
        price: [{ amount: '0.15', currency: 'USD' }, { amount: '0.13', currency: 'EUR' }],
      });
      expect(Array.isArray(result.price)).toBe(true);
    });

    it('should accept array aud', () => {
      const result = QuoteTokenPayloadSchema.parse({ ...validPayload, aud: ['aws:base', 'other:net'] });
      expect(result.aud).toEqual(['aws:base', 'other:net']);
    });

    it('should reject missing required fields', () => {
      expect(() => QuoteTokenPayloadSchema.parse({ iss: 'x' })).toThrow();
      expect(() => QuoteTokenPayloadSchema.parse({ ...validPayload, jti: undefined })).toThrow();
    });

    it('should reject invalid iat (non-integer)', () => {
      expect(() => QuoteTokenPayloadSchema.parse({ ...validPayload, iat: 1.5 })).toThrow();
    });
  });

  describe('AgentPayPayloadV2Schema', () => {
    it('should accept valid payload', () => {
      const result = AgentPayPayloadV2Schema.parse({
        paymentToken: 'eyJ...',
        paymentId: 'awsmp-123',
      });
      expect(result.paymentId).toBe('awsmp-123');
    });

    it('should accept with transactionId', () => {
      const result = AgentPayPayloadV2Schema.parse({
        paymentToken: 'eyJ...',
        paymentId: 'awsmp-123',
        transactionId: 'awsmp-123',
      });
      expect(result.transactionId).toBe('awsmp-123');
    });

    it('should reject missing paymentToken', () => {
      expect(() => AgentPayPayloadV2Schema.parse({ paymentId: 'x' })).toThrow();
    });
  });

  describe('DpopJwkSchema', () => {
    it('should accept valid EC key', () => {
      const result = DpopJwkSchema.parse({
        kty: 'EC',
        crv: 'P-256',
        x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU',
        y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0',
      });
      expect(result.kty).toBe('EC');
      expect(result.crv).toBe('P-256');
    });

    it('should reject non-EC kty', () => {
      expect(() => DpopJwkSchema.parse({ kty: 'RSA', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) })).toThrow();
    });

    it('should reject unsupported curve', () => {
      expect(() => DpopJwkSchema.parse({ kty: 'EC', crv: 'P-192', x: 'a'.repeat(43), y: 'b'.repeat(43) })).toThrow();
    });

    it('should reject short x/y values', () => {
      expect(() => DpopJwkSchema.parse({ kty: 'EC', crv: 'P-256', x: 'short', y: 'short' })).toThrow();
    });
  });

  describe('CreateAgentPaymentRequestSchema', () => {
    it('should accept minimal request', () => {
      const result = CreateAgentPaymentRequestSchema.parse({ quoteToken: 'eyJ...' });
      expect(result.quoteToken).toBe('eyJ...');
      expect(result.clientToken).toBeUndefined();
    });

    it('should accept full request', () => {
      const result = CreateAgentPaymentRequestSchema.parse({
        quoteToken: 'eyJ...',
        clientToken: 'idem-123',
        dpopJwk: { kty: 'EC', crv: 'P-256', x: 'a'.repeat(43), y: 'b'.repeat(43) },
      });
      expect(result.clientToken).toBe('idem-123');
    });

    it('should reject empty quoteToken', () => {
      expect(() => CreateAgentPaymentRequestSchema.parse({ quoteToken: '' })).toThrow();
    });

    it('should reject clientToken over 128 chars', () => {
      expect(() => CreateAgentPaymentRequestSchema.parse({ quoteToken: 'x', clientToken: 'a'.repeat(129) })).toThrow();
    });
  });

  describe('CreateAgentPaymentResponseSchema', () => {
    it('should accept valid response', () => {
      const result = CreateAgentPaymentResponseSchema.parse({
        paymentId: 'awsmp-01970f3e-4b2a-7dc0-8e1f-6a3b9c5d7e2f',
        paymentToken: 'eyJ...',
        createdAt: '2026-05-12T00:00:00Z',
      });
      expect(result.paymentId).toContain('awsmp-');
    });

    it('should reject invalid paymentId format', () => {
      expect(() => CreateAgentPaymentResponseSchema.parse({
        paymentId: 'invalid-id',
        paymentToken: 'x',
        createdAt: '2026-01-01T00:00:00Z',
      })).toThrow();
    });

    it('should reject invalid createdAt format', () => {
      expect(() => CreateAgentPaymentResponseSchema.parse({
        paymentId: 'awsmp-01970f3e-4b2a-7dc0-8e1f-6a3b9c5d7e2f',
        paymentToken: 'x',
        createdAt: 'not-a-date',
      })).toThrow();
    });
  });

  describe('parseQuoteToken', () => {
    it('should decode and validate a valid quote token', async () => {
      const { privateKey } = await jose.generateKeyPair('RS256');
      const token = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'aws-marketplace',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'q-123',
        price: { amount: '1.00', currency: 'USD' },
        payTo: 'seller',
        reference: 'TEST',
      } as any).setProtectedHeader({ alg: 'RS256' }).sign(privateKey);

      const result = parseQuoteToken(token);
      expect(result.iss).toBe('https://api.example.com');
      expect(result.payTo).toBe('seller');
    });

    it('should throw on invalid JWT', () => {
      expect(() => parseQuoteToken('not-a-jwt')).toThrow();
    });

    it('should throw on valid JWT with missing fields', async () => {
      const { privateKey } = await jose.generateKeyPair('RS256');
      const token = await new jose.SignJWT({ iss: 'x' } as any)
        .setProtectedHeader({ alg: 'RS256' }).sign(privateKey);
      expect(() => parseQuoteToken(token)).toThrow();
    });
  });

  describe('safeParseQuoteToken', () => {
    it('should return success for valid token', async () => {
      const { privateKey } = await jose.generateKeyPair('RS256');
      const token = await new jose.SignJWT({
        iss: 'https://api.example.com',
        aud: 'aws-marketplace',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        jti: 'q-456',
        price: { amount: '0.50', currency: 'USD' },
        payTo: 'seller',
        reference: 'TEST',
      } as any).setProtectedHeader({ alg: 'RS256' }).sign(privateKey);

      const result = safeParseQuoteToken(token);
      expect(result.success).toBe(true);
    });

    it('should return error for invalid JWT', () => {
      const result = safeParseQuoteToken('garbage');
      expect(result.success).toBe(false);
    });
  });

  describe('parsePaymentPayload', () => {
    it('should validate a valid payload', () => {
      const result = parsePaymentPayload({ paymentToken: 'tok', paymentId: 'awsmp-123' });
      expect(result.paymentId).toBe('awsmp-123');
    });

    it('should throw on missing fields', () => {
      expect(() => parsePaymentPayload({ paymentToken: 'tok' })).toThrow();
    });
  });

  describe('parseCreatePaymentResponse', () => {
    it('should validate a valid response', () => {
      const result = parseCreatePaymentResponse({
        paymentId: 'awsmp-01970f3e-4b2a-7dc0-8e1f-6a3b9c5d7e2f',
        paymentToken: 'eyJ...',
        createdAt: '2026-05-12T10:00:00Z',
      });
      expect(result.paymentId).toContain('awsmp-');
    });

    it('should throw on invalid response', () => {
      expect(() => parseCreatePaymentResponse({ paymentId: 'bad' })).toThrow();
    });
  });
});
