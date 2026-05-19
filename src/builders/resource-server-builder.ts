// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agent Pay Resource Server Builder
 *
 * Two-phase API: create a server, then register networks.
 * This separates construction from configuration and makes it easy
 * to extend later (e.g., register different networks with different options).
 *
 * Usage:
 *   const server = createAgentPayResourceServer({ ... });
 *   server.registerNetwork('aws:base');
 *   server.registerNetwork('eip155:8453');
 *   await server.initialize();
 *
 * Or use the convenience builder that does it all in one call:
 *   const server = await buildAgentPayResourceServer({ ... });
 */

import { x402ResourceServer } from '@x402/core/server';
import { HTTPFacilitatorClient } from '@x402/core/http';
import type { Network } from '@x402/core/types';
import { AgentPayScheme as AgentPayServerSchemeImpl } from '../agent-pay/server/scheme';
import { AgentPayFacilitatorClient } from '../agent-pay-facilitator-client';
import type { AgentPayFacilitatorAuthConfig } from '../agent-pay-facilitator-client';
import type { SigningKeysConfig } from '../config';
import { ValidationError } from '../types';

// ── Types ──────────────────────────────────────────────────────────

/**
 * Base configuration for creating a Agent Pay resource server.
 * Only includes identity and signing config — no routing concerns.
 */
export interface AgentPayResourceServerOptions {
  /** Agent Pay base URL for the Agent Pay facilitator */
  agentPayBaseUrl: string;
  /** Agent Pay ID for the Agent Pay facilitator */
  agentPayId: string;
  /** Service signing keys for quote tokens */
  signingKeys: SigningKeysConfig;
  /** Service URL (used as issuer in quote tokens) */
  serviceUrl: string;
  /** Optional: Agent Pay auth config for facilitator API calls */
  agentPayAuth?: AgentPayFacilitatorAuthConfig;
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
 * A Agent Pay resource server with a fluent `registerNetwork` API.
 * Call `initialize()` after registering all networks.
 */
export interface AgentPayResourceServer {
  /** Register a network for Agent Pay to handle. Returns `this` for chaining. */
  registerNetwork(network: Network, options?: NetworkOptions): AgentPayResourceServer;
  /** Initialize the server (fetches supported kinds from facilitators). */
  initialize(options?: InitializeOptions): Promise<x402ResourceServer>;
  /** The underlying x402ResourceServer (available before initialize for advanced use). */
  readonly server: x402ResourceServer;
}

/**
 * Legacy config shape — kept for backward compatibility with `buildAgentPayResourceServer`.
 */
export interface AgentPayResourceServerConfig {
  networks: Network[];
  agentPayBaseUrl: string;
  agentPayId: string;
  signingKeys: SigningKeysConfig;
  serviceUrl: string;
  agentPayAuth?: AgentPayFacilitatorAuthConfig;
  defaultFacilitatorUrl?: string;
  disableDefaultFallback?: boolean;
}

// ── Implementation ─────────────────────────────────────────────────

function validateBaseConfig(config: AgentPayResourceServerOptions): void {
  if (!config.agentPayBaseUrl) {
    throw new ValidationError('agentPayBaseUrl is required');
  }
  try {
    new URL(config.agentPayBaseUrl);
  } catch {
    throw new ValidationError(`Invalid agentPayBaseUrl: ${config.agentPayBaseUrl}`);
  }
  if (!config.signingKeys) {
    throw new ValidationError('signingKeys is required');
  }
  if (!config.serviceUrl) {
    throw new ValidationError('serviceUrl is required');
  }
}

/**
 * Create a Agent Pay resource server. Networks are registered separately
 * via `registerNetwork`, then `initialize()` wires up facilitator
 * routing and starts the server.
 *
 * Creation only captures identity/signing config. Routing decisions
 * (default fallback, custom facilitator URL) belong on `initialize()`.
 *
 * @example
 * ```typescript
 * const server = createAgentPayResourceServer({
 *   agentPayBaseUrl: 'https://pay.aws.amazon.com',
 *   agentPayId: 'my-agent-pay',
 *   signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
 *   serviceUrl: 'https://api.example.com',
 * });
 *
 * server.registerNetwork('aws:base');
 * server.registerNetwork('eip155:8453');
 *
 * const x402Server = await server.initialize();
 * ```
 */
export function createAgentPayResourceServer(
  config: AgentPayResourceServerOptions
): AgentPayResourceServer {
  validateBaseConfig(config);

  const registeredNetworks = new Set<Network>();
  const networkFilter = new Set<Network>();

  // Shared Agent Pay server scheme (stateless w.r.t. network)
  const apServerScheme = new AgentPayServerSchemeImpl({
    signingKeys: config.signingKeys,
    serviceUrl: config.serviceUrl,
  });

  // Agent Pay facilitator client — networkFilter is mutated by registerNetwork
  const apFacilitatorClient = new AgentPayFacilitatorClient(
    config.agentPayBaseUrl,
    config.agentPayAuth,
    networkFilter
  );

  let initialized = false;

  const self: AgentPayResourceServer = {
    // server is lazily built during initialize()
    get server() {
      return (self as any)._server;
    },

    registerNetwork(network: Network, _options?: NetworkOptions): AgentPayResourceServer {
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

      // Build facilitator client array: Agent Pay first (precedence), default second (fallback)
      const facilitatorClients: any[] = [apFacilitatorClient];

      if (!options?.disableDefaultFallback) {
        const defaultFacilitator = options?.defaultFacilitatorUrl
          ? new HTTPFacilitatorClient({ url: options.defaultFacilitatorUrl })
          : new HTTPFacilitatorClient();
        facilitatorClients.push(defaultFacilitator);
      }

      const server = new x402ResourceServer(facilitatorClients);

      // Register Agent Pay server scheme for each network
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
 * @param config - Agent Pay resource server configuration (includes networks)
 * @returns Initialized x402ResourceServer
 */
export async function buildAgentPayResourceServer(
  config: AgentPayResourceServerConfig
): Promise<x402ResourceServer> {
  if (!config.networks || config.networks.length === 0) {
    throw new ValidationError('networks must be a non-empty array');
  }

  const s = createAgentPayResourceServer({
    agentPayBaseUrl: config.agentPayBaseUrl,
    agentPayId: config.agentPayId,
    signingKeys: config.signingKeys,
    serviceUrl: config.serviceUrl,
    agentPayAuth: config.agentPayAuth,
  });

  for (const network of config.networks) {
    s.registerNetwork(network);
  }

  return s.initialize({
    defaultFacilitatorUrl: config.defaultFacilitatorUrl,
    disableDefaultFallback: config.disableDefaultFallback,
  });
}
