// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import { x402Facilitator } from '@x402/core/facilitator';
import { InProcessFacilitatorClient } from '../../src/facilitator-client';
import { ExactAgenticCommerceScheme } from '../../src/agentic-commerce/exact/facilitator';
import { AgenticCommerceVerifier } from '../../src/agentic-commerce/verifier';

function scheme() {
  return new ExactAgenticCommerceScheme({
    verifier: new AgenticCommerceVerifier({
      sellerKeyResolver: { type: 'jwks', jwksUrl: 'https://seller.example.com' },
    }),
  });
}

describe('InProcessFacilitatorClient', () => {
  it('wraps an x402 facilitator with the exact Agentic Commerce scheme', async () => {
    const facilitator = new x402Facilitator().register('aws:base', scheme());
    const client = new InProcessFacilitatorClient(facilitator);

    const supported = await client.getSupported();
    expect(supported.kinds.map((kind) => [kind.scheme, kind.network])).toEqual([
      ['exact', 'aws:base'],
    ]);
  });

  it('serves several networks from one scheme', async () => {
    const facilitator = new x402Facilitator().register(['aws:base', 'aws:test'], scheme());
    const supported = await new InProcessFacilitatorClient(facilitator).getSupported();
    expect(supported.kinds.map((kind) => kind.network)).toEqual(['aws:base', 'aws:test']);
  });
});
