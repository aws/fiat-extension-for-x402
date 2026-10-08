// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
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

// Legacy convenience builders (still fully supported)
export { buildAgentPayResourceServer } from './resource-server-builder';
export type { AgentPayResourceServerConfig } from './resource-server-builder';

export { registerAgentPayNetworks } from './register';
