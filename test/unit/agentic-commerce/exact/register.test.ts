// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { x402ResourceServer } from '@x402/core/server';
import type { Network, SchemeNetworkServer } from '@x402/core/types';
import { registerExactAgenticCommerceServer } from '../../../../src/agentic-commerce/exact/register';
import { ExactAgenticCommerceScheme } from '../../../../src/agentic-commerce/exact/server';
import * as exactEntry from '../../../../src/agentic-commerce/exact';
import * as root from '../../../../src/index';

// registerExactAgenticCommerceServer: the networks and scheme it registers.

const signer = {
  signQuote: async () => 'signed-quote',
  getPublicKey: () => ({}),
  getServiceUrl: () => 'https://seller.example.com',
};

function recordingServer() {
  const registered: [Network, SchemeNetworkServer][] = [];
  return {
    registered,
    register: vi.fn((network: Network, scheme: SchemeNetworkServer) => {
      registered.push([network, scheme]);
    }),
  };
}

describe('registerExactAgenticCommerceServer', () => {
  it('registers the exact scheme on aws:base by default and returns the server', () => {
    const server = recordingServer();
    expect(registerExactAgenticCommerceServer(server, { signer })).toBe(server);

    expect(server.registered).toHaveLength(1);
    const [[network, scheme]] = server.registered;
    expect(network).toBe('aws:base');
    expect(scheme).toBeInstanceOf(ExactAgenticCommerceScheme);
    expect(scheme.scheme).toBe('exact');
  });

  it('falls back to aws:base for an empty network list', () => {
    const server = recordingServer();
    registerExactAgenticCommerceServer(server, { signer, networks: [] });
    expect(server.registered.map(([network]) => network)).toEqual(['aws:base']);
  });

  it('registers one scheme instance on every given network', () => {
    const server = recordingServer();
    registerExactAgenticCommerceServer(server, { signer, networks: ['aws:base', 'aws:test'] });

    expect(server.registered.map(([network]) => network)).toEqual(['aws:base', 'aws:test']);
    expect(server.registered[0][1]).toBe(server.registered[1][1]);
  });

  it('registers on a stock x402ResourceServer', () => {
    const server = registerExactAgenticCommerceServer(new x402ResourceServer(), {
      signer,
      networks: ['aws:base', 'aws:test'],
    });
    expect(server.hasRegisteredScheme('aws:base', 'exact')).toBe(true);
    expect(server.hasRegisteredScheme('aws:test', 'exact')).toBe(true);
    expect(server.hasRegisteredScheme('aws:other', 'exact')).toBe(false);
  });

  it('rejects a missing signer', () => {
    expect(() => registerExactAgenticCommerceServer(recordingServer(), {} as never)).toThrow(
      'ExactAgenticCommerceServerScheme requires a signer'
    );
  });
});

describe('exact exports', () => {
  it('exports the scheme and the helper from the exact entry point and the root', () => {
    for (const entry of [exactEntry, root]) {
      expect(entry.ExactAgenticCommerceServerScheme).toBe(ExactAgenticCommerceScheme);
      expect(entry.registerExactAgenticCommerceServer).toBe(registerExactAgenticCommerceServer);
    }
    expect(Object.keys(exactEntry).sort()).toEqual([
      'ExactAgenticCommerceFacilitatorScheme',
      'ExactAgenticCommerceServerScheme',
      'registerExactAgenticCommerceServer',
    ]);
  });
});
