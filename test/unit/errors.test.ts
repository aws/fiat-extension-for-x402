import { describe, it, expect } from 'vitest';
import {
  FABError,
  ValidationError,
  SignatureError,
  ExpiryError,
  MismatchError,
  DPoPError,
} from '../../src/types';

describe('Error Types', () => {
  describe('FABError', () => {
    it('should create error with message, code, and details', () => {
      const error = new FABError('Test error', 'TEST_ERROR', { field: 'value' });
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.details).toEqual({ field: 'value' });
      expect(error.name).toBe('FABError');
      expect(error instanceof Error).toBe(true);
    });

    it('should create error without details', () => {
      const error = new FABError('Test error', 'TEST_ERROR');
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.details).toBeUndefined();
    });
  });

  describe('ValidationError', () => {
    it('should create validation error with message and details', () => {
      const error = new ValidationError('Invalid field', { field: 'amount', value: 'abc' });
      expect(error.message).toBe('Invalid field');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toEqual({ field: 'amount', value: 'abc' });
      expect(error.name).toBe('ValidationError');
      expect(error instanceof FABError).toBe(true);
    });

    it('should create validation error without details', () => {
      const error = new ValidationError('Invalid format');
      expect(error.message).toBe('Invalid format');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.details).toBeUndefined();
    });
  });

  describe('SignatureError', () => {
    it('should create signature error for quote token', () => {
      const error = new SignatureError('Invalid signature', 'quote');
      expect(error.message).toBe('Invalid signature');
      expect(error.code).toBe('SIGNATURE_ERROR');
      expect(error.tokenType).toBe('quote');
      expect(error.details).toEqual({ tokenType: 'quote' });
      expect(error.name).toBe('SignatureError');
      expect(error instanceof FABError).toBe(true);
    });

    it('should create signature error for payment token', () => {
      const error = new SignatureError('Invalid signature', 'payment');
      expect(error.message).toBe('Invalid signature');
      expect(error.tokenType).toBe('payment');
      expect(error.details).toEqual({ tokenType: 'payment' });
    });
  });

  describe('ExpiryError', () => {
    it('should create expiry error with timestamps', () => {
      const expiry = 1735689900;
      const currentTime = 1735690000;
      const error = new ExpiryError('Token expired', expiry, currentTime);
      expect(error.message).toBe('Token expired');
      expect(error.code).toBe('EXPIRY_ERROR');
      expect(error.expiry).toBe(expiry);
      expect(error.currentTime).toBe(currentTime);
      expect(error.details).toEqual({ expiry, currentTime });
      expect(error.name).toBe('ExpiryError');
      expect(error instanceof FABError).toBe(true);
    });
  });

  describe('MismatchError', () => {
    it('should create mismatch error with expected and actual values', () => {
      const expected = '0.15';
      const actual = '0.20';
      const error = new MismatchError('Amount mismatch', expected, actual);
      expect(error.message).toBe('Amount mismatch');
      expect(error.code).toBe('MISMATCH_ERROR');
      expect(error.expected).toBe(expected);
      expect(error.actual).toBe(actual);
      expect(error.details).toEqual({ expected, actual });
      expect(error.name).toBe('MismatchError');
      expect(error instanceof FABError).toBe(true);
    });

    it('should handle complex objects in expected and actual', () => {
      const expected = { amount: '0.15', currency: 'USD' };
      const actual = { amount: '0.20', currency: 'USD' };
      const error = new MismatchError('Price mismatch', expected, actual);
      expect(error.expected).toEqual(expected);
      expect(error.actual).toEqual(actual);
    });
  });

  describe('DPoPError', () => {
    it('should create DPoP error with message and details', () => {
      const error = new DPoPError('Invalid DPoP proof', { reason: 'stale' });
      expect(error.message).toBe('Invalid DPoP proof');
      expect(error.code).toBe('DPOP_ERROR');
      expect(error.details).toEqual({ reason: 'stale' });
      expect(error.name).toBe('DPoPError');
      expect(error instanceof FABError).toBe(true);
    });

    it('should create DPoP error without details', () => {
      const error = new DPoPError('Invalid DPoP proof');
      expect(error.message).toBe('Invalid DPoP proof');
      expect(error.code).toBe('DPOP_ERROR');
      expect(error.details).toBeUndefined();
    });
  });

  describe('Error inheritance', () => {
    it('should allow catching all FAB errors', () => {
      const errors = [
        new ValidationError('test'),
        new SignatureError('test', 'quote'),
        new ExpiryError('test', 123, 456),
        new MismatchError('test', 'a', 'b'),
        new DPoPError('test'),
      ];

      errors.forEach((error) => {
        expect(error instanceof FABError).toBe(true);
        expect(error instanceof Error).toBe(true);
      });
    });

    it('should allow catching specific error types', () => {
      const error = new ValidationError('test');
      expect(error instanceof ValidationError).toBe(true);
      expect(error instanceof FABError).toBe(true);
      expect(error instanceof SignatureError).toBe(false);
    });
  });
});
