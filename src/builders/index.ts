/**
 * FAB Builder exports
 */

// New two-phase API
export { createFABResourceServer } from './resource-server-builder';
export type {
  FABResourceServerOptions,
  FABResourceServer,
  NetworkOptions,
  InitializeOptions,
} from './resource-server-builder';

export { createFABClient } from './client-builder';
export type { FABClientOptions, FABClient } from './client-builder';

// Legacy convenience builders (still fully supported)
export { buildFABResourceServer } from './resource-server-builder';
export type { FABResourceServerConfig } from './resource-server-builder';

export { buildFABClient } from './client-builder';
export type { FABClientConfig } from './client-builder';

export { registerFABNetworks } from './register';
