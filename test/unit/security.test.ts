// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Security Utilities Tests (Task 18)
 */

import { describe, it, expect } from 'vitest';
import { ALLOWED_ALGORITHMS, secureCompare, validateUrl } from '../../src/security';

describe('Security Utilities', () => {
  describe('ALLOWED_ALGORITHMS', () => {
    it('should include RS256, ES256, ES384, ES512', () => {
      expect(ALLOWED_ALGORITHMS).toContain('RS256');
      expect(ALLOWED_ALGORITHMS).toContain('ES256');
      expect(ALLOWED_ALGORITHMS).toContain('ES384');
      expect(ALLOWED_ALGORITHMS).toContain('ES512');
    });

    it('should NOT include insecure algorithms', () => {
      expect(ALLOWED_ALGORITHMS).not.toContain('none');
      expect(ALLOWED_ALGORITHMS).not.toContain('HS256');
      expect(ALLOWED_ALGORITHMS).not.toContain('HS384');
      expect(ALLOWED_ALGORITHMS).not.toContain('HS512');
    });

    it('cannot be widened at runtime', () => {
      expect(Object.isFrozen(ALLOWED_ALGORITHMS)).toBe(true);
      expect(() => (ALLOWED_ALGORITHMS as string[]).push('HS256')).toThrow(TypeError);
      expect(ALLOWED_ALGORITHMS).toEqual(['RS256', 'ES256', 'ES384', 'ES512']);
    });
  });

  describe('secureCompare', () => {
    it('should return true for equal strings', () => {
      expect(secureCompare('hello', 'hello')).toBe(true);
      expect(secureCompare('awsmp-123-456', 'awsmp-123-456')).toBe(true);
    });

    it('should return false for different strings', () => {
      expect(secureCompare('hello', 'world')).toBe(false);
      expect(secureCompare('awsmp-123', 'awsmp-456')).toBe(false);
    });

    it('should return false for different lengths', () => {
      expect(secureCompare('short', 'longer-string')).toBe(false);
      expect(secureCompare('', 'notempty')).toBe(false);
    });

    it('should return true for empty strings', () => {
      expect(secureCompare('', '')).toBe(true);
    });

    it('should handle JWT-length strings', () => {
      const jwt1 = 'eyJhbGciOiJFUzM4NCJ9.eyJpc3MiOiJhd3MtbWFya2V0cGxhY2UifQ.signature';
      const jwt2 = 'eyJhbGciOiJFUzM4NCJ9.eyJpc3MiOiJhd3MtbWFya2V0cGxhY2UifQ.signature';
      const jwt3 = 'eyJhbGciOiJFUzM4NCJ9.eyJpc3MiOiJhd3MtbWFya2V0cGxhY2UifQ.different';
      expect(secureCompare(jwt1, jwt2)).toBe(true);
      expect(secureCompare(jwt1, jwt3)).toBe(false);
    });
  });

  describe('validateUrl', () => {
    it('should accept valid HTTPS URLs', () => {
      const url = validateUrl('https://pay.example.com');
      expect(url.protocol).toBe('https:');
      expect(url.hostname).toBe('pay.example.com');
    });

    it('should accept HTTP localhost', () => {
      const url = validateUrl('http://localhost:3001');
      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('localhost');
    });

    it('should accept HTTP 127.0.0.1', () => {
      const url = validateUrl('http://127.0.0.1:3001');
      expect(url.protocol).toBe('http:');
    });

    it('should reject HTTP for non-localhost', () => {
      expect(() => validateUrl('http://pay.example.com')).toThrow('Insecure URL protocol');
    });

    it('should reject invalid URLs', () => {
      expect(() => validateUrl('not-a-url')).toThrow('Invalid URL');
      expect(() => validateUrl('')).toThrow('Invalid URL');
    });

    it('should allow HTTP when allowHttp is true', () => {
      const url = validateUrl('http://pay.example.com', true);
      expect(url.protocol).toBe('http:');
    });

    it('should handle URLs with paths', () => {
      const url = validateUrl('https://api.example.com/v1/payments');
      expect(url.pathname).toBe('/v1/payments');
    });
  });
});
