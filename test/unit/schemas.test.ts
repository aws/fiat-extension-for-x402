// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Zod Schema Validation Tests (Task 43)
 */

import { describe, it, expect } from 'vitest';
import * as jose from 'jose';
import {
  QuoteTokenPayloadSchema,
  QuoteTokenPriceSchema,
  AgenticCommerceSettlementSchema,
  AgenticCommerceSupportSchema,
  AgenticCommerceTermsSchema,
  AgenticCommercePayloadV2Schema,
  parseQuoteToken,
  safeParseQuoteToken,
  parsePaymentPayload,
} from '../../src/schemas';

describe('Zod Schemas', () => {
  describe('QuoteTokenPriceSchema', () => {
    it('should accept valid price', () => {
      expect(QuoteTokenPriceSchema.parse({ amount: '0.15', currency: 'USD' })).toEqual({
        amount: '0.15',
        currency: 'USD',
      });
    });

    it('should reject non-decimal amount', () => {
      expect(() => QuoteTokenPriceSchema.parse({ amount: 'abc', currency: 'USD' })).toThrow();
    });

    it('should reject invalid currency length', () => {
      expect(() => QuoteTokenPriceSchema.parse({ amount: '1.00', currency: 'US' })).toThrow();
      expect(() => QuoteTokenPriceSchema.parse({ amount: '1.00', currency: 'USDD' })).toThrow();
    });
  });

  describe('AgenticCommerceSettlementSchema', () => {
    it('should accept valid settlement', () => {
      expect(AgenticCommerceSettlementSchema.parse({ method: 'INST' })).toEqual({ method: 'INST' });
      expect(AgenticCommerceSettlementSchema.parse({ method: 'CLRG', cycle: 'MNTH' })).toEqual({
        method: 'CLRG',
        cycle: 'MNTH',
      });
    });

    it('should reject invalid method', () => {
      expect(() => AgenticCommerceSettlementSchema.parse({ method: 'INVALID' })).toThrow();
    });
  });

  describe('AgenticCommerceSupportSchema', () => {
    it('should accept valid support', () => {
      const result = AgenticCommerceSupportSchema.parse({
        uri: 'https://support.example.com',
        method: 'human',
      });
      expect(result.method).toBe('human');
    });

    it('should reject invalid URI', () => {
      expect(() =>
        AgenticCommerceSupportSchema.parse({ uri: 'not-a-url', method: 'human' })
      ).toThrow();
    });

    it('should reject invalid method', () => {
      expect(() =>
        AgenticCommerceSupportSchema.parse({ uri: 'https://x.com', method: 'bot' })
      ).toThrow();
    });
  });

  describe('AgenticCommerceTermsSchema', () => {
    it('should accept valid terms', () => {
      const result = AgenticCommerceTermsSchema.parse({
        description: 'TOS',
        uri: 'https://example.com/tos',
      });
      expect(result.description).toBe('TOS');
    });

    it('should reject empty description', () => {
      expect(() =>
        AgenticCommerceTermsSchema.parse({ description: '', uri: 'https://x.com' })
      ).toThrow();
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
        price: [
          { amount: '0.15', currency: 'USD' },
          { amount: '0.13', currency: 'EUR' },
        ],
      });
      expect(Array.isArray(result.price)).toBe(true);
    });

    it('should accept array aud', () => {
      const result = QuoteTokenPayloadSchema.parse({
        ...validPayload,
        aud: ['aws:base', 'other:net'],
      });
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

  describe('AgenticCommercePayloadV2Schema', () => {
    it('should accept valid payload', () => {
      const result = AgenticCommercePayloadV2Schema.parse({
        paymentToken: 'eyJ...',
        paymentId: 'awsmp-123',
      });
      expect(result.paymentId).toBe('awsmp-123');
    });

    it('should reject missing paymentToken', () => {
      expect(() => AgenticCommercePayloadV2Schema.parse({ paymentId: 'x' })).toThrow();
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
      })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

      const result = parseQuoteToken(token);
      expect(result.iss).toBe('https://api.example.com');
      expect(result.payTo).toBe('seller');
    });

    it('should throw on invalid JWT', () => {
      expect(() => parseQuoteToken('not-a-jwt')).toThrow();
    });

    it('should throw on valid JWT with missing fields', async () => {
      const { privateKey } = await jose.generateKeyPair('RS256');
      const token = await new jose.SignJWT({ iss: 'x' })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);
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
      })
        .setProtectedHeader({ alg: 'RS256' })
        .sign(privateKey);

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
});
