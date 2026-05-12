/**
 * Agentic Pay Resource Server Builder
 *
 * Two-phase API: create a server, then register networks.
 * This separates construction from configuration and makes it easy
 * to extend later (e.g., register different networks with different options).
 *
 * Usage:
 *   const server = createAgenticPayResourceServer({ ... });
 *   server.registerNetwork('aws:marketplace');
 *   server.registerNetwork('eip155:8453');
 *   await server.initialize();
 *
 * Or use the convenience builder that does it all in one call:
 *   const server = await buildAgenticPayResourceServer({ ... });
 */

import { x402ResourceServer } from '@x402/core/server';
import { HTTPFacilitatorClient } from '@x402/core/http';
import type { Network } from '@x402/core/types';
import { AgenticPayScheme as AgenticPayServerSchemeImpl } from '../agentic-pay/server/scheme';
import { AgenticPayFacilitatorClient } from '../agentic-pay-facilitator-client';
import type { AgenticPayFacilitatorAuthConfig } from '../agentic-pay-facilitator-client';
import type { SigningKeysConfig } from '../config';
import { ValidationError } from '../types';

// ── Types ──────────────────────────────────────────────────────────

/**
 * Base configuration for creating a Agentic Pay resource server.
 * Only includes identity and signing config — no routing concerns.
 */
export interface AgenticPayResourceServerOptions {
  /** Agentic Pay base URL for the Agentic Pay facilitator */
  agenticPayBaseUrl: string;
  /** Agentic Pay ID for the Agentic Pay facilitator */
  agenticPayId: string;
  /** Service signing keys for quote tokens */
  signingKeys: SigningKeysConfig;
  /** Service URL (used as issuer in quote tokens) */
  serviceUrl: string;
  /** Optional: Agentic Pay auth config for facilitator API calls */
  agenticPayAuth?: AgenticPayFacilitatorAuthConfig;
}

/**
 * Options passed to `initialize()` — controls facilitator routing.
 */
export interface InitializeOptions {
  /** Custom default facilitator URL (defaults to https://x402.org/facilitator) */
  defaultFacilitatorUrl?: string;
  /** Disable default facilitator fallback entirely */
  disableDefaultFallback?: boolean;
}

/**
 * Per-network options (reserved for future use).
 */
export interface NetworkOptions {
  /** Optional: override facilitator URL for this specific network */
  facilitatorUrl?: string;
}

/**
 * A Agentic Pay resource server with a fluent `registerNetwork` API.
 * Call `initialize()` after registering all networks.
 */
export interface AgenticPayResourceServer {
  /** Register a network for Agentic Pay to handle. Returns `this` for chaining. */
  registerNetwork(network: Network, options?: NetworkOptions): AgenticPayResourceServer;
  /** Initialize the server (fetches supported kinds from facilitators). */
  initialize(options?: InitializeOptions): Promise<x402ResourceServer>;
  /** The underlying x402ResourceServer (available before initialize for advanced use). */
  readonly server: x402ResourceServer;
}

/**
 * Legacy config shape — kept for backward compatibility with `buildAgenticPayResourceServer`.
 */
export interface AgenticPayResourceServerConfig {
  networks: Network[];
  agenticPayBaseUrl: string;
  agenticPayId: string;
  signingKeys: SigningKeysConfig;
  serviceUrl: string;
  agenticPayAuth?: AgenticPayFacilitatorAuthConfig;
  defaultFacilitatorUrl?: string;
  disableDefaultFallback?: boolean;
}

// ── Implementation ─────────────────────────────────────────────────

function validateBaseConfig(config: AgenticPayResourceServerOptions): void {
  if (!config.agenticPayBaseUrl) {
    throw new ValidationError('agenticPayBaseUrl is required');
  }
  try {
    new URL(config.agenticPayBaseUrl);
  } catch {
    throw new ValidationError(`Invalid agenticPayBaseUrl: ${config.agenticPayBaseUrl}`);
  }
  if (!config.signingKeys) {
    throw new ValidationError('signingKeys is required');
  }
  if (!config.serviceUrl) {
    throw new ValidationError('serviceUrl is required');
  }
}

