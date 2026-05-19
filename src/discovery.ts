// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agent Pay Endpoint Discovery
 * 
 * Utilities for discovering Agent Pay provider endpoints via OIDC discovery.
 */

import { WELL_KNOWN_OIDC_PATH } from './constants';

/**
 * Agent Pay discovery metadata (OIDC Discovery response)
 */
export interface AgentPayDiscoveryMetadata {
  /** Agent Pay's canonical identifier (matches iss claim in Payment JWTs) */
  issuer: string;
  /** URL where services can fetch Agent Pay's public keys */
  jwks_uri: string;
  /** URL where clients create payment transactions */
  payment_endpoint: string;
  /** Settlement methods this Agent Pay provider supports */
  supported_settlement_methods?: string[];
  /** Algorithms used to sign Payment JWTs */
  signing_alg_values_supported?: string[];
  /** Algorithms supported for DPoP proof JWTs */
  dpop_signing_alg_values_supported?: string[];
  /** Authentication methods accepted by payment endpoint */
  token_endpoint_auth_methods_supported?: string[];
  /** Grant types supported (Agent Pay uses 'quote_token') */
  grant_types_supported?: string[];
}

/**
 * Cache for discovery metadata
 */
const discoveryCache = new Map<string, {
  metadata: AgentPayDiscoveryMetadata;
  expiresAt: number;
}>();

/**
 * Cache for JWKS
 */
const jwksCache = new Map<string, {
  jwks: any;
  expiresAt: number;
}>();

/**
 * Registry for network base URLs
 */
const networkRegistry = new Map<string, string>();

/**
 * Register a network's Agent Pay base URL
 * 
 * @param network - Network identifier (e.g., 'aws:base')
 * @param baseUrl - Agent Pay base URL (e.g., 'https://pay.aws.amazon.com')
 * 
 * @example
 * ```typescript
 * // Register AWS Agent Pay network
 * registerNetwork('aws:base', 'https://pay.aws.amazon.com');
 * 
 * // Register custom Agent Pay network
 * registerNetwork('custom:provider', 'https://custom-pay.example.com');
 * 
 * // Register internal Agent Pay network
 * registerNetwork('internal:provider', 'https://internal-pay.corp.com');
 * ```
 */
export function registerNetwork(network: string, baseUrl: string): void {
  // Validate network format
  const parts = network.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid network identifier format: ${network}`);
  }

  const [scheme, provider] = parts;

  if (!provider || provider.trim() === '') {
    throw new Error(`Missing provider in network identifier: ${network}`);
  }

  // Validate base URL
  try {
    new URL(baseUrl);
  } catch {
    throw new Error(`Invalid base URL: ${baseUrl}`);
  }

  networkRegistry.set(network, baseUrl);
}

/**
 * Unregister a network
 * 
 * @param network - Network identifier to unregister
 * @returns true if the network was unregistered, false if it didn't exist
 * 
 * @example
 * ```typescript
 * unregisterNetwork('custom:provider');
 * ```
 */
export function unregisterNetwork(network: string): boolean {
  return networkRegistry.delete(network);
}

/**
 * Get all registered networks
 * 
 * @returns Map of network identifiers to base URLs
 * 
 * @example
 * ```typescript
 * const networks = getRegisteredNetworks();
 * console.log(networks.get('aws:base'));
 * ```
 */
export function getRegisteredNetworks(): Map<string, string> {
  return new Map(networkRegistry);
}

/**
 * Clear all registered networks
 * 
 * @example
 * ```typescript
 * clearNetworkRegistry();
 * ```
 */
export function clearNetworkRegistry(): void {
  networkRegistry.clear();
}

/**
 * Get Agent Pay base URL from network identifier
 * 
 * Looks up Agent Pay base URL from the registry. If not found, throws an error.
 * You must register networks using registerNetwork() before calling this.
 * 
 * @param network - Network identifier (e.g., 'aws:base')
 * @returns Agent Pay base URL
 * @throws Error if network identifier is invalid or not registered
 * 
 * @example
 * ```typescript
 * // Register first
 * registerNetwork('aws:base', 'https://pay.aws.amazon.com');
 * 
 * // Then get
 * const baseUrl = getAgentPayBaseUrl('aws:base');
 * // → "https://pay.aws.amazon.com"
 * ```
 */
export function getAgentPayBaseUrl(network: string): string {
  // Validate network format: scheme:provider
  const parts = network.split(':');
  if (parts.length < 2) {
    throw new Error(`Invalid network identifier format: ${network}`);
  }

  const provider = parts.slice(1).join(':');

  if (!provider || provider.trim() === '') {
    throw new Error(`Missing provider in network identifier: ${network}`);
  }

  // Look up in registry
  const baseUrl = networkRegistry.get(network);
  if (!baseUrl) {
    throw new Error(`Network not registered: ${network}. Use registerNetwork() to register it.`);
  }

  return baseUrl;
}

/**
 * Discover Agent Pay endpoints via OIDC discovery
 * 
 * Fetches the Agent Pay's OIDC discovery document to get endpoint URLs
 * and supported capabilities.
 * 
 * @param network - Network identifier (e.g., 'aws:base')
 * @param options - Discovery options
 * @returns Agent Pay discovery metadata
 * 
 * @example
 * ```typescript
 * const metadata = await discoverAgentPayEndpoints('aws:base');
 * console.log(metadata.payment_endpoint);
 * // → 'https://pay.aws.amazon.com/v1/transactions'
 * ```
 */
export async function discoverAgentPayEndpoints(
  network: string,
  options: {
    /** Skip cache and force fresh fetch */
    skipCache?: boolean;
    /** Custom fetch function (for testing) */
    fetch?: typeof globalThis.fetch;
  } = {}
): Promise<AgentPayDiscoveryMetadata> {
  const fetchFn = options.fetch || globalThis.fetch;
  
  // Check cache
  if (!options.skipCache) {
    const cached = discoveryCache.get(network);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.metadata;
    }
  }
  
  // Fetch discovery document
  const baseUrl = getAgentPayBaseUrl(network);
  const discoveryUrl = `${baseUrl}${WELL_KNOWN_OIDC_PATH}`;
  
  const response = await fetchFn(discoveryUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to discover Agent Pay endpoints for ${network}: ${response.status} ${response.statusText}`
    );
  }
  
  const metadata = await response.json() as AgentPayDiscoveryMetadata;
  
  // Validate required fields
  if (!metadata.issuer || !metadata.jwks_uri || !metadata.payment_endpoint) {
    throw new Error(
      `Invalid discovery metadata for ${network}: missing required fields`
    );
  }
  
  // Cache for 24 hours
  discoveryCache.set(network, {
    metadata,
    expiresAt: Date.now() + (24 * 60 * 60 * 1000)
  });
  
  return metadata;
}

