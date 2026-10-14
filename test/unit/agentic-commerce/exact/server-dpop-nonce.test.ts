// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * When the exact server scheme records a DPoP proof id in the nonce store.
 *
 * The payment token is read unverified before the facilitator runs, so anyone
 * can bind a forged token to their own key and sign a valid proof for it. The
 * proof id is recorded only once the facilitator has accepted the token, so a
 * forged token never adds a store entry. Driven through a stock
 * x402ResourceServer, as the framework middlewares do.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeJwt } from 'jose';
import { x402ResourceServer, type HTTPAdapter } from '@x402/core/server';
import type { FacilitatorClient } from '@x402/core/http';
import type { PaymentRequirements, VerifyResponse } from '@x402/core/types';
import { ExactAgenticCommerceScheme } from '../../../../src/agentic-commerce/exact/server';
import type { DPoPNonceStore } from '../../../../src/types';
import { createDPoPProof, generateDPoPKeyPair, type DPoPKeyPair } from '../../../helpers/dpop';
import { FakePaymentService, SELLER_URL } from '../../../helpers/fake-payment-service';

const URL = `${SELLER_URL}/weather`;

const signer = {
  signQuote: () => Promise.resolve('signed-quote'),
  getPublicKey: () => ({}),
  getServiceUrl: () => SELLER_URL,
};

const requirements: PaymentRequirements = {
  scheme: 'exact',
  network: 'aws:base',
  asset: 'iso4217:USD',
  amount: '0.10',
  payTo: 'prod-weather',
  maxTimeoutSeconds: 300,
  extra: {},
};

/** A synchronous store that records every `add` */
class RecordingNonceStore implements DPoPNonceStore {
  readonly added: string[] = [];
  has(jti: string): boolean {
    return this.added.includes(jti);
  }
  add(jti: string): void {
    this.added.push(jti);
  }
}

function httpAdapter(headers: Record<string, string>): HTTPAdapter {
  return {
    getHeader: (name) => headers[name],
    getMethod: () => 'GET',
    getPath: () => '/weather',
    getUrl: () => URL,
    getAcceptHeader: () => 'application/json',
    getUserAgent: () => 'TestClient/1.0',
  };
}

async function server(store: DPoPNonceStore, verifyResult: VerifyResponse | Error) {
  const verify = vi.fn(() =>
    verifyResult instanceof Error ? Promise.reject(verifyResult) : Promise.resolve(verifyResult)
  );
  const facilitator: FacilitatorClient = {
    verify,
    settle: vi.fn(),
    getSupported: () =>
      Promise.resolve({
        kinds: [{ x402Version: 2, scheme: 'exact', network: 'aws:base' }],
        extensions: [],
        signers: {},
      }),
  };
  const resourceServer = new x402ResourceServer(facilitator).register(
    'aws:base',
    new ExactAgenticCommerceScheme({ signer, dpopNonceStore: store })
  );
  await resourceServer.initialize();
  return { resourceServer, verify };
}

function pay(resourceServer: x402ResourceServer, token: string, proof: string) {
  return resourceServer.verifyPayment(
    { x402Version: 2, accepted: requirements, payload: { paymentToken: token } },
    requirements,
    {},
    { request: { adapter: httpAdapter({ DPoP: proof }), path: '/weather', method: 'GET' } }
  );
}

let key: DPoPKeyPair;
let forged: string;

beforeEach(async () => {
  // Signed by a payment service the seller does not trust, bound to the
  // attacker's own DPoP key.
  key = await generateDPoPKeyPair('ES256');
  forged = await (await FakePaymentService.create()).issue('quote', { dpopJwk: key.publicKey });
});

const proofFor = (token: string) =>
  createDPoPProof(key, { method: 'GET', url: URL, accessToken: token });