/**
 * Create a Agentic Pay resource server. Networks are registered separately
 * via `registerNetwork`, then `initialize()` wires up facilitator
 * routing and starts the server.
 *
 * Creation only captures identity/signing config. Routing decisions
 * (default fallback, custom facilitator URL) belong on `initialize()`.
 *
 * @example
 * ```typescript
 * const server = createAgenticPayResourceServer({
 *   agenticPayBaseUrl: 'https://pay.aws.amazon.com',
 *   agenticPayId: 'my-agentic-pay',
 *   signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
 *   serviceUrl: 'https://api.example.com',
 * });
 *
 * server.registerNetwork('aws:marketplace');
 * server.registerNetwork('eip155:8453');
 *
 * const x402Server = await server.initialize();
 * ```
 */
export function createAgenticPayResourceServer(
  config: AgenticPayResourceServerOptions
): AgenticPayResourceServer {
  validateBaseConfig(config);

  const registeredNetworks = new Set<Network>();
  const networkFilter = new Set<Network>();

  // Shared Agentic Pay server scheme (stateless w.r.t. network)
  const apServerScheme = new AgenticPayServerSchemeImpl({
    signingKeys: config.signingKeys,
    serviceUrl: config.serviceUrl,
  });

  // Agentic Pay facilitator client — networkFilter is mutated by registerNetwork
  const apFacilitatorClient = new AgenticPayFacilitatorClient(
    config.agenticPayBaseUrl,
    config.agenticPayAuth,
    networkFilter
  );

  let initialized = false;

  const self: AgenticPayResourceServer = {
    // server is lazily built during initialize()
    get server() {
      return (self as any)._server;
    },

    registerNetwork(network: Network, _options?: NetworkOptions): AgenticPayResourceServer {
      if (initialized) {
        throw new ValidationError('Cannot register networks after initialize()');
      }
      if (registeredNetworks.has(network)) {
        return self; // idempotent
      }
      registeredNetworks.add(network);
      networkFilter.add(network);
      return self;
    },

    async initialize(options?: InitializeOptions): Promise<x402ResourceServer> {
      if (registeredNetworks.size === 0) {
        throw new ValidationError(
          'No networks registered. Call registerNetwork() before initialize().'
        );
      }

      // Build facilitator client array: Agentic Pay first (precedence), default second (fallback)
      const facilitatorClients: any[] = [apFacilitatorClient];

      if (!options?.disableDefaultFallback) {
        const defaultFacilitator = options?.defaultFacilitatorUrl
          ? new HTTPFacilitatorClient({ url: options.defaultFacilitatorUrl })
          : new HTTPFacilitatorClient();
        facilitatorClients.push(defaultFacilitator);
      }

      const server = new x402ResourceServer(facilitatorClients);

      // Register Agentic Pay server scheme for each network
      for (const network of registeredNetworks) {
        server.register(network, apServerScheme);
      }

      await server.initialize();
      initialized = true;
      (self as any)._server = server;
      return server;
    },
  };

  // Pre-set _server to undefined so .server doesn't throw before initialize
  (self as any)._server = undefined as any;

  return self;
}

/**
 * Convenience builder that creates, registers networks, and initializes
 * in one call.
 *
 * @param config - Agentic Pay resource server configuration (includes networks)
 * @returns Initialized x402ResourceServer
 */
export async function buildAgenticPayResourceServer(
  config: AgenticPayResourceServerConfig
): Promise<x402ResourceServer> {
  if (!config.networks || config.networks.length === 0) {
    throw new ValidationError('networks must be a non-empty array');
  }

  const s = createAgenticPayResourceServer({
    agenticPayBaseUrl: config.agenticPayBaseUrl,
    agenticPayId: config.agenticPayId,
    signingKeys: config.signingKeys,
    serviceUrl: config.serviceUrl,
    agenticPayAuth: config.agenticPayAuth,
  });

  for (const network of config.networks) {
    s.registerNetwork(network);
  }

  return s.initialize({
    defaultFacilitatorUrl: config.defaultFacilitatorUrl,
    disableDefaultFallback: config.disableDefaultFallback,
  });
}