/**
 * Fetch Agent Pay's public keys (JWKS) for signature verification
 * 
 * @param network - Network identifier (e.g., 'aws:base')
 * @param options - Fetch options
 * @returns JSON Web Key Set
 * 
 * @example
 * ```typescript
 * const jwks = await fetchAgentPayPublicKeys('aws:base');
 * // Use with jose library to verify signatures
 * ```
 */
export async function fetchAgentPayPublicKeys(
  network: string,
  options: {
    /** Skip cache and force fresh fetch */
    skipCache?: boolean;
    /** Custom fetch function (for testing) */
    fetch?: typeof globalThis.fetch;
  } = {}
): Promise<any> {
  const fetchFn = options.fetch || globalThis.fetch;
  
  // Get JWKS URI from discovery
  const metadata = await discoverAgentPayEndpoints(network, options);
  const jwksUri = metadata.jwks_uri;
  
  // Check cache
  if (!options.skipCache) {
    const cached = jwksCache.get(jwksUri);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.jwks;
    }
  }
  
  // Fetch JWKS
  const response = await fetchFn(jwksUri);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch Agent Pay public keys from ${jwksUri}: ${response.status} ${response.statusText}`
    );
  }
  
  const jwks = await response.json();
  
  // Cache for 1 hour (or use Cache-Control header if available)
  const cacheControl = response.headers.get('cache-control');
  let cacheDuration = 60 * 60 * 1000; // 1 hour default
  
  if (cacheControl) {
    const maxAge = /max-age=(\d+)/.exec(cacheControl);
    if (maxAge) {
      cacheDuration = parseInt(maxAge[1], 10) * 1000;
    }
  }
  
  jwksCache.set(jwksUri, {
    jwks,
    expiresAt: Date.now() + cacheDuration
  });
  
  return jwks;
}

/**
 * Clear discovery cache (useful for testing or error recovery)
 * 
 * @param network - Optional network identifier to clear specific entry
 */
export function clearDiscoveryCache(network?: string): void {
  if (network) {
    discoveryCache.delete(network);
  } else {
    discoveryCache.clear();
  }
}

/**
 * Clear JWKS cache (useful for testing or error recovery)
 * 
 * @param jwksUri - Optional JWKS URI to clear specific entry
 */
export function clearJWKSCache(jwksUri?: string): void {
  if (jwksUri) {
    jwksCache.delete(jwksUri);
  } else {
    jwksCache.clear();
  }
}
