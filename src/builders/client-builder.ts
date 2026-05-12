/**
 * Agentic Pay Client Builder
 *
 * Two-phase API: create a client, then register networks.
 *
 * Usage:
 *   const client = createAgenticPayClient({ ... });
 *   client.registerNetwork('aws:marketplace');
 *   client.registerNetwork('eip155:8453');
 *
 * Or use the convenience builder:
 *   const client = buildAgenticPayClient({ ... });
 */

import { x402Client } from '@x402/core/client';
import type { Network } from '@x402/core/types';
import { AgenticPayScheme as AgenticPayClientSchemeImpl } from '../agentic-pay/client/scheme';
import type { AuthConfig } from '../auth/types';
import type { DPoPKeyPair } from '../types';
import { ValidationError } from '../types';

// ── Types ──────────────────────────────────────────────────────────

/**
 * Base configuration for creating a Agentic Pay client.
 * Does not include networks — those are added via `registerNetwork`.
 */
export interface AgenticPayClientOptions {
  /** Agentic Pay base URL */
  agenticPayBaseUrl: string;
  /** Agentic Pay ID */
  agenticPayId: string;
  /** Optional: Agentic Pay auth config */
  agenticPayAuth?: AuthConfig;
  /** Optional: DPoP configuration */
  dpop?: { keyPair: DPoPKeyPair; enabled: boolean };
  /** Optional: existing x402Client to add Agentic Pay networks to */
  existingClient?: x402Client;
}

/**
 * A Agentic Pay client with a fluent `registerNetwork` API.
 */
export interface AgenticPayClientBuilder {
  /** Register a network for Agentic Pay to handle. Returns `this` for chaining. */
  registerNetwork(network: Network): AgenticPayClientBuilder;
  /** The underlying x402Client. */
  readonly client: x402Client;
  /** Shortcut: delegates to client.createPaymentPayload */
  createPaymentPayload: x402Client['createPaymentPayload'];
}

/**
 * Legacy config shape — kept for backward compatibility with `buildAgenticPayClient`.
 */
export interface AgenticPayClientConfig {
  networks: Network[];
  agenticPayBaseUrl: string;
  agenticPayId: string;
  agenticPayAuth?: AuthConfig;
  dpop?: { keyPair: DPoPKeyPair; enabled: boolean };
  existingClient?: x402Client;
}

// ── Implementation ─────────────────────────────────────────────────

function validateClientConfig(config: AgenticPayClientOptions): void {
  if (!config.agenticPayBaseUrl) {
    throw new ValidationError('agenticPayBaseUrl is required');
  }
  try {
    new URL(config.agenticPayBaseUrl);
  } catch {
    throw new ValidationError(`Invalid agenticPayBaseUrl: ${config.agenticPayBaseUrl}`);
  }
}

/**
 * Create a Agentic Pay client. Networks are registered separately
 * via `registerNetwork`.
 *
 * @example
 * ```typescript
 * const client = createAgenticPayClient({
 *   agenticPayBaseUrl: 'https://pay.aws.amazon.com',
 *   agenticPayId: 'my-agentic-pay',
 *   agenticPayAuth: { type: 'apiKey', apiKey: process.env.AGENTIC_PAY_API_KEY },
 * });
 *
 * client.registerNetwork('aws:marketplace');
 * client.registerNetwork('eip155:8453');
 *
 * const payload = await client.createPaymentPayload(paymentRequired);
 * ```
 */
export function createAgenticPayClient(config: AgenticPayClientOptions): AgenticPayClientBuilder {
  validateClientConfig(config);

  const x402 = config.existingClient ?? new x402Client();
  const registeredNetworks = new Set<Network>();

  // Single reusable scheme instance (stateless w.r.t. network)
  const apClientScheme = new AgenticPayClientSchemeImpl({
    agenticPayId: config.agenticPayId,
    agenticPay: {
      baseUrl: config.agenticPayBaseUrl,
      auth: config.agenticPayAuth,
    },
  });

  const self: AgenticPayClientBuilder = {
    get client() {
      return x402;
    },

    registerNetwork(network: Network): AgenticPayClientBuilder {
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
 * @param config - Agentic Pay client configuration (includes networks)
 * @returns Configured x402Client
 */
export function buildAgenticPayClient(config: AgenticPayClientConfig): x402Client {
  if (!config.networks || config.networks.length === 0) {
    throw new ValidationError('networks must be a non-empty array');
  }

  const c = createAgenticPayClient({
    agenticPayBaseUrl: config.agenticPayBaseUrl,
    agenticPayId: config.agenticPayId,
    agenticPayAuth: config.agenticPayAuth,
    dpop: config.dpop,
    existingClient: config.existingClient,
  });

  for (const network of config.networks) {
    c.registerNetwork(network);
  }

  return c.client;
}
