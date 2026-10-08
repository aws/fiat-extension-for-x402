// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * JwksPaymentTokenVerifier Tests
 *
 * The remote JWKS is replaced with a local key set, so no network call is made.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import * as jose from 'jose';

const remoteJwks = vi.hoisted(() => ({
  urls: [] as string[],
  keySet: undefined as unknown,
}));

vi.mock('jose', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jose')>();
  return {
    ...actual,
    createRemoteJWKSet: vi.fn((url: URL) => {
      remoteJwks.urls.push(url.href);
      return remoteJwks.keySet;
    }),
    jwtVerify: vi.fn(actual.jwtVerify),
  };
});

import { JwksPaymentTokenVerifier } from '../../../src/agent-pay/facilitator/payment-token-verifier';
import { AgentPayScheme as AgentPayFacilitatorScheme } from '../../../src/agent-pay/facilitator/scheme';
import { ValidationError } from '../../../src/types';

describe('JwksPaymentTokenVerifier', () => {
  let privateKey: jose.KeyLike;

  async function sign(claims: Record<string, unknown>, key: jose.KeyLike = privateKey) {
    return new jose.SignJWT(claims).setProtectedHeader({ alg: 'ES256', kid: 'pay-1' }).sign(key);
  }

  function baseClaims(): Record<string, unknown> {
    const now = Math.floor(Date.now() / 1000);
    return { iss: 'awsmp-agentpay.amazonaws.com', iat: now, exp: now + 300 };
  }

  beforeAll(async () => {
    const keys = await jose.generateKeyPair('ES256');
    privateKey = keys.privateKey;
    const publicJwk = await jose.exportJWK(keys.publicKey);
    publicJwk.kid = 'pay-1';
    publicJwk.alg = 'ES256';
    remoteJwks.keySet = jose.createLocalJWKSet({ keys: [publicJwk] });
  });

  beforeEach(() => {
    remoteJwks.urls.length = 0;
  });

  it('should fetch keys from baseUrl/.well-known/jwks.json without a double slash', () => {
    new JwksPaymentTokenVerifier({ baseUrl: 'https://pay.example.com/' });
    expect(remoteJwks.urls).toEqual(['https://pay.example.com/.well-known/jwks.json']);
  });

  it('should return the verified claims with a top-level payment_id', async () => {
    const verifier = new JwksPaymentTokenVerifier({ baseUrl: 'https://pay.example.com' });
    const token = await sign({
      ...baseClaims(),
      sub: 'buyer-1',
      aud: 'https://api.example.com',
      payment_id: 'awsmp-123',
      cnf: { jkt: 'thumb' },
    });

    const result = await verifier.verifyPaymentToken(token);

    expect(result).toMatchObject({
      iss: 'awsmp-agentpay.amazonaws.com',
      sub: 'buyer-1',
      aud: 'https://api.example.com',
      payment_id: 'awsmp-123',
      cnf: { jkt: 'thumb' },
    });
  });

  it('should fall back to payment_context.transaction_id', async () => {
    const verifier = new JwksPaymentTokenVerifier({ baseUrl: 'https://pay.example.com' });
    const context = { transaction_id: 'awsmp-legacy', quote_token: 'q' };
    const token = await sign({ ...baseClaims(), payment_context: context });

    const result = await verifier.verifyPaymentToken(token);

    expect(result.payment_id).toBe('awsmp-legacy');
    expect(result.payment_context).toEqual(context);
  });

  it('should return an empty payment_id when the token carries none', async () => {
    const verifier = new JwksPaymentTokenVerifier({ baseUrl: 'https://pay.example.com' });
    const result = await verifier.verifyPaymentToken(await sign(baseClaims()));
    expect(result.payment_id).toBe('');
  });

  it.each(['iss', 'iat', 'exp'])('should reject a token without %s', async (claim) => {
    const verifier = new JwksPaymentTokenVerifier({ baseUrl: 'https://pay.example.com' });
    const claims = baseClaims();
    delete claims[claim];

    await expect(verifier.verifyPaymentToken(await sign(claims))).rejects.toThrow(
      'Invalid payment token: missing required fields'
    );
  });

  it('should reject a token signed by a key outside the JWKS', async () => {
    const verifier = new JwksPaymentTokenVerifier({ baseUrl: 'https://pay.example.com' });
    const other = await jose.generateKeyPair('ES256');
    const token = await sign(baseClaims(), other.privateKey);

    const error = await verifier.verifyPaymentToken(token).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(/^Failed to verify payment token: /);
  });

  it('should pin jwtVerify to ALLOWED_ALGORITHMS', async () => {
    const verifier = new JwksPaymentTokenVerifier({ baseUrl: 'https://pay.example.com' });
    const token = await sign(baseClaims());

    await verifier.verifyPaymentToken(token);
    expect(vi.mocked(jose.jwtVerify).mock.lastCall?.[2]).toEqual({
      algorithms: ['RS256', 'ES256', 'ES384', 'ES512'],
    });
  });

  it('should reject a PS256 token even when the JWKS key allows it', async () => {
    const rsa = await jose.generateKeyPair('PS256');
    const rsaJwk = await jose.exportJWK(rsa.publicKey);
    rsaJwk.kid = 'pay-ps';
    const saved = remoteJwks.keySet;
    remoteJwks.keySet = jose.createLocalJWKSet({ keys: [rsaJwk] });
    try {
      const verifier = new JwksPaymentTokenVerifier({ baseUrl: 'https://pay.example.com' });
      const token = await new jose.SignJWT(baseClaims())
        .setProtectedHeader({ alg: 'PS256', kid: 'pay-ps' })
        .sign(rsa.privateKey);
      await expect(verifier.verifyPaymentToken(token)).rejects.toThrow(
        /^Failed to verify payment token: /
      );
    } finally {
      remoteJwks.keySet = saved;
    }
  });

  it('should reject a malformed token', async () => {
    const verifier = new JwksPaymentTokenVerifier({ baseUrl: 'https://pay.example.com' });
    await expect(verifier.verifyPaymentToken('not-a-jwt')).rejects.toThrow(ValidationError);
  });

  it('should report a non-Error failure as a string', async () => {
    const verifier = new JwksPaymentTokenVerifier({ baseUrl: 'https://pay.example.com' });
    vi.mocked(jose.jwtVerify).mockRejectedValueOnce('boom');

    await expect(verifier.verifyPaymentToken('x.y.z')).rejects.toThrow(
      'Failed to verify payment token: boom'
    );
  });

  describe('AgentPayFacilitatorScheme wiring', () => {
    it('should verify with the JWKS at agentPay.baseUrl', () => {
      new AgentPayFacilitatorScheme({
        agentPayId: 'pay-id',
        agentPay: { baseUrl: 'https://pay.example.com' },
      });
      expect(remoteJwks.urls).toEqual(['https://pay.example.com/.well-known/jwks.json']);
    });

    it('should reject a config with neither agentPayClient nor agentPay', () => {
      expect(() => new AgentPayFacilitatorScheme({ agentPayId: 'pay-id' } as never)).toThrow(
        'requires either agentPayClient or Agent Pay configuration'
      );
    });
  });
});
