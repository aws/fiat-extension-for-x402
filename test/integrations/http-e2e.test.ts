// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * HTTP End-to-End Integration Test
 *
 * Spins up a real Express mock Agent Pay server and runs the full
 * buyer → seller → Agent Pay → seller flow over actual HTTP.
 *
 * This tests DefaultAgentPayClient and AgentPayFacilitatorClient making
 * real fetch() calls to real HTTP endpoints — no mocks.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import * as jose from 'jose';
import { x402Client } from '@x402/core/client';
import { AgentPayScheme as APClientScheme } from '../../src/agent-pay/client/scheme';
import { createAgentPayResourceServer } from '../../src/builders/resource-server-builder';
import { AGENT_PAY_SCHEME, AGENT_PAY_SENTINEL_PAY_TO, DEFAULT_NETWORK } from '../../src/constants';
import type { AgentPayPayloadV2, AgentPayPaymentExtra } from '../../src/types';

// ── Mock Agent Pay HTTP Server ────────────────────────────────────────

interface Transaction {
  transactionId: string;
  amount: string;
  currency: string;
  captured: boolean;
}

async function createMockAgentPayServer(): Promise<{
  server: Server;
  baseUrl: string;
  agentPayId: string;
  transactions: Map<string, Transaction>;
}> {
  const agentPayId = 'mock-agent-pay-e2e';
  const transactions = new Map<string, Transaction>();

  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  const publicJWK = await jose.exportJWK(publicKey);
  publicJWK.kid = 'agent-pay-key-1';
  publicJWK.alg = 'RS256';
  publicJWK.use = 'sig';

  const app = express();
  app.use(express.json());

  app.post('/transactions', async (req, res) => {
    const { network, quoteToken, agentPayId: reqWalletId } = req.body;

    if (!quoteToken) {
      return res.status(400).json({ error: 'Missing quoteToken' });
    }

    const quote = jose.decodeJwt(quoteToken) as any;
    const price = Array.isArray(quote.price) ? quote.price[0] : quote.price;
    const txId = `${network}:${crypto.randomUUID().replace(/-/g, '').substring(0, 16)}`;

    transactions.set(txId, {
      transactionId: txId,
      amount: price?.amount || '0',
      currency: price?.currency || 'USD',
      captured: false,
    });

    const now = Math.floor(Date.now() / 1000);
    const paymentToken = await new jose.SignJWT({
      iss: agentPayId,
      sub: reqWalletId || agentPayId,
      aud: quote.iss,
      iat: now,
      exp: now + 3600,
      payment_context: {
        transaction_id: txId,
        quote_token: quoteToken,
      },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'agent-pay-key-1' })
      .sign(privateKey);

    res.status(201).json({ transactionId: txId, paymentToken });
  });

  app.post('/capture', (req, res) => {
    const { transactionId } = req.body;
    const tx = transactions.get(transactionId);
    if (!tx) return res.status(404).json({ error: 'Transaction not found' });
    tx.captured = true;
    res.json({ success: true, captureId: `cap_${transactionId}`, timestamp: Date.now() });
  });

  app.get('/.well-known/jwks.json', (_req, res) => {
    res.json({ keys: [publicJWK] });
  });

  app.get('/.well-known/x402-supported', (_req, res) => {
    res.json({
      kinds: [
        {
          x402Version: 2,
          scheme: AGENT_PAY_SCHEME,
          network: DEFAULT_NETWORK,
          extra: { agentPayId },
        },
      ],
      extensions: [],
    });
  });

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;

  return { server, baseUrl: `http://127.0.0.1:${port}`, agentPayId, transactions };
}

