// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getAgentPayBaseUrl,
  registerNetwork,
  unregisterNetwork,
  getRegisteredNetworks,
  clearNetworkRegistry,
  discoverAgentPayEndpoints,
  fetchAgentPayPublicKeys,
  clearDiscoveryCache,
} from '../../src/discovery';

describe('Agent Pay Discovery', () => {
  beforeEach(() => {
    // Clear registry and caches before each test
    clearNetworkRegistry();
    clearDiscoveryCache();
    vi.clearAllMocks();
  });

  describe('Network Registry', () => {
    it('should register network', () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');
      expect(getAgentPayBaseUrl('fab:aws')).toBe('https://pay.aws.amazon.com');
    });

    it('should register multiple networks', () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');
      registerNetwork('fab:google', 'https://pay.google.com');
      registerNetwork('custom:provider', 'https://custom-pay.example.com');

      expect(getAgentPayBaseUrl('fab:aws')).toBe('https://pay.aws.amazon.com');
      expect(getAgentPayBaseUrl('fab:google')).toBe('https://pay.google.com');
      expect(getAgentPayBaseUrl('custom:provider')).toBe('https://custom-pay.example.com');
    });

    it('should overwrite existing registration', () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');
      registerNetwork('fab:aws', 'https://new-pay.aws.com');
      expect(getAgentPayBaseUrl('fab:aws')).toBe('https://new-pay.aws.com');
    });

    it('should unregister network', () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');
      expect(unregisterNetwork('fab:aws')).toBe(true);
      expect(() => getAgentPayBaseUrl('fab:aws')).toThrow('Network not registered');
    });

    it('should return false when unregistering non-existent network', () => {
      expect(unregisterNetwork('fab:nonexistent')).toBe(false);
    });

    it('should get all registered networks', () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');
      registerNetwork('fab:google', 'https://pay.google.com');

      const networks = getRegisteredNetworks();
      expect(networks.size).toBe(2);
      expect(networks.get('fab:aws')).toBe('https://pay.aws.amazon.com');
      expect(networks.get('fab:google')).toBe('https://pay.google.com');
    });

    it('should clear all registrations', () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');
      registerNetwork('fab:google', 'https://pay.google.com');

      clearNetworkRegistry();

      expect(getRegisteredNetworks().size).toBe(0);
      expect(() => getAgentPayBaseUrl('fab:aws')).toThrow('Network not registered');
    });

    it('should throw error for invalid network format', () => {
      expect(() => registerNetwork('invalid', 'https://pay.example.com')).toThrow(
        'Invalid network identifier format'
      );
    });

    it('should accept any scheme (not just fab:)', () => {
      // Network identifiers are no longer restricted to fab: prefix
      // This supports aws:base and other future schemes
      registerNetwork('evm:aws', 'https://pay.example.com');
      expect(getAgentPayBaseUrl('evm:aws')).toBe('https://pay.example.com');
    });

    it('should throw error for missing provider', () => {
      expect(() => registerNetwork('fab:', 'https://pay.example.com')).toThrow(
        'Missing provider'
      );
    });

    it('should throw error for invalid base URL', () => {
      expect(() => registerNetwork('fab:aws', 'not-a-url')).toThrow('Invalid base URL');
    });
  });

  describe('getAgentPayBaseUrl', () => {
    it('should throw error when network not registered', () => {
      expect(() => getAgentPayBaseUrl('fab:aws')).toThrow(
        'Network not registered: fab:aws'
      );
    });

    it('should throw error for invalid network format', () => {
      expect(() => getAgentPayBaseUrl('invalid-format')).toThrow(
        'Invalid network identifier format'
      );
    });

    it('should throw error for unregistered network (any scheme)', () => {
      expect(() => getAgentPayBaseUrl('evm:aws')).toThrow('Network not registered');
    });

    it('should throw error for missing provider', () => {
      expect(() => getAgentPayBaseUrl('fab:')).toThrow('Missing provider');
    });
  });

  describe('discoverAgentPayEndpoints', () => {
    it('should fetch and parse discovery metadata', async () => {
      // Register network first
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');

      const mockMetadata = {
        issuer: 'https://pay.aws.amazon.com',
        payment_endpoint: 'https://pay.aws.amazon.com/payments',
        capture_endpoint: 'https://pay.aws.amazon.com/capture',
        jwks_uri: 'https://pay.aws.amazon.com/.well-known/jwks.json',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMetadata,
      });

      const metadata = await discoverAgentPayEndpoints('fab:aws');

      expect(metadata).toEqual(mockMetadata);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://pay.aws.amazon.com/.well-known/openid-configuration'
      );
    });

    it('should cache discovery metadata for 24 hours', async () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');

      const mockMetadata = {
        issuer: 'https://pay.aws.amazon.com',
        payment_endpoint: 'https://pay.aws.amazon.com/payments',
        capture_endpoint: 'https://pay.aws.amazon.com/capture',
        jwks_uri: 'https://pay.aws.amazon.com/.well-known/jwks.json',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMetadata,
      });

      // First call
      await discoverAgentPayEndpoints('fab:aws');
      // Second call (should use cache)
      await discoverAgentPayEndpoints('fab:aws');

      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should throw error on fetch failure', async () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(discoverAgentPayEndpoints('fab:aws')).rejects.toThrow(
        'Failed to discover Agent Pay endpoints'
      );
    });

    it('should throw error on invalid metadata', async () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ invalid: 'data' }),
      });

      await expect(discoverAgentPayEndpoints('fab:aws')).rejects.toThrow(
        'Invalid discovery metadata'
      );
    });
  });

  describe('fetchAgentPayPublicKeys', () => {
    it('should fetch JWKS from discovered endpoint', async () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');

      const mockMetadata = {
        issuer: 'https://pay.aws.amazon.com',
        payment_endpoint: 'https://pay.aws.amazon.com/payments',
        capture_endpoint: 'https://pay.aws.amazon.com/capture',
        jwks_uri: 'https://pay.aws.amazon.com/.well-known/jwks.json',
      };

      const mockJWKS = {
        keys: [
          { kty: 'RSA', kid: 'key-1', use: 'sig', n: '...', e: 'AQAB' },
          { kty: 'RSA', kid: 'key-2', use: 'sig', n: '...', e: 'AQAB' },
        ],
      };

      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockMetadata,
        })
        .mockResolvedValueOnce({
          ok: true,
          headers: new Map(),
          json: async () => mockJWKS,
        });

      const jwks = await fetchAgentPayPublicKeys('fab:aws');

      expect(jwks).toEqual(mockJWKS);
      expect(global.fetch).toHaveBeenCalledWith(
        'https://pay.aws.amazon.com/.well-known/jwks.json'
      );
    });
  });

  describe('Cache Management', () => {
    it('should clear discovery cache', async () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');

      const mockMetadata = {
        issuer: 'https://pay.aws.amazon.com',
        payment_endpoint: 'https://pay.aws.amazon.com/payments',
        capture_endpoint: 'https://pay.aws.amazon.com/capture',
        jwks_uri: 'https://pay.aws.amazon.com/.well-known/jwks.json',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMetadata,
      });

      // First call
      await discoverAgentPayEndpoints('fab:aws');

      // Clear cache
      clearDiscoveryCache('fab:aws');

      // Second call (should fetch again)
      await discoverAgentPayEndpoints('fab:aws');

      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('should clear all discovery cache', async () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');
      registerNetwork('fab:google', 'https://pay.google.com');

      const mockMetadata = {
        issuer: 'https://pay.aws.amazon.com',
        payment_endpoint: 'https://pay.aws.amazon.com/payments',
        capture_endpoint: 'https://pay.aws.amazon.com/capture',
        jwks_uri: 'https://pay.aws.amazon.com/.well-known/jwks.json',
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockMetadata,
      });

      // Cache both
      await discoverAgentPayEndpoints('fab:aws');
      await discoverAgentPayEndpoints('fab:google');

      // Clear all
      clearDiscoveryCache();

      // Fetch again (should not use cache)
      await discoverAgentPayEndpoints('fab:aws');
      await discoverAgentPayEndpoints('fab:google');

      expect(global.fetch).toHaveBeenCalledTimes(4);
    });
  });

  describe('Network Registry - Additional Edge Cases', () => {
    it('should handle standard network identifiers', () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');
      expect(getAgentPayBaseUrl('fab:aws')).toBe('https://pay.aws.amazon.com');
    });

    it('should preserve trailing slashes in base URLs', () => {
      registerNetwork('fab:test', 'https://pay.test.com/');
      expect(getAgentPayBaseUrl('fab:test')).toBe('https://pay.test.com/');
    });

    it('should handle URLs with ports', () => {
      registerNetwork('fab:local', 'http://localhost:3000');
      expect(getAgentPayBaseUrl('fab:local')).toBe('http://localhost:3000');
    });

    it('should handle URLs with paths', () => {
      registerNetwork('custom:provider', 'https://api.example.com/pay');
      expect(getAgentPayBaseUrl('custom:provider')).toBe('https://api.example.com/pay');
    });

    it('should reject empty network identifier', () => {
      expect(() => registerNetwork('', 'https://pay.example.com')).toThrow();
    });

    it('should reject empty base URL', () => {
      expect(() => registerNetwork('fab:test', '')).toThrow('Invalid base URL');
    });

    it('should reject URLs without protocol', () => {
      expect(() => registerNetwork('fab:test', 'invalid-url')).toThrow('Invalid base URL');
    });

    it('should accept both http and https', () => {
      registerNetwork('fab:http', 'http://pay.test.com');
      registerNetwork('fab:https', 'https://pay.test.com');
      
      expect(getAgentPayBaseUrl('fab:http')).toBe('http://pay.test.com');
      expect(getAgentPayBaseUrl('fab:https')).toBe('https://pay.test.com');
    });
  });

  describe('getRegisteredNetworks - immutability', () => {
    it('should return a copy of the registry', () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');
      
      const networks1 = getRegisteredNetworks();
      const networks2 = getRegisteredNetworks();
      
      expect(networks1).not.toBe(networks2); // Different objects
      expect(networks1.size).toBe(networks2.size);
    });

    it('should not allow modification of internal state', () => {
      registerNetwork('fab:aws', 'https://pay.aws.amazon.com');
      
      const networks = getRegisteredNetworks();
      networks.set('fab:hacked', 'https://evil.com');
      
      // Original registry should be unchanged
      expect(() => getAgentPayBaseUrl('fab:hacked')).toThrow('Network not registered');
    });
  });

  describe('clearDiscoveryCache', () => {
    it('should clear cache without errors', () => {
      expect(() => clearDiscoveryCache()).not.toThrow();
    });

    it('should be idempotent', () => {
      clearDiscoveryCache();
      clearDiscoveryCache();
      clearDiscoveryCache();
      expect(() => clearDiscoveryCache()).not.toThrow();
    });
  });
});
