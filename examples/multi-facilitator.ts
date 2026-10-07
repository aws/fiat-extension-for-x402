// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Multi-Facilitator Example
 *
 * Demonstrates the two-phase API: create a server/client, then register
 * networks individually. Agent Pay handles registered networks while the default
 * x402 facilitator handles everything else.
 *
 * In this example:
 * - aws:base and eip155:8453 are handled by Agent Pay (via the Agent Pay provider)
 * - solana:mainnet would fall back to the official x402 facilitator
 *
 * This is the recommended pattern for services that want to accept
 * both Agent Pay and native crypto payments.
 */

import * as jose from 'jose';
import { createAgentPayResourceServer, createAgentPayClient } from '../src/index';

async function main() {
  console.log('🔀 Multi-Facilitator Example (Two-Phase API)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Generate service signing keys
  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  const publicJWK = await jose.exportJWK(publicKey);

  // ── Server Side ──────────────────────────────────────────────────
  //
  // createAgentPayResourceServer returns an object with a registerNetwork method.
  // Networks are added individually, then initialize() is called.
  //
  // This separates construction from configuration:
  //   1. Create the server with base config (Agent Pay, keys, service URL)
  //   2. Register networks one at a time (or chained)
  //   3. Initialize to fetch supported kinds from facilitators
  //
  // The Agent Pay facilitator is first in the array, so it takes precedence
  // for the networks it claims. The default facilitator fills in the rest.

  console.log('Server: Creating Agent Pay resource server...');

  const apServer = createAgentPayResourceServer({
    agentPayBaseUrl: 'https://pay.example.com',
    agentPayId: 'my-agent-pay',
    signingKeys: {
      privateKey,
      publicKey: publicJWK,
      alg: 'RS256',
    },
    serviceUrl: 'https://api.example.com',
  });

  // Register networks — can be chained
  apServer
    .registerNetwork('aws:base')
    .registerNetwork('eip155:8453');

  console.log('Server: Registered aws:base and eip155:8453');
  console.log('Server: Default facilitator handles solana:mainnet, etc.');
  console.log('');

  try {
    // Routing decisions go in initialize().
    // In production, leave disableDefaultFallback false (the default)
    // so non-Agent-Pay networks fall back to the official facilitator.
    const server = await apServer.initialize();
    console.log('✓ Server initialized with multi-facilitator routing');
    console.log(`  aws:base       → Agent Pay facilitator (Agent Pay)`);
    console.log(`  eip155:8453   → Agent Pay facilitator (Agent Pay)`);
    console.log(`  solana:*      → default x402 facilitator`);
    console.log('');
  } catch (error) {
    // Expected in this example since we don't have real Agent Pay/facilitator endpoints
    console.log('⚠️  Server init failed (expected — no real endpoints in this demo)');
    console.log(`   ${error instanceof Error ? error.message : error}`);
    console.log('');
  }

  // ── Client Side ──────────────────────────────────────────────────
  //
  // createAgentPayClient returns an object with a registerNetwork method.
  // The client only needs schemes for networks it can pay on.

  console.log('Client: Creating Agent Pay client...');

  const apClient = createAgentPayClient({
    agentPayBaseUrl: 'https://pay.example.com',
    agentPayId: 'user-agent-pay-123',
    agentPayAuth: {
      type: 'apiKey',
      apiKey: 'my-api-key',
    },
  });

  // Register networks
  apClient
    .registerNetwork('aws:base')
    .registerNetwork('eip155:8453');

  console.log('✓ Client initialized');
  console.log(`  Can pay on: aws:base, eip155:8453`);
  console.log(`  Cannot pay on: solana:mainnet (no scheme registered)`);
  console.log('');

  // The underlying x402Client is available via .client
  const client = apClient.client;
  console.log(`  x402Client instance: ${client.constructor.name}`);
  console.log('');

  // ── How Precedence Works ─────────────────────────────────────────
  //
  // During server.initialize(), the x402ResourceServer calls getSupported()
  // on each facilitator client in order:
  //
  //   1. AgentPayFacilitatorClient (Agent Pay) → claims aws:base, eip155:8453
  //   2. HTTPFacilitatorClient (default) → claims solana:mainnet, etc.
  //
  // The first facilitator to claim a (version, network, scheme) tuple wins.
  // So Agent Pay always handles its registered networks, and the default
  // facilitator handles everything else.
  //
  // The networkFilter on AgentPayFacilitatorClient ensures Agent Pay
  // only claims the networks you explicitly registered, even if Agent Pay
  // itself supports more networks.

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Done. See source code for detailed comments.');
}

main().catch(console.error);
