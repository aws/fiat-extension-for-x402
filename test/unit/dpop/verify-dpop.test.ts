// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from 'vitest';
import * as jose from 'jose';
import { generateDPoPKeyPair, createDPoPProof, computeJWKThumbprint } from '../../../src/dpop';
import { AgentPayFacilitatorClient } from '../../../src/agent-pay-facilitator-client';
import { setupMockServer } from './helpers';
import http from 'http';

/**
 * Helper: create a minimal mock JWKS server + signed payment token with cnf.jkt
 */
async function createDPoPBoundScenario() {
  // Generate Agent Pay's signing key
  const { privateKey: apPrivateKey, publicKey: apPublicKey } = await jose.generateKeyPair('ES384');
  const apJwk = await jose.exportJWK(apPublicKey);
  apJwk.kid = 'agentpay-key-1';
  apJwk.use = 'sig';
  apJwk.alg = 'ES384';

  // Generate seller's signing key
  const { privateKey: sellerPrivateKey, publicKey: sellerPublicKey } =
    await jose.generateKeyPair('ES384');
  const sellerJwk = await jose.exportJWK(sellerPublicKey);
  sellerJwk.kid = 'seller-key-1';
  sellerJwk.use = 'sig';
  sellerJwk.alg = 'ES384';

  // Generate buyer's DPoP key pair
  const dpopKeyPair = await generateDPoPKeyPair('ES256');
  const jkt = await computeJWKThumbprint(dpopKeyPair.publicKey);

  // Create seller's quote token
  const quoteToken = await new jose.SignJWT({
    iss: 'https://seller.example.com',
    aud: 'aws:marketplace',
    price: { amount: '0.05', currency: 'USD' },
    payTo: 'seller-123',
    settlement: { product_id: 'prod-test' },
  })
    .setProtectedHeader({ alg: 'ES384', typ: 'JWT', kid: 'seller-key-1' })
    .setIssuedAt()
    .setExpirationTime('5m')
    .setJti('quote-123')
    .sign(sellerPrivateKey);

  // Create Agent Pay's payment token (with cnf.jkt binding)
  const paymentToken = await new jose.SignJWT({
    iss: 'awsmp-agentpay.amazonaws.com',
    sub: 'buyer-account-123',
    payment_id: 'awsmp-test-payment-id',
    quote_token: quoteToken,
    cnf: { jkt },
  })
    .setProtectedHeader({ alg: 'ES384', typ: 'JWT', kid: 'agentpay-key-1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(apPrivateKey);

  // Start mock JWKS servers
  const agentPayServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [apJwk] }));
  });
  const sellerServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ keys: [sellerJwk] }));
  });

  await new Promise<void>((resolve) => agentPayServer.listen(0, resolve));
  await new Promise<void>((resolve) => sellerServer.listen(0, resolve));

  const apPort = (agentPayServer.address() as any).port;
  const sellerPort = (sellerServer.address() as any).port;

  return {
    paymentToken,
    quoteToken,
    dpopKeyPair,
    jkt,
    apPort,
    sellerPort,
    cleanup: () => {
      agentPayServer.close();
      sellerServer.close();
    },
  };
}

