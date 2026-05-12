/**
 * Agentic Pay Builder exports
 */

// New two-phase API
export { createAgenticPayResourceServer } from './resource-server-builder';
export type {
  AgenticPayResourceServerOptions,
  AgenticPayResourceServer,
  NetworkOptions,
  InitializeOptions,
} from './resource-server-builder';

export { createAgenticPayClient } from './client-builder';
export type { AgenticPayClientOptions, AgenticPayClientBuilder } from './client-builder';

// Legacy convenience builders (still fully supported)
export { buildAgenticPayResourceServer } from './resource-server-builder';
export type { AgenticPayResourceServerConfig } from './resource-server-builder';

export { buildAgenticPayClient } from './client-builder';
export type { AgenticPayClientConfig } from './client-builder';

export { registerAgenticPayNetworks } from './register';
