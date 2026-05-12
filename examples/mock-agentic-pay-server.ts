/**
 * Mock Agentic Pay Server
 * 
 * Simulates the AWS Marketplace Agent Pay Service API (version 2026-04-20).
 * Implements the exact API signature:
 *   - POST /CreateAgentPayment
 *   - GET  /GetAgentPayment/{paymentId}
 *   - POST /ListAgentPayments
 *   - GET  /.well-known/jwks.json
 * 
 * Auth: AWS SigV4 (simplified validation — checks for presence of AWS4-HMAC-SHA256)
 * 
 * Run with: npx tsx examples/mock-agentic-pay-server.ts
 */

import express from 'express';
import * as jose from 'jose';
import {
  logFlow,
  logFlowStep,
  logFlowKeys,
  logFlowRequest,
  logFlowResponse,
  logFlowSuccess,
  logFlowError,
  logFlowObject
} from './shared-logger';

const app = express();
app.use(express.json());

// ============================================================================
// Configuration
// ============================================================================

const PORT = 3001;
const ISSUER = 'aws-marketplace';

// ============================================================================
// Key Management (ES384 to match production Agent Pay)
// ============================================================================

let signingKeys: { privateKey: jose.KeyLike; publicKey: jose.KeyLike } | null = null;
let publicJWK: jose.JWK | null = null;

async function initializeKeys() {
  signingKeys = await jose.generateKeyPair('ES384');
  publicJWK = await jose.exportJWK(signingKeys.publicKey);
  publicJWK.kid = 'agent-pay-key-1';
  publicJWK.alg = 'ES384';
  publicJWK.use = 'sig';

  logFlowStep('AGENTIC_PAY', 1, 'Agent Pay Service Initialization');
  logFlowKeys('AGENTIC_PAY', 'Signing Keys (ES384)', { publicKey: publicJWK });
  console.log('✓ Agent Pay keys generated (ES384)');
  console.log('');
}

// ============================================================================
// In-Memory Storage
// ============================================================================

interface PaymentRecord {
  paymentId: string;
  buyerAccountId: string;
  sellerInformation: { sellerProfileId: string; displayName: string };
  listingId: string;
  quoteToken: string;
  paymentToken: string;
  createdAt: string;
  amount: { value: string; currency: string };
  agreementId?: string;
  dpopJkt?: string;
}

const payments = new Map<string, PaymentRecord>();
const clientTokenMap = new Map<string, PaymentRecord>(); // idempotency
let paymentCounter = 0;

// ============================================================================
// Authentication Middleware (AWS SigV4 — simplified)
// ============================================================================

function sigV4Middleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers['authorization'] as string | undefined;

  // In production, this would fully validate the SigV4 signature.
  // For the mock, we accept any request with an AWS4-HMAC-SHA256 auth header,
  // OR skip auth entirely if no auth header is present (for local testing).
  if (authHeader && !authHeader.includes('AWS4-HMAC-SHA256')) {
    return res.status(403).json({ message: 'SigV4 authentication required' });
  }

  // Derive a mock buyer account ID from the auth header or use a default
  (req as any).buyerAccountId = '111122223333';
  next();
}

app.use('/CreateAgentPayment', sigV4Middleware);
app.use('/GetAgentPayment', sigV4Middleware);
app.use('/ListAgentPayments', sigV4Middleware);

// ============================================================================
// POST /CreateAgentPayment
// ============================================================================

