/**
 * HTTP End-to-End Integration Test
 *
 * Spins up a real Express mock wallet server and runs the full
 * buyer → seller → wallet → seller flow over actual HTTP.
 *
 * This tests DefaultWalletClient and WalletFacilitatorClient making
 * real fetch() calls to real HTTP endpoints — no mocks.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import * as jose from 'jose';
import { x402Client } from '@x402/core/client';
import { FABScheme as FABClientScheme } from '../../src/fab/client/scheme';
import { createFABResourceServer } from '../../src/builders/resource-server-builder';
import { FAB_SCHEME, FAB_SENTINEL_PAY_TO } from '../../src/constants';
import type { FABPayloadV2, FABPaymentExtra } from '../../src/types';

// ── Mock Wallet HTTP Server ────────────────────────────────────────

interface Transaction {
  transactionId: string;
  amount: string;
  currency: string;
  captured: boolean;
}

async function createMockWalletServer(): Promise<{
  server: Server;
  baseUrl: string;
  walletId: string;
  transactions: Map<string, Transaction>;
}> {
  const walletId = 'mock-wallet-e2e';
  const transactions = new Map<string, Transaction>();

  const { privateKey, publicKey } = await jose.generateKeyPair('RS256');
  const publicJWK = await jose.exportJWK(publicKey);
  publicJWK.kid = 'wallet-key-1';
  publicJWK.alg = 'RS256';
  publicJWK.use = 'sig';

  const app = express();
  app.use(express.json());

  app.post('/transactions', async (req, res) => {
    const { network, quoteToken, walletId: reqWalletId } = req.body;

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
      iss: walletId,
      sub: reqWalletId || walletId,
      aud: quote.iss,
      iat: now,
      exp: now + 3600,
      payment_context: {
        transaction_id: txId,
        quote_token: quoteToken,
      },
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'wallet-key-1' })
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
      kinds: [{ x402Version: 2, scheme: 'fab', network: 'fab:aws', extra: { walletId } }],
      extensions: [],
    });
  });

  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as any).port;

  return { server, baseUrl: `http://127.0.0.1:${port}`, walletId, transactions };
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

describe('HTTP End-to-End: buyer → seller → wallet → seller', () => {
  let walletServer: Awaited<ReturnType<typeof createMockWalletServer>>;
  let sellerJWKSServer: Awaited<ReturnType<typeof createSellerJWKSServer>>;
  let sellerPrivateKey: jose.KeyLike;
  let sellerPublicJWK: jose.JWK;

  beforeAll(async () => {
    walletServer = await createMockWalletServer();

    const sellerKeys = await jose.generateKeyPair('RS256');
    sellerPrivateKey = sellerKeys.privateKey;
    sellerPublicJWK = await jose.exportJWK(sellerKeys.publicKey);
    sellerPublicJWK.kid = 'seller-key-1';
    sellerPublicJWK.alg = 'RS256';
    sellerPublicJWK.use = 'sig';

    sellerJWKSServer = await createSellerJWKSServer(sellerPublicJWK);
  });

  afterAll(async () => {
    walletServer.server.close();
    sellerJWKSServer.server.close();
  });

  async function buildServer() {
    const serviceUrl = sellerJWKSServer.baseUrl;
    const fabServer = createFABResourceServer({
      walletBaseUrl: walletServer.baseUrl,
      walletId: walletServer.walletId,
      signingKeys: { privateKey: sellerPrivateKey, publicKey: sellerPublicJWK, alg: 'RS256' },
      serviceUrl,
    });
    fabServer.registerNetwork('fab:aws');
    return fabServer.initialize({ disableDefaultFallback: true });
  }

  function buildClient() {
    const fabClient = new FABClientScheme({
      walletId: walletServer.walletId,
      wallet: { baseUrl: walletServer.baseUrl },
    });
    return new x402Client().register('fab:aws', fabClient);
  }

  it('should complete full payment flow over real HTTP', async () => {
    const server = await buildServer();
    const client = buildClient();

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  FAB x402 End-to-End Payment Flow (Real HTTP)');
    console.log('══════════════════════════════════════════════════════');
    console.log(`  Wallet server: ${walletServer.baseUrl}`);
    console.log(`  Seller JWKS:   ${sellerJWKSServer.baseUrl}`);

    // ── Step 1: Seller builds 402 response ──
    console.log('\n── STEP 1: Seller builds 402 Payment Required ──');
    const accepts = await server.buildPaymentRequirements({
      scheme: FAB_SCHEME,
      network: 'fab:aws',
      payTo: 'seller-wallet-001',
      price: 0.05,
      asset: 'iso4217:USD',
    });

    const quoteToken = (accepts[0].extra as unknown as FABPaymentExtra).quoteToken;
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
    expect(accepts[0].payTo).toBe(FAB_SENTINEL_PAY_TO);
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

    const fabPayload = paymentPayload.payload as unknown as FABPayloadV2;
    const decodedPayment = jose.decodeJwt(fabPayload.paymentToken);

    console.log('  Wallet response:');
    console.log(`    transactionId: ${fabPayload.transactionId}`);
    console.log('  Payment Token (decoded):');
    console.log(`    iss:  ${decodedPayment.iss}  (wallet)`);
    console.log(`    sub:  ${decodedPayment.sub}  (buyer)`);
    console.log(`    aud:  ${decodedPayment.aud}  (seller)`);
    console.log(`    exp:  ${new Date((decodedPayment.exp || 0) * 1000).toISOString()}`);
    console.log(`  Wallet state: transaction recorded, captured=${walletServer.transactions.get(fabPayload.transactionId)?.captured}`);

    expect(paymentPayload.x402Version).toBe(2);
    expect(paymentPayload.accepted.scheme).toBe(FAB_SCHEME);
    expect(fabPayload.paymentToken).toBeDefined();
    expect(fabPayload.transactionId).toMatch(/^fab:aws:/);
    expect(walletServer.transactions.has(fabPayload.transactionId)).toBe(true);
    expect(walletServer.transactions.get(fabPayload.transactionId)!.captured).toBe(false);

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
    console.log(`  Wallet state: captured=${walletServer.transactions.get(fabPayload.transactionId)?.captured}`);

    expect(settleResult.success).toBe(true);
    expect(settleResult.transaction).toBe(fabPayload.transactionId);
    expect(settleResult.network).toBe('fab:aws');
    expect(walletServer.transactions.get(fabPayload.transactionId)!.captured).toBe(true);

    console.log('\n══════════════════════════════════════════════════════');
    console.log('  ☕ Coffee delivered! Payment complete.');
    console.log('══════════════════════════════════════════════════════\n');
  });

  it('should reject payment with tampered payment token', async () => {
    const server = await buildServer();
    const client = buildClient();

    const accepts = await server.buildPaymentRequirements({
      scheme: FAB_SCHEME,
      network: 'fab:aws',
      payTo: 'seller-wallet-001',
      price: 0.10,
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
      scheme: FAB_SCHEME,
      network: 'fab:aws',
      payTo: 'seller-wallet-001',
      price: 0.10,
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
      scheme: FAB_SCHEME,
      network: 'fab:aws',
      payTo: 'seller-wallet-001',
      price: 0.50,
      asset: 'iso4217:USD',
    });

    // Try to use payment1's token against accepts2's requirements (quote token mismatch)
    // findMatchingRequirements returns undefined because the payment doesn't match these requirements
    const accepted2 = server.findMatchingRequirements(accepts2, paymentPayload1);
    expect(accepted2).toBeUndefined();
  });
});
