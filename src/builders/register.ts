/**
 * FAB Network Registration Helper
 *
 * Lower-level helper for registering FAB server schemes on an existing
 * x402ResourceServer without modifying facilitator client configuration.
 */

import { x402ResourceServer } from '@x402/core/server';
import type { Network } from '@x402/core/types';
import { FABScheme as FABServerScheme } from '../fab/server/scheme';
import type { SigningKeysConfig } from '../config';
import { ValidationError } from '../types';

/**
 * Register FAB server schemes for the specified networks on an existing
 * x402ResourceServer. A single FABServerScheme instance is reused across
 * all networks.
 *
 * This does NOT handle facilitator client setup — use `buildFABResourceServer`
 * for a fully configured server with facilitator routing.
 *
 * @param server - Existing x402ResourceServer to register schemes on
 * @param networks - Networks to register FAB for
 * @param config - Signing keys and service URL
 * @returns The same x402ResourceServer for chaining
 *
 * @example
 * ```typescript
 * const server = new x402ResourceServer(myFacilitatorClient);
 * registerFABNetworks(server, ['fab:aws', 'eip155:8453'], {
 *   signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
 *   serviceUrl: 'https://api.example.com',
 * });
 * ```
 */
export function registerFABNetworks(
  server: x402ResourceServer,
  networks: Network[],
  config: { signingKeys: SigningKeysConfig; serviceUrl: string }
): x402ResourceServer {
  if (!networks || networks.length === 0) {
    throw new ValidationError('networks must be a non-empty array');
  }

  const fabServerScheme = new FABServerScheme({
    signingKeys: config.signingKeys,
    serviceUrl: config.serviceUrl,
  });

  for (const network of networks) {
    server.register(network, fabServerScheme);
  }

  return server;
}
