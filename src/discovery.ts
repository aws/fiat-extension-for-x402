/**
 * Wallet Endpoint Discovery
 * 
 * Utilities for discovering wallet provider endpoints via OIDC discovery.
 */

/**
 * Wallet discovery metadata (OIDC Discovery response)
 */
export interface WalletDiscoveryMetadata {
  /** Wallet's canonical identifier (matches iss claim in Payment JWTs) */
  issuer: string;
  /** URL where services can fetch wallet's public keys */
  jwks_uri: string;
  /** URL where clients create payment transactions */
  payment_endpoint: string;
  /** URL template for capture endpoint */
  capture_endpoint: string;
  /** Settlement methods this wallet supports */
  supported_settlement_methods?: string[];
  /** Algorithms used to sign Payment JWTs */
  signing_alg_values_supported?: string[];
  /** Algorithms supported for DPoP proof JWTs */
  dpop_signing_alg_values_supported?: string[];
  /** Authentication methods accepted by payment endpoint */
  token_endpoint_auth_methods_supported?: string[];
  /** Grant types supported (FAB uses 'quote_token') */
  grant_types_supported?: string[];
}

/**
 * Cache for discovery metadata
 */
const discoveryCache = new Map<string, {
  metadata: WalletDiscoveryMetadata;
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
 * Register a network's wallet base URL
 * 
 * @param network - Network identifier (e.g., 'fab:aws')
 * @param baseUrl - Wallet base URL (e.g., 'https://wallet.aws.com')
 * 
 * @example
 * ```typescript
 * // Register AWS FAB network
 * registerNetwork('fab:aws', 'https://wallet.aws.com');
 * 
 * // Register custom FAB network
 * registerNetwork('fab:custom', 'https://custom-wallet.example.com');
 * 
 * // Register internal FAB network
 * registerNetwork('fab:internal', 'https://internal-wallet.corp.com');
 * ```
 */
export function registerNetwork(network: string, baseUrl: string): void {
  // Validate network format
  const parts = network.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid network identifier format: ${network}`);
  }

  const [scheme, provider] = parts;

  if (scheme !== 'fab') {
    throw new Error(`Unsupported scheme: ${scheme}`);
  }

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
 * unregisterNetwork('fab:custom');
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
 * console.log(networks.get('fab:aws'));
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
 * Get wallet base URL from network identifier
 * 
 * Looks up the wallet base URL from the registry. If not found, throws an error.
 * You must register networks using registerNetwork() before calling this.
 * 
 * @param network - Network identifier (e.g., 'fab:aws')
 * @returns Wallet base URL
 * @throws Error if network identifier is invalid or not registered
 * 
 * @example
 * ```typescript
 * // Register first
 * registerNetwork('fab:aws', 'https://wallet.aws.com');
 * 
 * // Then get
 * const baseUrl = getWalletBaseUrl('fab:aws');
 * // → "https://wallet.aws.com"
 * ```
 */
export function getWalletBaseUrl(network: string): string {
  // Validate network format: scheme:provider
  const parts = network.split(':');
  if (parts.length !== 2) {
    throw new Error(`Invalid network identifier format: ${network}`);
  }

  const [scheme, provider] = parts;

  if (scheme !== 'fab') {
    throw new Error(`Unsupported scheme: ${scheme}`);
  }

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
 * Discover wallet endpoints via OIDC discovery
 * 
 * Fetches the wallet's OIDC discovery document to get endpoint URLs
 * and supported capabilities.
 * 
 * @param network - Network identifier (e.g., 'fab:aws')
 * @param options - Discovery options
 * @returns Wallet discovery metadata
 * 
 * @example
 * ```typescript
 * const metadata = await discoverWalletEndpoints('fab:aws');
 * console.log(metadata.payment_endpoint);
 * // → 'https://wallet.aws.com/v1/transactions'
 * ```
 */
export async function discoverWalletEndpoints(
  network: string,
  options: {
    /** Skip cache and force fresh fetch */
    skipCache?: boolean;
    /** Custom fetch function (for testing) */
    fetch?: typeof globalThis.fetch;
  } = {}
): Promise<WalletDiscoveryMetadata> {
  const fetchFn = options.fetch || globalThis.fetch;
  
  // Check cache
  if (!options.skipCache) {
    const cached = discoveryCache.get(network);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.metadata;
    }
  }
  
  // Fetch discovery document
  const baseUrl = getWalletBaseUrl(network);
  const discoveryUrl = `${baseUrl}/.well-known/openid-configuration`;
  
  const response = await fetchFn(discoveryUrl);
  if (!response.ok) {
    throw new Error(
      `Failed to discover wallet endpoints for ${network}: ${response.status} ${response.statusText}`
    );
  }
  
  const metadata = await response.json() as WalletDiscoveryMetadata;
  
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
 * Fetch wallet's public keys (JWKS) for signature verification
 * 
 * @param network - Network identifier (e.g., 'fab:aws')
 * @param options - Fetch options
 * @returns JSON Web Key Set
 * 
 * @example
 * ```typescript
 * const jwks = await fetchWalletPublicKeys('fab:aws');
 * // Use with jose library to verify signatures
 * ```
 */
export async function fetchWalletPublicKeys(
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
  const metadata = await discoverWalletEndpoints(network, options);
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
      `Failed to fetch wallet public keys from ${jwksUri}: ${response.status} ${response.statusText}`
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