async function createSellerJWKSServer(publicJWK: jose.JWK): Promise<{
  server: Server;
  baseUrl: string;
}> {
  const app = express();
  app.get('/.well-known/jwks.json', (_req, res) => res.json({ keys: [publicJWK] }));
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

// ── Tests ──────────────────────────────────────────────────────────

describe.skip('HTTP End-to-End: buyer → seller → Agent Pay → seller', () => {
  let apServer: Awaited<ReturnType<typeof createMockAgentPayServer>>;
  let sellerJWKSServer: Awaited<ReturnType<typeof createSellerJWKSServer>>;
  let sellerPrivateKey: jose.KeyLike;
  let sellerPublicJWK: jose.JWK;

  beforeAll(async () => {
    apServer = await createMockAgentPayServer();

    const sellerKeys = await jose.generateKeyPair('RS256');
    sellerPrivateKey = sellerKeys.privateKey;
    sellerPublicJWK = await jose.exportJWK(sellerKeys.publicKey);
    sellerPublicJWK.kid = 'seller-key-1';
    sellerPublicJWK.alg = 'RS256';
    sellerPublicJWK.use = 'sig';

    sellerJWKSServer = await createSellerJWKSServer(sellerPublicJWK);
  });

  afterAll(async () => {
    apServer.server.close();
    sellerJWKSServer.server.close();
  });

  async function buildServer() {
    const serviceUrl = sellerJWKSServer.baseUrl;
    const fabServer = createAgentPayResourceServer({
      agentPayBaseUrl: apServer.baseUrl,
      agentPayId: apServer.agentPayId,
      signingKeys: { privateKey: sellerPrivateKey, publicKey: sellerPublicJWK, alg: 'RS256' },
      serviceUrl,
    });
    fabServer.registerNetwork(DEFAULT_NETWORK);
    return fabServer.initialize({ disableDefaultFallback: true });
  }

  function buildClient() {
    const apClient = new APClientScheme({
      agentPayId: apServer.agentPayId,
      agentPay: { baseUrl: apServer.baseUrl },
    });
    return new x402Client().register(DEFAULT_NETWORK, apClient);
  }

  it('should complete full payment flow over real HTTP', async () => {
    const server = await buildServer();
    const client = buildClient();

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  FAB x402 End-to-End Payment Flow (Real HTTP)');
    console.log('══════════════════════════════════════════════════════');
    console.log(`  Wallet server: ${apServer.baseUrl}`);
    console.log(`  Seller JWKS:   ${sellerJWKSServer.baseUrl}`);

    // ── Step 1: Seller builds 402 response ──
    console.log('\n── STEP 1: Seller builds 402 Payment Required ──');
    const accepts = await server.buildPaymentRequirements({
      scheme: AGENT_PAY_SCHEME,
      network: DEFAULT_NETWORK,
      payTo: 'seller-wallet-001',
      price: 0.05,
      asset: 'iso4217:USD',
    });

    const quoteToken = (accepts[0].extra as unknown as AgentPayPaymentExtra).quoteToken;
    const decodedQuote = jose.decodeJwt(quoteToken);

    console.log('  Payment Requirements:');
    console.log(`    scheme:   ${accepts[0].scheme}`);
    console.log(`    network:  ${accepts[0].network}`);
    console.log(`    amount:   ${accepts[0].amount}`);
    console.log(`    asset:    ${accepts[0].asset}`);
    console.log(`    payTo:    ${accepts[0].payTo}  (sentinel — real payTo is in quote token)`);
    console.log('  Quote Token (decoded):');
    console.log(`    iss:      ${decodedQuote.iss}`);
    console.log(`    aud:      ${decodedQuote.aud}`);
    console.log(`    price:    ${JSON.stringify((decodedQuote as any).price)}`);
    console.log(`    payTo:    ${(decodedQuote as any).payTo}  (the REAL payTo)`);
    console.log(`    capture:  ${(decodedQuote as any).capture}`);
    console.log(`    exp:      ${new Date((decodedQuote.exp || 0) * 1000).toISOString()}`);

    expect(accepts).toHaveLength(1);
    expect(accepts[0].payTo).toBe(AGENT_PAY_SENTINEL_PAY_TO);
    expect(quoteToken).toBeDefined();

    const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
      url: `${sellerJWKSServer.baseUrl}/coffee`,
      description: 'Coffee',
      mimeType: 'application/json',
    });

    console.log('  402 Response:');
    console.log(`    x402Version: ${paymentRequired.x402Version}`);
    console.log(`    accepts:     ${paymentRequired.accepts.length} option(s)`);

    // ── Step 2: Buyer creates payment ──
    console.log('\n── STEP 2: Buyer calls wallet POST /transactions (real HTTP) ──');
    const paymentPayload = await client.createPaymentPayload(paymentRequired);

    const fabPayload = paymentPayload.payload as unknown as AgentPayPayloadV2;
    const decodedPayment = jose.decodeJwt(fabPayload.paymentToken);

    console.log('  Wallet response:');
    console.log(`    transactionId: ${fabPayload.transactionId}`);
    console.log('  Payment Token (decoded):');
    console.log(`    iss:  ${decodedPayment.iss}  (wallet)`);
    console.log(`    sub:  ${decodedPayment.sub}  (buyer)`);
    console.log(`    aud:  ${decodedPayment.aud}  (seller)`);
    console.log(`    exp:  ${new Date((decodedPayment.exp || 0) * 1000).toISOString()}`);
    console.log(
      `  Wallet state: transaction recorded, captured=${apServer.transactions.get(fabPayload.transactionId)?.captured}`
    );

    expect(paymentPayload.x402Version).toBe(2);
    expect(paymentPayload.accepted.scheme).toBe(DEFAULT_NETWORK);
    expect(fabPayload.paymentToken).toBeDefined();
    expect(fabPayload.transactionId).toMatch(/^fab:aws:/);
    expect(apServer.transactions.has(fabPayload.transactionId)).toBe(true);
    expect(apServer.transactions.get(fabPayload.transactionId)!.captured).toBe(false);

    // ── Step 3: Seller verifies payment ──
    console.log('\n── STEP 3: Seller verifies payment (fetches wallet JWKS over HTTP) ──');
    const accepted = server.findMatchingRequirements(accepts, paymentPayload);
    expect(accepted).toBeDefined();

    const verifyResult = await server.verifyPayment(paymentPayload, accepted!);

    console.log('  Verification result:');
    console.log(`    isValid: ${verifyResult.isValid}`);
    console.log(`    payer:   ${verifyResult.payer}`);
    if (!verifyResult.isValid) {
      console.log(`    reason:  ${verifyResult.invalidReason}`);
      console.log(`    message: ${verifyResult.invalidMessage}`);
    }

    expect(verifyResult.isValid).toBe(true);
    expect(verifyResult.payer).toBeDefined();

    // ── Step 4: Seller settles ──
    console.log('\n── STEP 4: Seller settles payment (calls wallet POST /capture over HTTP) ──');
    const settleResult = await server.settlePayment(paymentPayload, accepted!);

    console.log('  Settlement result:');
    console.log(`    success:     ${settleResult.success}`);
    console.log(`    transaction: ${settleResult.transaction}`);
    console.log(`    network:     ${settleResult.network}`);
    console.log(
      `  Wallet state: captured=${apServer.transactions.get(fabPayload.transactionId)?.captured}`
    );

    expect(settleResult.success).toBe(true);
    expect(settleResult.transaction).toBe(fabPayload.transactionId);
    expect(settleResult.network).toBe(DEFAULT_NETWORK);
    expect(apServer.transactions.get(fabPayload.transactionId)!.captured).toBe(true);

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  ☕ Coffee delivered! Payment complete.');
    console.log('══════════════════════════════════════════════════════\n');
  });

  it('should reject payment with tampered payment token', async () => {
    const server = await buildServer();
    const client = buildClient();

    const accepts = await server.buildPaymentRequirements({
      scheme: AGENT_PAY_SCHEME,
      network: DEFAULT_NETWORK,
      payTo: 'seller-wallet-001',
      price: 0.1,
      asset: 'iso4217:USD',
    });

    const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
      url: `${sellerJWKSServer.baseUrl}/premium`,
      description: 'Premium',
      mimeType: 'application/json',
    });

    const paymentPayload = await client.createPaymentPayload(paymentRequired);

    // Tamper with the payment token
    const tampered = {
      ...paymentPayload,
      payload: {
        ...paymentPayload.payload,
        paymentToken: paymentPayload.payload.paymentToken + 'tampered',
      },
    };

    const accepted = server.findMatchingRequirements(accepts, tampered);
    const verifyResult = await server.verifyPayment(tampered, accepted!);
    expect(verifyResult.isValid).toBe(false);
  });

  it('should reject payment with mismatched transaction ID in payment token', async () => {
    const server = await buildServer();
    const client = buildClient();

    const accepts = await server.buildPaymentRequirements({
      scheme: AGENT_PAY_SCHEME,
      network: DEFAULT_NETWORK,
      payTo: 'seller-wallet-001',
      price: 0.1,
      asset: 'iso4217:USD',
    });

    const paymentRequired = await server.createPaymentRequiredResponse(accepts, {
      url: `${sellerJWKSServer.baseUrl}/data`,
      description: 'Data',
      mimeType: 'application/json',
    });

    // Get two separate payments — use the token from one with the requirements of the other
    // This simulates a replay/swap attack: valid JWT but wrong quote token
    const paymentPayload1 = await client.createPaymentPayload(paymentRequired);

    // Build a second set of requirements with different price
    const accepts2 = await server.buildPaymentRequirements({
      scheme: AGENT_PAY_SCHEME,
      network: DEFAULT_NETWORK,
      payTo: 'seller-wallet-001',
      price: 0.5,
      asset: 'iso4217:USD',
    });

    // Try to use payment1's token against accepts2's requirements (quote token mismatch)
    // findMatchingRequirements returns undefined because the payment doesn't match these requirements
    const accepted2 = server.findMatchingRequirements(accepts2, paymentPayload1);
    expect(accepted2).toBeUndefined();
  });
});
