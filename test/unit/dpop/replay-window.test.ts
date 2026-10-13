// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The nonce store remembers a proof for as long as the same proof would still
 * pass the freshness check, so a store that forgets ids on time never lets a
 * proof be replayed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { verifyDPoPProof } from '../../../src/dpop/verification';
import { DPoPError, type DPoPNonceStore } from '../../../src/types';
import {
  BUYER_PUBLIC_JWK,
  buyerPrivateKey,
  DPOP_ATH,
  DPOP_HTU,
  FIXED_NOW,
  PAYMENT_TOKEN,
} from '../../helpers/fixed-vectors';

const CLOCK_SKEW = 5;
const IAT = FIXED_NOW;
const EXPECTED = { method: 'GET', url: DPOP_HTU, accessToken: PAYMENT_TOKEN };

/**
 * A store that forgets an id exactly at the expiry it was given: an id added
 * with `expiresAt` is seen while the time is before `expiresAt`, and not from
 * `expiresAt` on.
 */
class ExpiringNonceStore implements DPoPNonceStore {
  readonly expiries = new Map<string, number>();
  has(jti: string): boolean {
    const expiresAt = this.expiries.get(jti);
    return expiresAt !== undefined && Date.now() / 1000 < expiresAt;
  }
  add(jti: string, expiresAt: number): void {
    this.expiries.set(jti, expiresAt);
  }
}

let proof: string;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  proof = await new jose.SignJWT({
    jti: 'dpop-replay-window',
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

function at(seconds: number): void {
  vi.setSystemTime(seconds * 1000);
}

/** The message `verifyDPoPProof` rejects with, or `accepted` */
async function outcome(options: { maxAge?: number; nonceStore: DPoPNonceStore }): Promise<string> {
  try {
    await verifyDPoPProof(proof, { ...EXPECTED, ...options });
    return 'accepted';
  } catch (error) {
    if (!(error instanceof DPoPError)) throw error;
    return error.message;
  }
}

/** Every integer from `from` to `to`, both included */
function seconds(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

describe('verifyDPoPProof: replay window', () => {
  it.each([[undefined], [0], [1], [10], [60]])(
    'maxAge %j: every replay from iat to the end of the window is rejected',
    async (maxAge) => {
      const effectiveMaxAge = maxAge ?? 60;
      const lastAccepted = IAT + effectiveMaxAge + CLOCK_SKEW;
      const replays: Record<number, string> = {};
      for (const replayAt of seconds(IAT, lastAccepted + 1)) {
        const nonceStore = new ExpiringNonceStore();
        at(IAT);
        expect(await outcome({ maxAge, nonceStore })).toBe('accepted');
        at(replayAt);
        replays[replayAt - IAT] = await outcome({ maxAge, nonceStore });
      }
      const expected: Record<number, string> = {};
      for (const replayAt of seconds(IAT, lastAccepted)) {
        expected[replayAt - IAT] = 'DPoP proof replay detected';
      }
      expected[lastAccepted + 1 - IAT] = 'DPoP proof expired';
      expect(replays).toEqual(expected);
    }
  );

  it('rejects a replay at every later second, whichever second the proof was first used', async () => {
    const maxAge = 10;
    const firstAccepted = IAT - CLOCK_SKEW;
    const lastAccepted = IAT + maxAge + CLOCK_SKEW;
    const accepted: number[] = [];
    for (const firstUse of seconds(firstAccepted, lastAccepted)) {
      for (const replayAt of seconds(firstUse, lastAccepted + 1)) {
        const nonceStore = new ExpiringNonceStore();
        at(firstUse);
        expect(await outcome({ maxAge, nonceStore })).toBe('accepted');
        at(replayAt);
        if ((await outcome({ maxAge, nonceStore })) === 'accepted') {
          accepted.push(replayAt - firstUse);
        }
      }
    }
    expect(accepted).toEqual([]);
  });

  it('a first use at the last accepted second passes, and its replay in that second does not', async () => {
    const nonceStore = new ExpiringNonceStore();
    // 999 ms into the last second the freshness check still accepts.
    vi.setSystemTime((IAT + 60 + CLOCK_SKEW) * 1000 + 999);
    expect(await outcome({ nonceStore })).toBe('accepted');
    expect(await outcome({ nonceStore })).toBe('DPoP proof replay detected');
    // One second later the proof has expired, and the store may forget it.
    at(IAT + 60 + CLOCK_SKEW + 1);
    expect(nonceStore.has('dpop-replay-window')).toBe(false);
    expect(await outcome({ nonceStore })).toBe('DPoP proof expired');
  });

  it('a proof issued in the future is remembered until it expires', async () => {
    const nonceStore = new ExpiringNonceStore();
    at(IAT - CLOCK_SKEW);
    expect(await outcome({ nonceStore })).toBe('accepted');
    at(IAT + 60 + CLOCK_SKEW);
    expect(await outcome({ nonceStore })).toBe('DPoP proof replay detected');
  });

  it.each([
    [2.5, IAT + 7],
    [0.4, IAT + 5],
    [-2, IAT + 3],
  ])(
    'maxAge %j: the expiry is one second after the last accepted second',
    async (maxAge, lastAccepted) => {
      const nonceStore = new ExpiringNonceStore();
      at(lastAccepted);
      expect(await outcome({ maxAge, nonceStore })).toBe('accepted');
      expect(nonceStore.expiries.get('dpop-replay-window')).toBe(lastAccepted + 1);
      at(lastAccepted + 1);
      expect(await outcome({ maxAge, nonceStore: new ExpiringNonceStore() })).toBe(
        'DPoP proof expired'
      );
    }
  );
});
