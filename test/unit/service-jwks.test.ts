import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as jose from 'jose';
import {
  fetchServiceJWKS,
  clearServiceJWKSCache,
} from '../../src/utils';

describe('fetchServiceJWKS', () => {
  beforeEach(() => {
    clearServiceJWKSCache();
  });

  it('should return a JWKS function for a valid service URL', () => {
    const jwks = fetchServiceJWKS('https://api.example.com');
    expect(typeof jwks).toBe('function');
  });

  it('should strip trailing slash from service URL', () => {
    const jwks1 = fetchServiceJWKS('https://api.example.com/');
    const jwks2 = fetchServiceJWKS('https://api.example.com');
    // Both should resolve to the same cache entry
    expect(jwks1).toBe(jwks2);
  });

  it('should return cached JWKS on second call', () => {
    const jwks1 = fetchServiceJWKS('https://api.example.com');
    const jwks2 = fetchServiceJWKS('https://api.example.com');
    expect(jwks1).toBe(jwks2);
  });

  it('should return different JWKS for different service URLs', () => {
    const jwks1 = fetchServiceJWKS('https://api.example.com');
    const jwks2 = fetchServiceJWKS('https://api.other.com');
    expect(jwks1).not.toBe(jwks2);
  });
});

describe('clearServiceJWKSCache', () => {
  beforeEach(() => {
    clearServiceJWKSCache();
  });

  it('should clear all cached entries when called with no arguments', () => {
    const jwks1 = fetchServiceJWKS('https://api.example.com');
    const jwks2 = fetchServiceJWKS('https://api.other.com');

    clearServiceJWKSCache();

    // After clearing, new calls should return new instances
    const jwks1b = fetchServiceJWKS('https://api.example.com');
    const jwks2b = fetchServiceJWKS('https://api.other.com');
    expect(jwks1b).not.toBe(jwks1);
    expect(jwks2b).not.toBe(jwks2);
  });

  it('should clear only the specified service URL entry', () => {
    const jwks1 = fetchServiceJWKS('https://api.example.com');
    const jwks2 = fetchServiceJWKS('https://api.other.com');

    clearServiceJWKSCache('https://api.example.com');

    // example.com should be new, other.com should be cached
    const jwks1b = fetchServiceJWKS('https://api.example.com');
    const jwks2b = fetchServiceJWKS('https://api.other.com');
    expect(jwks1b).not.toBe(jwks1);
    expect(jwks2b).toBe(jwks2);
  });

  it('should handle clearing non-existent entries gracefully', () => {
    expect(() => clearServiceJWKSCache('https://nonexistent.com')).not.toThrow();
  });
});
