// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The local signers send the public JWK's `kid` as the JWS `kid` header, as the
 * Python SDK's LocalQuoteSigner does (signers/local.py:123 at commit 62230e6),
 * and send no `kid` header when the JWK has none.
 */

import { describe, expect, it } from 'vitest';
import * as jose from 'jose';
import { toPaymentTokenSigner, toQuoteSigner } from '../../../src/signers/protocol';
import type { PaymentTokenPayload, QuoteTokenPayload } from '../../../src/types';

const quote = { iss: 'https://seller.example.com' } as unknown as QuoteTokenPayload;
const payment = { iss: 'awsmp-agentpay.amazonaws.com' } as unknown as PaymentTokenPayload;

async function keyPair(kid?: string) {
  const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
  const jwk = await jose.exportJWK(publicKey);
  return { privateKey, jwk: kid === undefined ? jwk : { ...jwk, kid } };
}

describe('toQuoteSigner kid header', () => {
  it('sends the JWK kid', async () => {
    const { privateKey, jwk } = await keyPair('seller-key-2');
    const token = await toQuoteSigner(privateKey, jwk, 'https://seller.example.com').signQuote(
      quote
    );
    expect(jose.decodeProtectedHeader(token)).toEqual({
      alg: 'ES256',
      typ: 'JWT',
      kid: 'seller-key-2',
    });
  });

  it('sends no kid when the JWK has none', async () => {
    const { privateKey, jwk } = await keyPair();
    const token = await toQuoteSigner(privateKey, jwk, 'https://seller.example.com').signQuote(
      quote
    );
    const header = jose.decodeProtectedHeader(token);
    expect(Object.hasOwn(header, 'kid')).toBe(false);
    expect(header).toEqual({ alg: 'ES256', typ: 'JWT' });
  });
});

describe('toPaymentTokenSigner kid header', () => {
  it('sends the JWK kid', async () => {
    const { privateKey, jwk } = await keyPair('service-key');
    const token = await toPaymentTokenSigner(privateKey, jwk, 'id').signPayment(payment);
    expect(jose.decodeProtectedHeader(token).kid).toBe('service-key');
  });

  it('sends no kid when the JWK has none', async () => {
    const { privateKey, jwk } = await keyPair();
    const token = await toPaymentTokenSigner(privateKey, jwk, 'id').signPayment(payment);
    expect(Object.hasOwn(jose.decodeProtectedHeader(token), 'kid')).toBe(false);
  });
});
