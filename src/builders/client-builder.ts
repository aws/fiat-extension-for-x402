/**
 * FAB Client Builder
 *
 * Two-phase API: create a client, then register networks.
 *
 * Usage:
 *   const client = createFABClient({ ... });
 *   client.registerNetwork('fab:aws');
 *   client.registerNetwork('eip155:8453');
 *
 * Or use the convenience builder:
 *   const client = buildFABClient({ ... });
 */

import { x402Client } from '@x402/core/client';
import type { Network } from '@x402/core/types';
import { FABScheme as FABClientScheme } from '../fab/client/scheme';
import type { AuthConfig } from '../auth/types';
import type { DPoPKeyPair } from '../types';
import { ValidationError } from '../types';

// ── Types ──────────────────────────────────────────────────────────

/**
 * Base configuration for creating a FAB client.
 * Does not include networks — those are added via `registerNetwork`.
 */
export interface FABClientOptions {
  /** Wallet base URL */
  walletBaseUrl: string;
  /** Wallet ID */
  walletId: string;
  /** Optional: wallet auth config */
  walletAuth?: AuthConfig;
  /** Optional: DPoP configuration */
  dpop?: { keyPair: DPoPKeyPair; enabled: boolean };
  /** Optional: existing x402Client to add FAB networks to */
  existingClient?: x402Client;
}

/**
 * A FAB client with a fluent `registerNetwork` API.
 */
export interface FABClient {
  /** Register a network for FAB to handle. Returns `this` for chaining. */
  registerNetwork(network: Network): FABClient;
  /** The underlying x402Client. */
  readonly client: x402Client;
  /** Shortcut: delegates to client.createPaymentPayload */
  createPaymentPayload: x402Client['createPaymentPayload'];
}

/**
 * Legacy config shape — kept for backward compatibility with `buildFABClient`.
 */
export interface FABClientConfig {
  fabNetworks: Network[];
  walletBaseUrl: string;
  walletId: string;
  walletAuth?: AuthConfig;
  dpop?: { keyPair: DPoPKeyPair; enabled: boolean };
  existingClient?: x402Client;
}

// ── Implementation ─────────────────────────────────────────────────

function validateClientConfig(config: FABClientOptions): void {
  if (!config.walletBaseUrl) {
    throw new ValidationError('walletBaseUrl is required');
  }
  try {
    new URL(config.walletBaseUrl);
  } catch {
    throw new ValidationError(`Invalid walletBaseUrl: ${config.walletBaseUrl}`);
  }
}

/**
 * Create a FAB client. Networks are registered separately
 * via `registerNetwork`.
 *
 * @example
 * ```typescript
 * const client = createFABClient({
 *   walletBaseUrl: 'https://wallet.aws.com',
 *   walletId: 'my-wallet',
 *   walletAuth: { type: 'apiKey', apiKey: process.env.WALLET_API_KEY },
 * });
 *
 * client.registerNetwork('fab:aws');
 * client.registerNetwork('eip155:8453');
 *
 * const payload = await client.createPaymentPayload(paymentRequired);
 * ```
 */
export function createFABClient(config: FABClientOptions): FABClient {
  validateClientConfig(config);

  const x402 = config.existingClient ?? new x402Client();
  const registeredNetworks = new Set<Network>();

  // Single reusable scheme instance (stateless w.r.t. network)
  const fabClientScheme = new FABClientScheme({
    walletId: config.walletId,
    wallet: {
      baseUrl: config.walletBaseUrl,
      auth: config.walletAuth,
    },
  });

  const self: FABClient = {
    get client() {
      return x402;
    },

    registerNetwork(network: Network): FABClient {
      if (registeredNetworks.has(network)) {
        return self; // idempotent
      }
      registeredNetworks.add(network);
      x402.register(network, fabClientScheme);
      return self;
    },

    createPaymentPayload: x402.createPaymentPayload.bind(x402),
  };

  return self;
}

/**
 * Convenience builder that creates and registers networks in one call.
 *
 * @param config - FAB client configuration (includes fabNetworks)
 * @returns Configured x402Client
 */
export function buildFABClient(config: FABClientConfig): x402Client {
  if (!config.fabNetworks || config.fabNetworks.length === 0) {
    throw new ValidationError('fabNetworks must be a non-empty array');
  }

  const c = createFABClient({
    walletBaseUrl: config.walletBaseUrl,
    walletId: config.walletId,
    walletAuth: config.walletAuth,
    dpop: config.dpop,
    existingClient: config.existingClient,
  });

  for (const network of config.fabNetworks) {
    c.registerNetwork(network);
  }

  return c.client;
}