app.post('/CreateAgentPayment', async (req, res) => {
  try {
    logFlowStep('AGENTIC_PAY', 2, 'CreateAgentPayment');
    logFlowRequest('AGENTIC_PAY', 'POST', '/CreateAgentPayment', req.headers, req.body);

    const { quoteToken, clientToken, dpopJwk } = req.body;

    // --- Validation ---
    if (!quoteToken || typeof quoteToken !== 'string') {
      return res.status(400).json({ message: 'quoteToken is required and must be a string' });
    }
    if (quoteToken.length < 1 || quoteToken.length > 65536) {
      return res.status(400).json({ message: 'quoteToken must be between 1 and 65536 characters' });
    }
    if (clientToken && (typeof clientToken !== 'string' || clientToken.length > 128)) {
      return res.status(400).json({ message: 'clientToken must be a string of 1-128 characters' });
    }

    // --- Idempotency ---
    if (clientToken && clientTokenMap.has(clientToken)) {
      const existing = clientTokenMap.get(clientToken)!;
      // Same clientToken + same quoteToken → return cached response
      if (existing.quoteToken === quoteToken) {
        logFlow('AGENTIC_PAY', `Idempotent response for clientToken: ${clientToken}`);
        return res.status(201).json({
          paymentId: existing.paymentId,
          paymentToken: existing.paymentToken,
          createdAt: existing.createdAt,
        });
      }
      // Same clientToken + different params → 409 Conflict
      return res.status(409).json({
        message: 'The same clientToken was used with different request parameters. Use a new clientToken for a different request.',
      });
    }

    // --- Parse quote token ---
    let quotePayload: any;
    try {
      quotePayload = jose.decodeJwt(quoteToken);
    } catch {
      return res.status(400).json({ message: 'The quote token is not a valid JWT and cannot be parsed.' });
    }

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (quotePayload.exp && quotePayload.exp < now) {
      return res.status(400).json({ message: 'The quote token exp claim is in the past. The seller must issue a new quote.' });
    }

    // Extract price
    const price = Array.isArray(quotePayload.price) ? quotePayload.price[0] : quotePayload.price;
    if (!price || !price.currency) {
      return res.status(400).json({ message: 'The quote token is missing price information.' });
    }
    if (price.currency !== 'USD') {
      return res.status(400).json({ message: 'The price.currency in the quote token is not USD. Only USD is supported.' });
    }

    // Extract listing_id from settlement or use a default
    const listingId = quotePayload.settlement?.listing_id || quotePayload.reference || 'lst-default';

    // --- Generate payment ID (awsmp-{UUIDv7 format}) ---
    paymentCounter++;
    const uuid = crypto.randomUUID();
    const paymentId = `awsmp-${uuid}`;

    // --- DPoP binding ---
    let cnf: { jkt: string } | undefined;
    if (dpopJwk) {
      // Validate EC key format
      if (dpopJwk.kty !== 'EC' || !dpopJwk.crv || !dpopJwk.x || !dpopJwk.y) {
        return res.status(400).json({ message: 'dpopJwk must be an EC key with kty, crv, x, y fields' });
      }
      const thumbprint = await jose.calculateJwkThumbprint(dpopJwk as jose.JWK);
      cnf = { jkt: thumbprint };
    }

    // --- Sign payment token (ES384) ---
    const paymentTokenPayload: Record<string, unknown> = {
      iss: ISSUER,
      sub: (req as any).buyerAccountId,
      iat: now,
      exp: now + 3600,
      payment_id: paymentId,
      payment_context: {
        transaction_id: paymentId,
        quote_token: quoteToken,
      },
    };
    if (cnf) {
      paymentTokenPayload.cnf = cnf;
    }

    const paymentToken = await new jose.SignJWT(paymentTokenPayload)
      .setProtectedHeader({ alg: 'ES384', typ: 'JWT', kid: 'agent-pay-key-1' })
      .sign(signingKeys!.privateKey);

    const createdAt = new Date().toISOString();

    // --- Store payment ---
    const record: PaymentRecord = {
      paymentId,
      buyerAccountId: (req as any).buyerAccountId,
      sellerInformation: {
        sellerProfileId: quotePayload.iss || 'unknown-seller',
        displayName: quotePayload.iss || 'Unknown Seller',
      },
      listingId,
      quoteToken,
      paymentToken,
      createdAt,
      amount: { value: price.amount, currency: price.currency },
      agreementId: undefined,
      dpopJkt: cnf?.jkt,
    };
    payments.set(paymentId, record);

    // Store for idempotency
    if (clientToken) {
      clientTokenMap.set(clientToken, record);
    }

    logFlowSuccess('AGENTIC_PAY', `Payment created: ${paymentId}`);
    console.log(`✓ Created payment ${paymentId}`);
    console.log(`  Amount: ${price.amount} ${price.currency}`);
    console.log(`  Seller: ${quotePayload.iss}`);
    if (cnf) console.log(`  DPoP bound: ${cnf.jkt}`);

    // --- Response (201) ---
    return res.status(201).json({
      paymentId,
      paymentToken,
      createdAt,
    });
  } catch (error) {
    logFlowError('AGENTIC_PAY', 'CreateAgentPayment error', error);
    return res.status(500).json({
      message: 'An internal error occurred or a dependency is unavailable. Retry with the same clientToken.',
    });
  }
});

// ============================================================================
// GET /GetAgentPayment/{paymentId}
// ============================================================================

