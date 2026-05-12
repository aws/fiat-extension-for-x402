/**
 * Agent Pay Builder exports
 */

// New two-phase API
export { createAgentPayResourceServer } from './resource-server-builder';
export type {
  AgentPayResourceServerOptions,
  AgentPayResourceServer,
  NetworkOptions,
  InitializeOptions,
} from './resource-server-builder';

export { createAgentPayClient } from './client-builder';
export type { AgentPayClientOptions, AgentPayClientBuilder } from './client-builder';

// Legacy convenience builders (still fully supported)
export { buildAgentPayResourceServer } from './resource-server-builder';
export type { AgentPayResourceServerConfig } from './resource-server-builder';

export { buildAgentPayClient } from './client-builder';
export type { AgentPayClientConfig } from './client-builder';

export { registerAgentPayNetworks } from './register';
