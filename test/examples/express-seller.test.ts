// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Smoke test of examples/express-seller: the app serves its JWKS and answers an
 * unpaid request with a 402 carrying a signed quote. It listens on an
 * ephemeral port on 127.0.0.1.
 */
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { x402Client, x402HTTPClient } from '@x402/core/client';
import * as jose from 'jose';
import { createSellerApp } from '../../examples/express-seller/app';
import { LocalQuoteSigner, SENTINEL_PAY_TO } from '../../src';
import { ecKey } from '../helpers/fake-payment-service';

const SERVICE_URL = 'https://seller.example.com';
const PRODUCT_ID = 'prod-example123';

let server: Server;
let baseUrl: string;
let signer: LocalQuoteSigner;

beforeAll(async () => {
  const { privateKey, jwk } = await ecKey('example-key');
  signer = new LocalQuoteSigner(privateKey, jwk, SERVICE_URL);
  server = createSellerApp({ signer, productId: PRODUCT_ID }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
});

describe('examples/express-seller', () => {
  it('serves the quote-signing public key at /.well-known/jwks.json', async () => {
    const response = await fetch(`${baseUrl}/.well-known/jwks.json`);
    expect(response.status).toBe(200);
    const jwks = (await response.json()) as { keys: jose.JWK[] };
    expect(jwks).toEqual({ keys: [signer.publicJwk] });
    expect(jwks.keys[0]).not.toHaveProperty('d');
  });

  it('does not run the paid handler for an unpaid HEAD request', async () => {
    const response = await fetch(`${baseUrl}/weather`, { method: 'HEAD' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
  });

  it('answers an unpaid request with a 402 carrying a quote signed by that key', async () => {
    const response = await fetch(`${baseUrl}/weather`);
    expect(response.status).toBe(402);
    const required = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse(
      (name) => response.headers.get(name),
      await response.json()
    );
    expect(required.accepts).toHaveLength(1);
    const [accepted] = required.accepts;
    expect(accepted).toMatchObject({
      scheme: 'exact',
      network: 'aws:base',
      payTo: SENTINEL_PAY_TO,
      amount: '0.01',
      asset: 'iso4217:USD',
    });
    const quoteToken = accepted.extra?.quoteToken;
    expect(typeof quoteToken).toBe('string');
    const { payload } = await jose.jwtVerify(
      quoteToken as string,
      await jose.importJWK(signer.publicJwk)
    );
    expect(payload).toMatchObject({
      iss: SERVICE_URL,
      payTo: PRODUCT_ID,
      settlement: { product_id: PRODUCT_ID },
    });
  });
});
