// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Starts the Express seller of app.ts.
 *
 * Environment:
 * - SELLER_KEY_FILE: path to the quote-signing private key (PEM). Keep it out
 *   of source control; mount it from a secrets manager.
 * - SELLER_KEY_PASSWORD: the PEM's password, if it is encrypted (optional).
 * - SELLER_KEY_ID: the key's `kid`, for example quote-key-2026-10.
 * - SELLER_SERVICE_URL: your public URL, the quote token's `iss`.
 * - SELLER_PRODUCT_ID: your AWS Marketplace product ID.
 * - TRUST_PROXY: Express's `trust proxy` setting, when a load balancer or
 *   proxy terminates TLS (for example `loopback` or `1`). With the proxy
 *   forwarding the original Host, the request URL the DPoP check sees is then
 *   the public https one (optional).
 * - PORT: the port to listen on (default 3000).
 */
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { LocalQuoteSigner, type FromPemOptions } from '@aws/fiat-extension-for-x402';
import { createSellerApp } from './app';
import { MemoryNonceStore } from './nonce-store';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name}`);
  }
  return value;
}

const pemOptions: FromPemOptions = {
  kid: required('SELLER_KEY_ID'),
  serviceUrl: required('SELLER_SERVICE_URL'),
  password: process.env.SELLER_KEY_PASSWORD || undefined, // an empty value means none
};
const signer = LocalQuoteSigner.fromPem(readFileSync(required('SELLER_KEY_FILE')), pemOptions);

const app = createSellerApp({
  signer,
  productId: required('SELLER_PRODUCT_ID'),
  dpopNonceStore: new MemoryNonceStore(),
});
const trustProxy = process.env.TRUST_PROXY;
if (trustProxy) {
  // A number is a hop count, true or false a switch; anything else is a list
  // of addresses or names.
  const parsed =
    trustProxy === 'true'
      ? true
      : trustProxy === 'false'
        ? false
        : /^\d+$/.test(trustProxy)
          ? Number(trustProxy)
          : trustProxy;
  app.set('trust proxy', parsed);
}
const server = app.listen(Number(process.env.PORT || 3000), () => {
  console.log(`Seller listening on port ${(server.address() as AddressInfo).port}`);
});
