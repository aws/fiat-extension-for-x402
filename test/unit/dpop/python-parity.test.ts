// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * verifyDPoPProof and extractDPoPThumbprint against the Python SDK's
 * verify_dpop_proof and extract_dpop_thumbprint (dpop/verification.py:32-153
 * and tests/unit/dpop/test_proof_verification.py at commit 62230e6): the same
 * checks, in the same order, with the same messages.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as jose from 'jose';
import { extractDPoPThumbprint, verifyDPoPProof } from '../../../src/dpop/verification';
import { DPoPError, type DPoPNonceStore } from '../../../src/types';
import {
  BUYER_JKT,
  BUYER_PUBLIC_JWK,
  buyerPrivateKey,
  DPOP_ATH,
  DPOP_HTU,
  DPOP_PROOF,
  FIXED_NOW,
  PAYMENT_TOKEN,
} from '../../helpers/cross-language-fixtures';

const NOW = FIXED_NOW + 10;
const EXPECTED = { method: 'GET', url: DPOP_HTU, accessToken: PAYMENT_TOKEN };
const b64 = (value: unknown) => jose.base64url.encode(JSON.stringify(value));

let buyerKey: jose.KeyLike;

beforeEach(async () => {
  buyerKey = buyerPrivateKey();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW * 1000);
});

afterEach(() => {
  vi.useRealTimers();
});

/** A proof signed with the buyer key; `undefined` removes a claim or header member */
async function proof(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  key: jose.KeyLike | Uint8Array = buyerKey
): Promise<string> {
  return new jose.SignJWT({
    jti: 'dpop-test',
    htm: 'GET',
    htu: DPOP_HTU,
    iat: FIXED_NOW,
    ath: DPOP_ATH,
    ...claims,
  })
    .setProtectedHeader({
      alg: 'ES256',
      typ: 'dpop+jwt',
      jwk: BUYER_PUBLIC_JWK,
      ...header,
    } as jose.JWTHeaderParameters)
    .sign(key);
}

