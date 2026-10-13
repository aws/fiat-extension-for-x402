// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The examples' in-memory DPoP nonce store, with the real verifyDPoPProof: a
 * proof is accepted once, and every replay is refused for as long as the same
 * proof would still be fresh. The Lambda example carries the same class.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { MemoryNonceStore } from '../../examples/express-seller/nonce-store';
import { DPoPError, verifyDPoPProof } from '../../src';
import {
  BUYER_PUBLIC_JWK,
  buyerPrivateKey,
  DPOP_ATH,
  DPOP_HTU,
  FIXED_NOW,
  PAYMENT_TOKEN,
} from '../helpers/fixed-vectors';

const IAT = FIXED_NOW;
const MAX_AGE = 60;
const EXPECTED = { method: 'GET', url: DPOP_HTU, accessToken: PAYMENT_TOKEN, maxAge: MAX_AGE };

let proof: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  proof = await new jose.SignJWT({
    jti: 'example-store',
    htm: 'GET',
    htu: DPOP_HTU,
    iat: IAT,
    ath: DPOP_ATH,
  })
    .setProtectedHeader({ alg: 'ES256', typ: 'dpop+jwt', jwk: BUYER_PUBLIC_JWK })
    .sign(buyerPrivateKey());
});

afterEach(() => {
  vi.useRealTimers();
});

async function outcome(store: MemoryNonceStore, atMs: number): Promise<string> {
  vi.setSystemTime(atMs);
  try {
    await verifyDPoPProof(proof, { ...EXPECTED, nonceStore: store });
    return 'accepted';
  } catch (error) {
    if (!(error instanceof DPoPError)) throw error;
    return error.message;
  }
}

describe('examples MemoryNonceStore', () => {
  // First use from the earliest accepted second; replays up to the last
  // millisecond of the last accepted second (iat + 65.999).
  for (const first of [IAT - 5, IAT, IAT + 65]) {
    it(`refuses every replay after a first use at iat${first - IAT >= 0 ? '+' : ''}${first - IAT}`, async () => {
      const store = new MemoryNonceStore();
      expect(await outcome(store, first * 1000)).toBe('accepted');
      for (let ms = first * 1000 + 500; ms < (IAT + 66) * 1000; ms += 500) {
        expect(await outcome(store, ms)).toBe('DPoP proof replay detected');
      }
      expect(await outcome(store, (IAT + 66) * 1000 - 1)).toBe('DPoP proof replay detected');
      expect(await outcome(store, (IAT + 66) * 1000)).toBe('DPoP proof expired');
    });
  }

  it('forgets an id from its expiresAt on, and prunes it', () => {
    const store = new MemoryNonceStore();
    vi.setSystemTime(IAT * 1000);
    store.add('a', IAT + 10);
    vi.setSystemTime((IAT + 10) * 1000 - 1);
    expect(store.has('a')).toBe(true);
    vi.setSystemTime((IAT + 10) * 1000);
    expect(store.has('a')).toBe(false);
    vi.setSystemTime((IAT + 100) * 1000);
    store.add('b', IAT + 200);
    expect((store as unknown as { seen: Map<string, number> }).seen.has('a')).toBe(false);
  });

  it('refuses new proofs when full of unexpired ids, and accepts again once they expire', () => {
    const store = new MemoryNonceStore();
    vi.setSystemTime(IAT * 1000);
    for (let i = 0; i < MemoryNonceStore.MAX_IDS; i++) store.add(`id-${i}`, IAT + 66);
    expect(store.has('new')).toBe(true);
    vi.setSystemTime((IAT + 66) * 1000);
    expect(store.has('new')).toBe(false);
  });

  it('is the same class in the Lambda example', () => {
    const body = (file: string) => {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8');
      const start = text.indexOf('class MemoryNonceStore implements DPoPNonceStore {');
      const end = text.indexOf('\n}\n', start);
      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      return text.slice(start, end);
    };
    expect(body('../../examples/lambda-seller/handler.ts')).toBe(
      body('../../examples/express-seller/nonce-store.ts')
    );
  });
});
