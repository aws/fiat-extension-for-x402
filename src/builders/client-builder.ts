// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Agent Pay Client Builder
 *
 * Two-phase API: create a client, then register networks.
 *
 * Usage:
 *   const client = createAgentPayClient({ ... });
 *   client.registerNetwork('aws:base');
 *   client.registerNetwork('eip155:8453');
 *
 * Or use the convenience builder:
 *   const client = buildAgentPayClient({ ... });
 */

import { x402Client } from '@x402/core/client';
import type { Network } from '@x402/core/types';
import { AgentPayScheme as AgentPayClientSchemeImpl } from '../agent-pay/client/scheme';
import type { AuthConfig } from '../auth/types';
import type { DPoPKeyPair } from '../types';
import { ValidationError } from '../types';

// ── Types ──────────────────────────────────────────────────────────

/**
 * Base configuration for creating a Agent Pay client.
 * Does not include networks — those are added via `registerNetwork`.
 */
export interface AgentPayClientOptions {
  /** Agent Pay base URL */
  agentPayBaseUrl: string;
  /** Agent Pay ID */
  agentPayId: string;
  /** Optional: Agent Pay auth config */
  agentPayAuth?: AuthConfig;
  /** Optional: DPoP configuration */
  dpop?: { keyPair: DPoPKeyPair; enabled: boolean };
  /** Optional: existing x402Client to add Agent Pay networks to */
  existingClient?: x402Client;
}

/**
 * A Agent Pay client with a fluent `registerNetwork` API.
 */
export interface AgentPayClientBuilder {
  /** Register a network for Agent Pay to handle. Returns `this` for chaining. */
  registerNetwork(network: Network): AgentPayClientBuilder;
  /** The underlying x402Client. */
  readonly client: x402Client;
  /** Shortcut: delegates to client.createPaymentPayload */
  createPaymentPayload: x402Client['createPaymentPayload'];
}

/**
 * Legacy config shape — kept for backward compatibility with `buildAgentPayClient`.
 */
export interface AgentPayClientConfig {
  networks: Network[];
  agentPayBaseUrl: string;
  agentPayId: string;
  agentPayAuth?: AuthConfig;
  dpop?: { keyPair: DPoPKeyPair; enabled: boolean };
  existingClient?: x402Client;
}

// ── Implementation ─────────────────────────────────────────────────

function validateClientConfig(config: AgentPayClientOptions): void {
  if (!config.agentPayBaseUrl) {
    throw new ValidationError('agentPayBaseUrl is required');
  }
  try {
    new URL(config.agentPayBaseUrl);
  } catch {
    throw new ValidationError(`Invalid agentPayBaseUrl: ${config.agentPayBaseUrl}`);
  }
}

/**
 * Create a Agent Pay client. Networks are registered separately
 * via `registerNetwork`.
 *
 * @example
 * ```typescript
 * const client = createAgentPayClient({
 *   agentPayBaseUrl: 'https://pay.aws.amazon.com',
 *   agentPayId: 'my-agent-pay',
 *   agentPayAuth: { type: 'apiKey', apiKey: process.env.AGENT_PAY_API_KEY },
 * });
 *
 * client.registerNetwork('aws:base');
 * client.registerNetwork('eip155:8453');
 *
 * const payload = await client.createPaymentPayload(paymentRequired);
 * ```
 */
export function createAgentPayClient(config: AgentPayClientOptions): AgentPayClientBuilder {
  validateClientConfig(config);

  const x402 = config.existingClient ?? new x402Client();
  const registeredNetworks = new Set<Network>();

  // Single reusable scheme instance (stateless w.r.t. network)
  const apClientScheme = new AgentPayClientSchemeImpl({
    agentPayId: config.agentPayId,
    agentPay: {
      baseUrl: config.agentPayBaseUrl,
      auth: config.agentPayAuth,
    },
  });

  const self: AgentPayClientBuilder = {
    get client() {
      return x402;
    },

    registerNetwork(network: Network): AgentPayClientBuilder {
      if (registeredNetworks.has(network)) {
        return self; // idempotent
      }
      registeredNetworks.add(network);
      x402.register(network, apClientScheme);
      return self;
    },

    createPaymentPayload: x402.createPaymentPayload.bind(x402),
  };

  return self;
}

/**
 * Convenience builder that creates and registers networks in one call.
 *
 * @param config - Agent Pay client configuration (includes networks)
 * @returns Configured x402Client
 */
export function buildAgentPayClient(config: AgentPayClientConfig): x402Client {
  if (!config.networks || config.networks.length === 0) {
    throw new ValidationError('networks must be a non-empty array');
  }

  const c = createAgentPayClient({
    agentPayBaseUrl: config.agentPayBaseUrl,
    agentPayId: config.agentPayId,
    agentPayAuth: config.agentPayAuth,
    dpop: config.dpop,
    existingClient: config.existingClient,
  });

  for (const network of config.networks) {
    c.registerNetwork(network);
  }

  return c.client;
}
