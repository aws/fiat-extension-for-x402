// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Helper that registers the `exact` server scheme on an x402 resource server.
 */

import type { Network, SchemeNetworkServer } from '@x402/core/types';
import type { QuoteSigner } from '../../signers/protocol';
import { DEFAULT_NETWORK } from '../../constants';
import type { DPoPNonceStore } from '../../types';
import { ExactAgenticCommerceScheme } from './server';

/**
 * Options of {@link registerExactAgenticCommerceServer}
 */
export interface RegisterExactAgenticCommerceServerOptions {
  /** Signs quote tokens. */
  signer: QuoteSigner;
  /** Networks to register. Defaults to `['aws:base']`. */
  networks?: Network[];
  /**
   * Records DPoP proof `jti` values so a replayed proof is rejected. Use a store
   * shared by all instances of the seller.
   */
  dpopNonceStore?: DPoPNonceStore;
  /** Maximum age of a DPoP proof, in seconds. Defaults to 60. */
  dpopMaxAgeSeconds?: number;
}

/**
 * Register the `exact` server scheme on an x402 resource server.
 *
 * One scheme instance is registered for every network.
 *
 * @param server - An `x402ResourceServer`
 * @param options - The signer, the networks and the DPoP options
 * @returns `server`, for chaining
 *
 * @example
 * ```typescript
 * const server = registerExactAgenticCommerceServer(new x402ResourceServer(facilitatorClient), {
 *   signer: new KmsQuoteSigner({ keyArn, region, serviceUrl }),
 * });
 * ```
 */
export function registerExactAgenticCommerceServer<
  T extends { register(network: Network, server: SchemeNetworkServer): unknown },
>(server: T, options: RegisterExactAgenticCommerceServerOptions): T {
  const scheme = new ExactAgenticCommerceScheme({
    signer: options.signer,
    dpopNonceStore: options.dpopNonceStore,
    dpopMaxAgeSeconds: options.dpopMaxAgeSeconds,
  });
  // An empty list falls back to the default network.
  const networks = options.networks?.length ? options.networks : [DEFAULT_NETWORK as Network];
  for (const network of networks) {
    server.register(network, scheme);
  }
  return server;
}
