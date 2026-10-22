// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { decodeQuoteToken, parseMoneyToDecimal } from '../../src/utils';
import { ValidationError } from '../../src/types';

describe('Utils', () => {
  describe('parseMoneyToDecimal', () => {
    it('should parse number to USD', () => {
      const result = parseMoneyToDecimal(1.5);
      expect(result).toEqual({ amount: 1.5, currency: 'USD' });
    });

    it('should parse dollar string', () => {
      const result = parseMoneyToDecimal('$1.50');
      expect(result).toEqual({ amount: 1.5, currency: 'USD' });
    });

    it('should parse amount with currency', () => {
      const result = parseMoneyToDecimal('1.50 USD');
      expect(result).toEqual({ amount: 1.5, currency: 'USD' });
    });

    it('should parse amount with EUR currency', () => {
      const result = parseMoneyToDecimal('2.50 EUR');
      expect(result).toEqual({ amount: 2.5, currency: 'EUR' });
    });

    it('should parse plain number string', () => {
      const result = parseMoneyToDecimal('1.50');
      expect(result).toEqual({ amount: 1.5, currency: 'USD' });
    });

    it('should throw ValidationError for invalid format', () => {
      expect(() => parseMoneyToDecimal('invalid')).toThrow(ValidationError);
      expect(() => parseMoneyToDecimal('$')).toThrow(ValidationError);
      expect(() => parseMoneyToDecimal('USD 1.50')).toThrow(ValidationError);
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
});