async function rejects(dpop: string, message: string, options: object = EXPECTED) {
  const error = await verifyDPoPProof(dpop, options as never).then(
    () => undefined,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(DPoPError);
  expect((error as Error).message).toBe(message);
}

describe('verifyDPoPProof: the cross-language fixture', () => {
  it('returns the claims of the Python-minted proof at FIXED_NOW+10', async () => {
    expect(await verifyDPoPProof(DPOP_PROOF, { ...EXPECTED, maxAge: 60 })).toEqual({
      jti: 'dpop-fixture-0001',
      htm: 'GET',
      htu: DPOP_HTU,
      iat: FIXED_NOW,
      ath: DPOP_ATH,
    });
  });

  it('extracts the buyer thumbprint, cnf.jkt of the fixture payment token', async () => {
    expect(await extractDPoPThumbprint(DPOP_PROOF)).toBe(BUYER_JKT);
    expect(jose.decodeJwt(PAYMENT_TOKEN).cnf).toEqual({ jkt: BUYER_JKT });
  });
});

describe('verifyDPoPProof: each check, with Python messages', () => {
  it('1. the header must decode', async () => {
    for (const bad of ['not-a-jwt', 'a.b', `${b64([1])}.e30.sig`]) {
      await rejects(bad, 'Invalid DPoP proof: cannot decode header');
    }
    await rejects(await proof({}, { kid: 7 }), 'Invalid DPoP proof: cannot decode header');
  });

  it('2. typ is dpop+jwt, compared in lower case', async () => {
    await rejects(
      await proof({}, { typ: 'JWT' }),
      "Invalid DPoP proof type: expected 'dpop+jwt', got 'JWT'"
    );
    await rejects(
      await proof({}, { typ: undefined }),
      "Invalid DPoP proof type: expected 'dpop+jwt', got ''"
    );
    expect(await verifyDPoPProof(await proof({}, { typ: 'DPOP+JWT' }), EXPECTED)).toBeTruthy();
  });

  it('3. the header has a jwk', async () => {
    await rejects(await proof({}, { jwk: undefined }), "DPoP proof header missing 'jwk'");
    await rejects(await proof({}, { jwk: {} }), "DPoP proof header missing 'jwk'");
  });

  it('4. alg is present and asymmetric: ES256/384/512, RS256 or PS256', async () => {
    const [, body, signature] = DPOP_PROOF.split('.');
    const header = { typ: 'dpop+jwt', jwk: BUYER_PUBLIC_JWK };
    await rejects(`${b64(header)}.${body}.${signature}`, "DPoP proof header missing 'alg'");
    await rejects(
      `${b64({ ...header, alg: 'none' })}.${body}.`,
      'DPoP proof algorithm not allowed: none'
    );
    const secret = new TextEncoder().encode('a-shared-secret-that-is-at-least-32-bytes');
    await rejects(
      await proof({}, { alg: 'HS256' }, secret),
      'DPoP proof algorithm not allowed: HS256'
    );
    await rejects(
      `${b64({ ...header, alg: 'EdDSA' })}.${body}.${signature}`,
      'DPoP proof algorithm not allowed: EdDSA'
    );
  });

  it('5. the signature verifies with the header jwk', async () => {
    const other = await jose.generateKeyPair('ES256');
    await rejects(
      await proof({}, {}, other.privateKey),
      'DPoP proof signature verification failed: Signature verification failed'
    );
    // PyJWT's remaining claim checks: nbf, and string sub and jti.
    await rejects(
      await proof({ nbf: NOW + 60 }),
      'DPoP proof signature verification failed: The token is not yet valid (nbf)'
    );
    await rejects(
      await proof({ jti: 7 }),
      'DPoP proof signature verification failed: JWT ID must be a string'
    );
    // exp is not checked (verify_exp=False).
    expect(await verifyDPoPProof(await proof({ exp: NOW - 60 }), EXPECTED)).toBeTruthy();
  });

  it('6. jti, htm, htu and iat are present and truthy', async () => {
    for (const claim of ['jti', 'htm', 'htu', 'iat']) {
      await rejects(await proof({ [claim]: undefined }), 'Missing required DPoP claims');
    }
    await rejects(await proof({ iat: 0 }), 'Missing required DPoP claims');
    await rejects(await proof({ jti: '' }), 'Missing required DPoP claims');
  });

  it('7. iat is at most 5 seconds ahead and at most maxAge + 5 seconds old', async () => {
    expect(await verifyDPoPProof(await proof({ iat: NOW + 5 }), EXPECTED)).toBeTruthy();
    await rejects(await proof({ iat: NOW + 6 }), 'DPoP proof issued in the future');
    expect(await verifyDPoPProof(await proof({ iat: NOW - 65 }), EXPECTED)).toBeTruthy();
    await rejects(await proof({ iat: NOW - 66 }), 'DPoP proof expired');
    await rejects(await proof({ iat: NOW - 16 }), 'DPoP proof expired', {
      ...EXPECTED,
      maxAge: 10,
    });
    // Python's int(): a numeric string is an integer; anything else is refused.
    expect(await verifyDPoPProof(await proof({ iat: String(FIXED_NOW) }), EXPECTED)).toBeTruthy();
    await rejects(await proof({ iat: 'soon' }), 'Invalid DPoP proof iat: soon');
  });

  it('8. htm equals the expected method exactly', async () => {
    await rejects(
      await proof({ htm: 'get' }),
      "DPoP proof htm mismatch: expected 'GET', got 'get'"
    );
    await rejects(
      await proof({ htm: 'POST' }),
      "DPoP proof htm mismatch: expected 'GET', got 'POST'"
    );
  });

  it('9. htu equals the expected URL exactly', async () => {
    for (const url of [`${DPOP_HTU}/`, 'https://SELLER.example.com/weather']) {
      await rejects(DPOP_PROOF, `DPoP proof htu mismatch: expected '${url}', got '${DPOP_HTU}'`, {
        ...EXPECTED,
        url,
      });
    }
  });

  it('skips the htm and htu checks when no method or URL is expected', async () => {
    const claims = await verifyDPoPProof(await proof({ htm: 'POST', htu: 'https://x.test/' }), {
      method: '',
      url: '',
      accessToken: PAYMENT_TOKEN,
    });
    expect(claims.htm).toBe('POST');
  });

  it('10. ath is the hash of the access token', async () => {
    const message = 'DPoP proof access token hash (ath) mismatch';
    await rejects(await proof({ ath: undefined }), message);
    await rejects(DPOP_PROOF, message, { ...EXPECTED, accessToken: 'another-token' });
    await rejects(DPOP_PROOF, message, { ...EXPECTED, accessToken: `${PAYMENT_TOKEN}é` });
    // Without an access token, ath is not checked.
    expect(await verifyDPoPProof(DPOP_PROOF, { method: 'GET', url: DPOP_HTU })).toBeTruthy();
  });

  it('11. the nonce store rejects a seen jti and records iat + maxAge', async () => {
    const seen = new Map<string, number>();
    const nonceStore: DPoPNonceStore = {
      has: async (jti) => seen.has(jti),
      add: async (jti, expiresAt) => void seen.set(jti, expiresAt),
    };
    await verifyDPoPProof(DPOP_PROOF, { ...EXPECTED, maxAge: 30, nonceStore });
    expect([...seen]).toEqual([['dpop-fixture-0001', FIXED_NOW + 30]]);
    await rejects(DPOP_PROOF, 'DPoP proof replay detected', { ...EXPECTED, nonceStore });
  });

  it('updates a synchronous store before anything else can run (no replay race)', async () => {
    // A microtask queued by has() runs before add() unless add() follows has()
    // with no await in between; a concurrent request would run in that gap.
    const seen = new Set<string>();
    let addedBeforeOtherWork: boolean | undefined;
    const nonceStore: DPoPNonceStore = {
      has: (jti) => {
        queueMicrotask(() => (addedBeforeOtherWork = seen.has(jti)));
        return seen.has(jti);
      },
      add: (jti) => void seen.add(jti),
    };
    await verifyDPoPProof(DPOP_PROOF, { ...EXPECTED, nonceStore });
    expect(addedBeforeOtherWork).toBe(true);
  });

  it('passes nonce store errors through, as Python does', async () => {
    const failure = new Error('store unavailable');
    const nonceStore: DPoPNonceStore = { has: () => Promise.reject(failure), add: () => {} };
    await expect(verifyDPoPProof(DPOP_PROOF, { ...EXPECTED, nonceStore })).rejects.toBe(failure);
  });
});

describe('verifyDPoPProof: check order', () => {
  it('checks typ before alg, alg before the signature, and freshness before htm', async () => {
    const secret = new TextEncoder().encode('a-shared-secret-that-is-at-least-32-bytes');
    await rejects(
      await proof({}, { alg: 'HS256', typ: 'JWT' }, secret),
      "Invalid DPoP proof type: expected 'dpop+jwt', got 'JWT'"
    );
    await rejects(
      await proof({}, { alg: 'HS256' }, secret),
      'DPoP proof algorithm not allowed: HS256'
    );
    await rejects(await proof({ iat: NOW - 66, htm: 'POST' }), 'DPoP proof expired');
    await rejects(
      await proof({ htm: 'POST', htu: 'https://x.test/' }),
      "DPoP proof htm mismatch: expected 'GET', got 'POST'"
    );
    await rejects(
      await proof({ htu: 'https://x.test/', ath: undefined }),
      `DPoP proof htu mismatch: expected '${DPOP_HTU}', got 'https://x.test/'`
    );
  });
});

describe('extractDPoPThumbprint', () => {
  it('rejects an undecodable proof or a proof without jwk', async () => {
    await expect(extractDPoPThumbprint('not-a-jwt')).rejects.toThrow(
      'Cannot extract thumbprint: invalid DPoP proof'
    );
    await expect(extractDPoPThumbprint(await proof({}, { jwk: undefined }))).rejects.toThrow(
      "DPoP proof header missing 'jwk'"
    );
  });

  it('rejects an unsupported key type', async () => {
    await expect(
      extractDPoPThumbprint(await proof({}, { jwk: { ...BUYER_PUBLIC_JWK, kty: 'OKP' } }))
    ).rejects.toThrow('Unsupported key type in DPoP proof: OKP');
  });
});
