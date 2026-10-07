// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import {
  decodeQuoteToken,
  extractQuoteFromPayment,
  generateTransactionId,
  parseMoneyToDecimal,
  parseTransactionId,
  formatTransactionId,
  isValidTransactionId,
  extractNetworkFromTransactionId,
} from '../../src/utils';
import { ValidationError } from '../../src/types';
import type { PaymentTokenPayload } from '../../src/types';

describe('Utils', () => {
  describe('parseMoneyToDecimal', () => {
    it('should parse number to USD', () => {
      const result = parseMoneyToDecimal(1.50);
      expect(result).toEqual({ amount: 1.50, currency: 'USD' });
    });

    it('should parse dollar string', () => {
      const result = parseMoneyToDecimal('$1.50');
      expect(result).toEqual({ amount: 1.50, currency: 'USD' });
    });

    it('should parse amount with currency', () => {
      const result = parseMoneyToDecimal('1.50 USD');
      expect(result).toEqual({ amount: 1.50, currency: 'USD' });
    });

    it('should parse amount with EUR currency', () => {
      const result = parseMoneyToDecimal('2.50 EUR');
      expect(result).toEqual({ amount: 2.50, currency: 'EUR' });
    });

    it('should parse plain number string', () => {
      const result = parseMoneyToDecimal('1.50');
      expect(result).toEqual({ amount: 1.50, currency: 'USD' });
    });

    it('should throw ValidationError for invalid format', () => {
      expect(() => parseMoneyToDecimal('invalid')).toThrow(ValidationError);
      expect(() => parseMoneyToDecimal('$')).toThrow(ValidationError);
      expect(() => parseMoneyToDecimal('USD 1.50')).toThrow(ValidationError);
    });
  });

  describe('generateTransactionId', () => {
    it('should generate transaction ID with network prefix', () => {
      const txId = generateTransactionId('fab:aws', 'agent-pay-123');
      expect(txId).toMatch(/^fab:aws:[a-f0-9]{16}$/);
    });

    it('should generate unique IDs', () => {
      const txId1 = generateTransactionId('fab:aws', 'agent-pay-123');
      const txId2 = generateTransactionId('fab:aws', 'agent-pay-123');
      expect(txId1).not.toBe(txId2);
    });
  });

  describe('parseTransactionId', () => {
    it('should parse valid transaction ID', () => {
      const result = parseTransactionId('fab:aws:abc123def456');
      expect(result).toEqual({
        network: 'fab:aws',
        id: 'abc123def456'
      });
    });

    it('should handle nested colons in network', () => {
      const result = parseTransactionId('fab:aws:us-east-1:abc123');
      expect(result).toEqual({
        network: 'fab:aws:us-east-1',
        id: 'abc123'
      });
    });

    it('should throw ValidationError for invalid format', () => {
      expect(() => parseTransactionId('invalid')).toThrow(ValidationError);
      expect(() => parseTransactionId('fab')).toThrow(ValidationError);
    });

    it('should accept any scheme:provider format (not just fab:)', () => {
      const result1 = parseTransactionId('aws:abc123');
      expect(result1.network).toBe('aws');
      expect(result1.id).toBe('abc123');

      const result2 = parseTransactionId('evm:eth:abc123');
      expect(result2.network).toBe('evm:eth');
      expect(result2.id).toBe('abc123');
    });
  });

  describe('formatTransactionId', () => {
    it('should format transaction ID from components', () => {
      const result = formatTransactionId('aws:base', 'abc123def456');
      expect(result).toBe('aws:base:abc123def456');
    });

    it('should throw ValidationError if network has no colon (invalid format)', () => {
      expect(() => formatTransactionId('aws', 'abc123')).toThrow(ValidationError);
    });

    it('should accept any scheme:provider network format', () => {
      expect(formatTransactionId('evm:eth', 'abc123')).toBe('evm:eth:abc123');
    });
  });

  describe('isValidTransactionId', () => {
    it('should return true for valid transaction IDs', () => {
      expect(isValidTransactionId('fab:aws:abc123')).toBe(true);
      expect(isValidTransactionId('fab:google:xyz789')).toBe(true);
      expect(isValidTransactionId('fab:aws:us-east-1:abc123')).toBe(true);
    });

    it('should return false for invalid transaction IDs', () => {
      expect(isValidTransactionId('invalid')).toBe(false);
      expect(isValidTransactionId('fab')).toBe(false);
      expect(isValidTransactionId('')).toBe(false);
    });

    it('should return true for valid transaction IDs with any network format', () => {
      expect(isValidTransactionId('aws:abc123')).toBe(true);
      expect(isValidTransactionId('evm:eth:abc123')).toBe(true);
    });
  });

  describe('extractNetworkFromTransactionId', () => {
    it('should extract network from transaction ID', () => {
      expect(extractNetworkFromTransactionId('fab:aws:abc123')).toBe('fab:aws');
      expect(extractNetworkFromTransactionId('fab:google:xyz789')).toBe('fab:google');
      expect(extractNetworkFromTransactionId('fab:aws:us-east-1:abc123')).toBe('fab:aws:us-east-1');
    });

    it('should throw ValidationError for invalid transaction ID', () => {
      expect(() => extractNetworkFromTransactionId('invalid')).toThrow(ValidationError);
    });
  });

  describe('extractQuoteFromPayment', () => {
    it('should extract quote token from payment token payload', () => {
      const payment: PaymentTokenPayload = {
        iss: 'https://pay.aws.amazon.com',
        sub: 'client_uuid_555',
        aud: 'https://api.weather.com',
        iat: 1735689600,
        exp: 1735689900,
        payment_context: {
          transaction_id: 'fab:aws:txn_888999',
          quote_token: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...',
        },
      };

      const quoteToken = extractQuoteFromPayment(payment);
      expect(quoteToken).toBe('eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...');
    });
  });

  describe('decodeQuoteToken', () => {
    it('should throw ValidationError for invalid JWT format', () => {
      expect(() => decodeQuoteToken('invalid-token')).toThrow(ValidationError);
      expect(() => decodeQuoteToken('')).toThrow(ValidationError);
    });

    it('should throw ValidationError with error details', () => {
      try {
        decodeQuoteToken('not.a.jwt');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain('Invalid quote token format');
      }
    });

    // Note: Testing with valid JWT would require creating actual JWTs
    // which is better suited for integration tests
  });

  describe('parseMoneyToDecimal - additional edge cases', () => {
    it('should handle integer amounts', () => {
      expect(parseMoneyToDecimal('5')).toEqual({ amount: 5, currency: 'USD' });
      expect(parseMoneyToDecimal('$10')).toEqual({ amount: 10, currency: 'USD' });
    });

    it('should handle amounts with many decimal places', () => {
      expect(parseMoneyToDecimal('1.999')).toEqual({ amount: 1.999, currency: 'USD' });
      expect(parseMoneyToDecimal('$0.01')).toEqual({ amount: 0.01, currency: 'USD' });
    });

    it('should handle zero amounts', () => {
      expect(parseMoneyToDecimal(0)).toEqual({ amount: 0, currency: 'USD' });
      expect(parseMoneyToDecimal('$0')).toEqual({ amount: 0, currency: 'USD' });
      expect(parseMoneyToDecimal('0.00 EUR')).toEqual({ amount: 0, currency: 'EUR' });
    });

    it('should throw for negative amounts', () => {
      expect(() => parseMoneyToDecimal('-1.50')).toThrow(ValidationError);
      expect(() => parseMoneyToDecimal('$-5')).toThrow(ValidationError);
    });

    it('should throw for amounts with invalid currency codes', () => {
      expect(() => parseMoneyToDecimal('1.50 US')).toThrow(ValidationError);
      expect(() => parseMoneyToDecimal('1.50 USDD')).toThrow(ValidationError);
    });

    it('should throw for malformed strings', () => {
      expect(() => parseMoneyToDecimal('$')).toThrow(ValidationError);
      expect(() => parseMoneyToDecimal('USD')).toThrow(ValidationError);
      expect(() => parseMoneyToDecimal('1.50.50')).toThrow(ValidationError);
      expect(() => parseMoneyToDecimal('1,50')).toThrow(ValidationError);
    });
  });

  describe('generateTransactionId - edge cases', () => {
    it('should handle different network formats', () => {
      const txId1 = generateTransactionId('fab:aws', 'agent-pay-1');
      const txId2 = generateTransactionId('fab:google', 'agent-pay-2');
      const txId3 = generateTransactionId('fab:custom:network', 'agent-pay-3');
      
      expect(txId1).toMatch(/^fab:aws:[a-f0-9]{16}$/);
      expect(txId2).toMatch(/^fab:google:[a-f0-9]{16}$/);
      expect(txId3).toMatch(/^fab:custom:network:[a-f0-9]{16}$/);
    });

    it('should generate IDs with exactly 16 hex characters', () => {
      const txId = generateTransactionId('fab:test', 'agent-pay');
      const parts = txId.split(':');
      const id = parts[parts.length - 1];
      
      expect(id).toHaveLength(16);
      expect(id).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe('parseTransactionId - additional edge cases', () => {
    it('should handle very long network identifiers', () => {
      const result = parseTransactionId('fab:aws:us-east-1:prod:service:abc123');
      expect(result).toEqual({
        network: 'fab:aws:us-east-1:prod:service',
        id: 'abc123'
      });
    });

    it('should throw for empty string', () => {
      expect(() => parseTransactionId('')).toThrow(ValidationError);
    });

    it('should throw for single colon', () => {
      expect(() => parseTransactionId('fab:')).toThrow(ValidationError);
    });

    it('should throw detailed error message', () => {
      try {
        parseTransactionId('invalid-format');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain('Invalid transaction ID format');
      }
    });
  });

  describe('formatTransactionId - edge cases', () => {
    it('should handle complex network identifiers', () => {
      const result = formatTransactionId('fab:aws:us-east-1:prod', 'abc123');
      expect(result).toBe('fab:aws:us-east-1:prod:abc123');
    });

    it('should throw detailed error for invalid network', () => {
      try {
        formatTransactionId('invalid', 'abc123');
      } catch (error) {
        expect(error).toBeInstanceOf(ValidationError);
        expect((error as ValidationError).message).toContain('scheme:provider format');
      }
    });
  });

  describe('isValidTransactionId - comprehensive cases', () => {
    it('should handle empty and whitespace strings', () => {
      expect(isValidTransactionId('')).toBe(false);
      expect(isValidTransactionId(' ')).toBe(false);
      expect(isValidTransactionId('   ')).toBe(false);
    });

    it('should handle malformed IDs', () => {
      expect(isValidTransactionId('fab')).toBe(false);
      expect(isValidTransactionId('fab:')).toBe(false);
      expect(isValidTransactionId(':abc123')).toBe(false);
      // fab::abc123 is actually valid - network is "fab:" and id is "abc123"
      expect(isValidTransactionId('fab::abc123')).toBe(true);
    });

    it('should validate correct format strictly', () => {
      expect(isValidTransactionId('fab:aws:abc')).toBe(true);
      expect(isValidTransactionId('fab:test:123')).toBe(true);
      expect(isValidTransactionId('fab:a:b:c:d')).toBe(true);
    });
  });

  describe('extractNetworkFromTransactionId - edge cases', () => {
    it('should handle minimal valid transaction ID', () => {
      expect(extractNetworkFromTransactionId('fab:x:y')).toBe('fab:x');
    });

    it('should throw for malformed IDs', () => {
      expect(() => extractNetworkFromTransactionId('fab')).toThrow(ValidationError);
      expect(() => extractNetworkFromTransactionId('nocolon')).toThrow(ValidationError);
    });

    it('should extract network from any scheme:provider format', () => {
      expect(extractNetworkFromTransactionId('notfab:aws:123')).toBe('notfab:aws');
    });
  });
});