app.get('/GetAgentPayment/:paymentId', (req, res) => {
  const { paymentId } = req.params;

  logFlowStep('AGENTIC_PAY', 3, `GetAgentPayment: ${paymentId}`);

  // Validate format
  if (!paymentId || paymentId.length !== 42 || !paymentId.startsWith('awsmp-')) {
    return res.status(400).json({ message: 'Invalid paymentId format. Expected awsmp-{UUID}.' });
  }

  const record = payments.get(paymentId);
  if (!record) {
    return res.status(404).json({ message: `Payment not found: ${paymentId}` });
  }

  return res.status(200).json({
    payment: {
      paymentId: record.paymentId,
      buyerAccountId: record.buyerAccountId,
      sellerInformation: record.sellerInformation,
      listingId: record.listingId,
      quoteToken: record.quoteToken,
      paymentToken: record.paymentToken,
      createdAt: record.createdAt,
      amount: record.amount,
      ...(record.agreementId && { agreementId: record.agreementId }),
    },
  });
});

// ============================================================================
// POST /ListAgentPayments
// ============================================================================

app.post('/ListAgentPayments', (req, res) => {
  logFlowStep('AGENTIC_PAY', 4, 'ListAgentPayments');

  const { sort, maxResults = 50, nextToken } = req.body || {};

  if (maxResults && (maxResults < 1 || maxResults > 100)) {
    return res.status(400).json({ message: 'maxResults must be between 1 and 100' });
  }

  // Get all payments for this buyer, sorted by createdAt
  let allPayments = Array.from(payments.values())
    .filter(p => p.buyerAccountId === (req as any).buyerAccountId);

  // Sort
  const sortOrder = sort?.sortOrder === 'Asc' ? 1 : -1;
  allPayments.sort((a, b) => sortOrder * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()));

  // Pagination (simplified — nextToken is just an index)
  let startIndex = 0;
  if (nextToken) {
    startIndex = parseInt(nextToken, 10) || 0;
  }
  const page = allPayments.slice(startIndex, startIndex + maxResults);
  const hasMore = startIndex + maxResults < allPayments.length;

  const response: any = {
    payments: page.map(p => ({
      paymentId: p.paymentId,
      buyerAccountId: p.buyerAccountId,
      sellerInformation: p.sellerInformation,
      listingId: p.listingId,
      createdAt: p.createdAt,
      ...(p.agreementId && { agreementId: p.agreementId }),
    })),
  };

  if (hasMore) {
    response.nextToken = String(startIndex + maxResults);
  }

  return res.status(200).json(response);
});

// ============================================================================
// GET /.well-known/jwks.json
// ============================================================================

app.get('/.well-known/jwks.json', (_req, res) => {
  console.log('🔍 GET /.well-known/jwks.json');
  res.json({ keys: [publicJWK] });
});

// ============================================================================
// GET /.well-known/x402-supported (for facilitator routing)
// ============================================================================

app.get('/.well-known/x402-supported', (_req, res) => {
  console.log('🔍 GET /.well-known/x402-supported');
  res.json({
    x402Version: 2,
    kinds: [
      { x402Version: 2, scheme: 'aws:marketplace', network: 'aws:marketplace', extra: { agenticPayId: ISSUER } },
    ],
  });
});

// ============================================================================
// GET /health
// ============================================================================

app.get('/health', (_req, res) => {
  res.json({ status: 'healthy', payments: payments.size });
});

// ============================================================================
// Start
// ============================================================================

async function start() {
  await initializeKeys();

  app.listen(PORT, () => {
    console.log('');
    console.log('🏦 Mock AWS Marketplace Agent Pay Service');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Base URL:  http://localhost:${PORT}`);
    console.log(`Issuer:    ${ISSUER}`);
    console.log(`Signing:   ES384`);
    console.log('');
    console.log('API Endpoints (matching Agent Pay API 2026-04-20):');
    console.log(`  POST /CreateAgentPayment          - Create payment`);
    console.log(`  GET  /GetAgentPayment/{paymentId} - Get payment detail`);
    console.log(`  POST /ListAgentPayments           - List payments`);
    console.log(`  GET  /.well-known/jwks.json       - Public keys (ES384)`);
    console.log(`  GET  /.well-known/x402-supported  - Supported payment kinds`);
    console.log('');
    console.log('Auth: AWS SigV4 (simplified — accepts any request for local testing)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
  });
}

start().catch(console.error);