describe('DPoP verification in seller verify flow', () => {
  it('should pass when DPoP proof matches cnf.jkt', async () => {
    const { paymentToken, quoteToken, dpopKeyPair, apPort, sellerPort, cleanup } =
      await createDPoPBoundScenario();

    try {
      const verifier = new AgentPayFacilitatorClient(
        `http://localhost:${apPort}`,
        undefined,
        undefined,
        `http://localhost:${apPort}`,
        { type: 'jwks', jwksUrl: `http://localhost:${sellerPort}` }
      );

      const dpopProof = await createDPoPProof(dpopKeyPair, {
        method: 'GET',
        url: 'https://api.seller.com/data',
      });

      const result = await verifier.verify(
        {
          payload: { paymentId: 'awsmp-test', paymentToken },
          x402Version: 2,
          scheme: 'agent-pay',
          network: 'aws:base',
        } as any,
        {
          amount: '0.05',
          asset: 'iso4217:USD',
          scheme: 'agent-pay',
          network: 'aws:base',
          payTo: 'x',
          maxTimeoutSeconds: 300,
          extra: { quoteToken },
        } as any,
        { method: 'GET', url: 'https://api.seller.com/data', dpopProof }
      );

      expect(result.isValid).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('should reject when DPoP-bound but no proof provided', async () => {
    const { paymentToken, quoteToken, apPort, sellerPort, cleanup } =
      await createDPoPBoundScenario();

    try {
      const verifier = new AgentPayFacilitatorClient(
        `http://localhost:${apPort}`,
        undefined,
        undefined,
        `http://localhost:${apPort}`,
        { type: 'jwks', jwksUrl: `http://localhost:${sellerPort}` }
      );

      const result = await verifier.verify(
        {
          payload: { paymentId: 'awsmp-test', paymentToken },
          x402Version: 2,
          scheme: 'agent-pay',
          network: 'aws:base',
        } as any,
        {
          amount: '0.05',
          asset: 'iso4217:USD',
          scheme: 'agent-pay',
          network: 'aws:base',
          payTo: 'x',
          maxTimeoutSeconds: 300,
          extra: { quoteToken },
        } as any,
        { method: 'GET', url: 'https://api.seller.com/data' } // no dpopProof
      );

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('dpop_required');
    } finally {
      cleanup();
    }
  });

  it('should reject when DPoP proof thumbprint does not match', async () => {
    const { paymentToken, quoteToken, apPort, sellerPort, cleanup } =
      await createDPoPBoundScenario();

    try {
      const verifier = new AgentPayFacilitatorClient(
        `http://localhost:${apPort}`,
        undefined,
        undefined,
        `http://localhost:${apPort}`,
        { type: 'jwks', jwksUrl: `http://localhost:${sellerPort}` }
      );

      // Generate a DIFFERENT key pair for the proof (wrong key)
      const wrongKeyPair = await generateDPoPKeyPair('ES256');
      const dpopProof = await createDPoPProof(wrongKeyPair, {
        method: 'GET',
        url: 'https://api.seller.com/data',
      });

      const result = await verifier.verify(
        {
          payload: { paymentId: 'awsmp-test', paymentToken },
          x402Version: 2,
          scheme: 'agent-pay',
          network: 'aws:base',
        } as any,
        {
          amount: '0.05',
          asset: 'iso4217:USD',
          scheme: 'agent-pay',
          network: 'aws:base',
          payTo: 'x',
          maxTimeoutSeconds: 300,
          extra: { quoteToken },
        } as any,
        { method: 'GET', url: 'https://api.seller.com/data', dpopProof }
      );

      expect(result.isValid).toBe(false);
      expect(result.invalidReason).toBe('dpop_invalid');
    } finally {
      cleanup();
    }
  });

  it('should pass when payment token has no cnf (DPoP not used)', async () => {
    // Generate keys without DPoP binding
    const { privateKey: apPrivateKey, publicKey: apPublicKey } =
      await jose.generateKeyPair('ES384');
    const apJwk = await jose.exportJWK(apPublicKey);
    apJwk.kid = 'agentpay-key-1';
    apJwk.use = 'sig';
    apJwk.alg = 'ES384';

    const { privateKey: sellerPrivateKey, publicKey: sellerPublicKey } =
      await jose.generateKeyPair('ES384');
    const sellerJwk = await jose.exportJWK(sellerPublicKey);
    sellerJwk.kid = 'seller-key-1';
    sellerJwk.use = 'sig';
    sellerJwk.alg = 'ES384';

    const quoteToken = await new jose.SignJWT({
      iss: 'https://seller.example.com',
      aud: 'aws:marketplace',
      price: { amount: '0.05', currency: 'USD' },
      payTo: 'seller-123',
      settlement: { product_id: 'prod-test' },
    })
      .setProtectedHeader({ alg: 'ES384', typ: 'JWT', kid: 'seller-key-1' })
      .setIssuedAt()
      .setExpirationTime('5m')
      .setJti('quote-456')
      .sign(sellerPrivateKey);

    // Payment token WITHOUT cnf
    const paymentToken = await new jose.SignJWT({
      iss: 'awsmp-agentpay.amazonaws.com',
      sub: 'buyer-account-123',
      payment_id: 'awsmp-no-dpop',
      quote_token: quoteToken,
    })
      .setProtectedHeader({ alg: 'ES384', typ: 'JWT', kid: 'agentpay-key-1' })
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(apPrivateKey);

    const apServer = http.createServer((_, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [apJwk] }));
    });
    const sellerServer = http.createServer((_, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [sellerJwk] }));
    });
    await new Promise<void>((r) => apServer.listen(0, r));
    await new Promise<void>((r) => sellerServer.listen(0, r));
    const apPort = (apServer.address() as any).port;
    const sellerPort = (sellerServer.address() as any).port;

    try {
      const verifier = new AgentPayFacilitatorClient(
        `http://localhost:${apPort}`,
        undefined,
        undefined,
        `http://localhost:${apPort}`,
        { type: 'jwks', jwksUrl: `http://localhost:${sellerPort}` }
      );

      // No requestContext at all — DPoP not used
      const result = await verifier.verify(
        {
          payload: { paymentId: 'awsmp-no-dpop', paymentToken },
          x402Version: 2,
          scheme: 'agent-pay',
          network: 'aws:base',
        } as any,
        {
          amount: '0.05',
          asset: 'iso4217:USD',
          scheme: 'agent-pay',
          network: 'aws:base',
          payTo: 'x',
          maxTimeoutSeconds: 300,
          extra: { quoteToken },
        } as any
      );

      expect(result.isValid).toBe(true);
    } finally {
      apServer.close();
      sellerServer.close();
    }
  });
});
