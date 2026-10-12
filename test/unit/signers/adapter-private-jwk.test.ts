// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * toQuoteSigner and toPaymentTokenSigner refuse a public JWK that carries
 * private key members (d, p, q, dp, dq, qi, oth, k), as LocalQuoteSigner does
 * (the Python SDK's PRIVATE_JWK_MEMBERS, signers/local.py:26 at 62230e6), so
 * getPublicKey() can never return private key material.
 */

import { describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import type { JWK } from 'jose';
import { toPaymentTokenSigner, toQuoteSigner } from '../../../src/signers/protocol';
import { ValidationError } from '../../../src/types';

const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const privateJwk = privateKey.export({ format: 'jwk' }) as JWK;
const { d: _d, ...publicJwk } = privateJwk;

describe.each([
  ['toQuoteSigner', toQuoteSigner],
  ['toPaymentTokenSigner', toPaymentTokenSigner],
] as const)('%s', (_name, adapt) => {
  it('refuses a whole private JWK', () => {
    expect(() => adapt(privateKey, privateJwk, 'id')).toThrow(ValidationError);
    expect(() => adapt(privateKey, privateJwk, 'id')).toThrow(
      "publicKey contains private key members: ['d']. Pass only the public key."
    );
  });

  it.each(['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth', 'k'])('refuses member %s', (member) => {
    expect(() => adapt(privateKey, { ...publicJwk, [member]: 'x' } as JWK, 'id')).toThrow(
      `publicKey contains private key members: ['${member}']`
    );
  });

  it('accepts the public JWK', () => {
    expect(adapt(privateKey, publicJwk as JWK, 'id').getPublicKey()).toEqual(publicJwk);
  });
});