describe('the DPoP proof id is recorded only for a payment token the facilitator accepts', () => {
  it('a forged token with a valid proof adds nothing to the nonce store', async () => {
    const store = new RecordingNonceStore();
    const { resourceServer, verify } = await server(store, {
      isValid: false,
      invalidReason: 'invalid_signature',
    });
    const result = await pay(resourceServer, forged, await proofFor(forged));
    expect(result).toMatchObject({ isValid: false, invalidReason: 'invalid_signature' });
    expect(verify).toHaveBeenCalledOnce();
    expect(store.added).toEqual([]);
  });

  it('many forged tokens add nothing to the nonce store', async () => {
    const store = new RecordingNonceStore();
    const { resourceServer } = await server(store, {
      isValid: false,
      invalidReason: 'invalid_signature',
    });
    for (let i = 0; i < 20; i++) {
      await pay(resourceServer, forged, await proofFor(forged));
    }
    expect(store.added).toEqual([]);
  });

  it('a facilitator error adds nothing to the nonce store', async () => {
    const store = new RecordingNonceStore();
    const { resourceServer } = await server(store, new Error('facilitator down'));
    await expect(pay(resourceServer, forged, await proofFor(forged))).rejects.toThrow(
      'facilitator down'
    );
    expect(store.added).toEqual([]);
  });

  it('an accepted token records the proof id once, and a replay is then refused', async () => {
    const store = new RecordingNonceStore();
    const { resourceServer } = await server(store, { isValid: true });
    const proof = await proofFor(forged);
    expect(await pay(resourceServer, forged, proof)).toMatchObject({ isValid: true });
    expect(store.added).toHaveLength(1);
    expect(await pay(resourceServer, forged, proof)).toMatchObject({
      isValid: false,
      invalidReason: 'dpop_invalid',
    });
    expect(store.added).toHaveLength(1);
  });

  it('a store that records the id in has: a genuine payment passes once, a forged one leaves nothing', async () => {
    const seen = new Set<string>();
    const store: DPoPNonceStore = {
      // Records atomically, as a shared store would (for example SET NX).
      has: (jti) => seen.size !== seen.add(jti).size - 1,
      add: () => {},
    };
    const accepting = await server(store, { isValid: true });
    const proof = await proofFor(forged);
    expect(await pay(accepting.resourceServer, forged, proof)).toMatchObject({ isValid: true });
    expect(await pay(accepting.resourceServer, forged, proof)).toMatchObject({
      isValid: false,
      invalidReason: 'dpop_invalid',
    });
    seen.clear();
    const rejecting = await server(store, { isValid: false, invalidReason: 'invalid_signature' });
    await pay(rejecting.resourceServer, forged, await proofFor(forged));
    expect(seen.size).toBe(0);
  });

  it.each([
    ['accepted while the facilitator ends before', 65, true],
    ['refused when the facilitator ends at', 66, false],
  ])('a proof %s iat + 66, the second it stops being fresh', async (_name, end, valid) => {
    const store = new RecordingNonceStore();
    const proof = await proofFor(forged);
    const iat = decodeJwt(proof).iat as number;
    const { resourceServer, verify } = await server(store, { isValid: true });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime((iat + 65) * 1000); // Still fresh before the facilitator
      verify.mockImplementationOnce(() => {
        vi.setSystemTime((iat + end) * 1000);
        return Promise.resolve({ isValid: true });
      });
      const result = await pay(resourceServer, forged, proof);
      if (valid) {
        expect(result).toMatchObject({ isValid: true });
        expect(store.added).toHaveLength(1);
      } else {
        expect(result).toMatchObject({ isValid: false, invalidReason: 'dpop_invalid' });
        expect(store.added).toEqual([]);
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('a replay runs the seller hooks: its onAfterVerify, then onVerifiedPaymentCanceled', async () => {
    const store = new RecordingNonceStore();
    const { resourceServer } = await server(store, { isValid: true });
    const afterVerify = vi.fn((_context: { result: { isValid: boolean } }) => Promise.resolve());
    const canceled = vi.fn(() => Promise.resolve());
    resourceServer.onAfterVerify(afterVerify).onVerifiedPaymentCanceled(canceled);
    const proof = await proofFor(forged);
    await pay(resourceServer, forged, proof);
    expect(canceled).not.toHaveBeenCalled();
    expect(await pay(resourceServer, forged, proof)).toMatchObject({
      isValid: false,
      invalidReason: 'dpop_invalid',
    });
    expect(afterVerify).toHaveBeenCalledTimes(2);
    // The seller's own hook, which runs first, sees the replay as verified.
    expect(afterVerify.mock.lastCall?.[0].result.isValid).toBe(true);
    expect(canceled).toHaveBeenCalledOnce();
    expect(canceled).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'after_verify_aborted' })
    );
  });

  it('a transport context reused for a token that needs no proof records nothing', async () => {
    const store = new RecordingNonceStore();
    const s = new ExactAgenticCommerceScheme({ signer, dpopNonceStore: store });
    const transportContext = {
      request: { adapter: httpAdapter({ DPoP: await proofFor(forged) }) },
    };
    const contextFor = (token: string) => ({
      paymentPayload: { x402Version: 2, accepted: requirements, payload: { paymentToken: token } },
      requirements,
      declaredExtensions: {},
      transportContext,
    });
    // Checked, then abandoned before onAfterVerify (an extension aborted).
    expect(await s.schemeHooks.onBeforeVerify(contextFor(forged))).toBeUndefined();
    const unbound = await (await FakePaymentService.create()).issue('quote');
    const next = contextFor(unbound);
    expect(await s.schemeHooks.onBeforeVerify(next)).toBeUndefined();
    expect(
      await s.schemeHooks.onAfterVerify({ ...next, result: { isValid: true } })
    ).toBeUndefined();
    expect(store.added).toEqual([]);
  });

  it('a nonce store that fails refuses an accepted payment', async () => {
    const store: DPoPNonceStore = { has: () => Promise.reject(new Error('down')), add: () => {} };
    const { resourceServer } = await server(store, { isValid: true });
    expect(await pay(resourceServer, forged, await proofFor(forged))).toMatchObject({
      isValid: false,
      invalidReason: 'dpop_invalid',
    });
  });

  it('concurrent requests with one proof: only one is accepted with a synchronous store', async () => {
    const store = new RecordingNonceStore();
    const { resourceServer } = await server(store, { isValid: true });
    const proof = await proofFor(forged);
    const results = await Promise.all([1, 2, 3].map(() => pay(resourceServer, forged, proof)));
    expect(results.filter((result) => result.isValid)).toHaveLength(1);
    expect(results.filter((result) => !result.isValid)).toEqual([
      expect.objectContaining({ isValid: false, invalidReason: 'dpop_invalid' }),
      expect.objectContaining({ isValid: false, invalidReason: 'dpop_invalid' }),
    ]);
    expect(store.added).toHaveLength(1);
  });
});
