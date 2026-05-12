/**
 * Mock Agentic Pay Server
 * 
 * A simple Express server that simulates a Agentic Pay provider.
 * Demonstrates how providers:
 * 1. Authorize payments by signing payment tokens
 * 2. Handle capture/settlement requests
 * 3. Serve JWKS for public key verification
 * 
 * Run with: npx tsx examples/mock-agentic-pay-server.ts
 */

import express from 'express';
import * as jose from 'jose';
import { generateTransactionId } from '../src/utils';
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
// Authentication Configuration
// ============================================================================

interface AuthConfig {
  enabled: boolean;
  methods: {
    apiKey?: {
      enabled: boolean;
      keys: string[]; // Accepted API keys
      headerName: string;
    };
    awsSigV4?: {
      enabled: boolean;
      // Simplified validation - just check for presence of auth header
    };
    oauth2?: {
      enabled: boolean;
      validTokens: string[]; // Accepted bearer tokens
    };
  };
}

const authConfig: AuthConfig = {
  enabled: process.env.AGENTIC_PAY_AUTH_ENABLED !== 'false', // Enabled by default
  methods: {
    apiKey: {
      enabled: true,
      keys: [
        'test-api-key-123',
        'demo-key-456',
        process.env.AGENTIC_PAY_API_KEY || ''
      ].filter(Boolean),
      headerName: 'X-API-Key'
    },
    awsSigV4: {
      enabled: true
    },
    oauth2: {
      enabled: true,
      validTokens: [
        'test-bearer-token',
        process.env.OAUTH_ACCESS_TOKEN || ''
      ].filter(Boolean)
    }
  }
};

// ============================================================================
// Authentication Middleware
// ============================================================================

/**
 * Authentication middleware
 * Validates requests based on configured auth methods
 */
function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Skip auth if disabled
  if (!authConfig.enabled) {
    return next();
  }

  logFlow('AGENTIC_PAY', '🔐 Checking authentication...');

  // Try API Key authentication
  if (authConfig.methods.apiKey?.enabled) {
    const apiKey = req.headers[authConfig.methods.apiKey.headerName.toLowerCase()] as string;
    if (apiKey) {
      // Remove "Bearer " prefix if present
      const cleanKey = apiKey.replace(/^Bearer\s+/i, '');
      if (authConfig.methods.apiKey.keys.includes(cleanKey)) {
        logFlow('AGENTIC_PAY', '✅ API Key authentication successful');
        return next();
      }
    }
  }

  // Try OAuth2 Bearer token authentication
  if (authConfig.methods.oauth2?.enabled) {
    const authHeader = req.headers['authorization'] as string;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      if (authConfig.methods.oauth2.validTokens.includes(token)) {
        logFlow('AGENTIC_PAY', '✅ OAuth2 Bearer token authentication successful');
        return next();
      }
    }
  }

  // Try AWS SigV4 authentication (simplified - just check for presence)
  if (authConfig.methods.awsSigV4?.enabled) {
    const authHeader = req.headers['authorization'] as string;
    if (authHeader?.includes('AWS4-HMAC-SHA256')) {
      logFlow('AGENTIC_PAY', '✅ AWS SigV4 authentication detected (simplified validation)');
      return next();
    }
  }

  // No valid authentication found
  logFlowError('AGENTIC_PAY', 'Authentication failed - no valid credentials provided');
  return res.status(401).json({
    error: 'Authentication required',
    message: 'Please provide valid credentials',
    supportedMethods: Object.keys(authConfig.methods).filter(
      method => authConfig.methods[method as keyof typeof authConfig.methods]?.enabled
    )
  });
}

// Apply authentication middleware to protected routes
app.use('/transactions', authMiddleware);
app.use('/capture', authMiddleware);

// ============================================================================
// In-Memory Storage
// ============================================================================
interface Transaction {
  transactionId: string;
  network: string;
  amount: string;
  currency: string;
  payTo: string;
  quoteToken: string;
  agenticPayId: string;
  status: 'authorized' | 'captured' | 'failed';
  captureId?: string;
  capturedAt?: number;
  createdAt: number;
}

const transactions = new Map<string, Transaction>();
let agenticPayKeys: { privateKey: jose.KeyLike; publicKey: jose.KeyLike } | null = null;
const AGENTIC_PAY_ID = 'mock-agentic-pay-provider';
const PORT = 3001;

// Initialize Agentic Pay keys on startup
async function initializeKeys() {
  agenticPayKeys = await jose.generateKeyPair('RS256');
  
  const publicJWK = await jose.exportJWK(agenticPayKeys.publicKey);
  const privateJWK = await jose.exportJWK(agenticPayKeys.privateKey);
  
  logFlowStep('AGENTIC_PAY', 1, 'Agentic Pay Initialization - Generate Keys');
  logFlowKeys('AGENTIC_PAY', 'Agentic Pay Signing Keys', {
    publicKey: publicJWK,
    privateKey: privateJWK
  });
  
  console.log('✓ Agentic Pay keys generated');
  console.log('');
  console.log('🔑 Agentic Pay Signing Keys:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Public Key (JWK):');
  console.log(JSON.stringify(publicJWK, null, 2));
  console.log('');
  console.log('Private Key (JWK):');
  console.log(JSON.stringify(privateJWK, null, 2));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
}

/**
 * POST /transactions
 * Authorize a payment and return a signed payment token
 */
app.post('/transactions', async (req, res) => {
  try {
    logFlowStep('AGENTIC_PAY', 2, 'Authorize Payment Request');
    logFlowRequest('AGENTIC_PAY', 'POST', '/transactions', req.headers, req.body);
    
    const { network, amount, currency, payTo, quoteToken, agenticPayId } = req.body;

    // Validate request
    if (!network || !amount || !currency || !payTo || !quoteToken || !agenticPayId) {
      logFlowError('AGENTIC_PAY', 'Missing required fields in authorization request');
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['network', 'amount', 'currency', 'payTo', 'quoteToken', 'agenticPayId']
      });
    }

    // Generate transaction ID
    const transactionId = generateTransactionId(network, AGENTIC_PAY_ID);
    logFlow('AGENTIC_PAY', `Generated transaction ID: ${transactionId}`);

    // Create payment token payload
    const now = Math.floor(Date.now() / 1000);
    const paymentTokenPayload = {
      iss: AGENTIC_PAY_ID,
      sub: agenticPayId, // User's Agentic Pay ID
      aud: payTo, // Service URL
      iat: now,
      exp: now + 300, // 5 minutes
      payment_context: {
        transaction_id: transactionId,
        quote_token: quoteToken
      }
    };

    logFlow('AGENTIC_PAY', 'Creating payment token payload');
    logFlowObject('AGENTIC_PAY', 'Payment Token Payload (before signing)', paymentTokenPayload);

    // Sign payment token
    const paymentToken = await new jose.SignJWT(paymentTokenPayload as any)
      .setProtectedHeader({ alg: 'RS256', kid: 'mock-agentic-pay-key-1' })
      .sign(agenticPayKeys!.privateKey);

    logFlow('AGENTIC_PAY', `Signed payment token (JWT): ${paymentToken.substring(0, 50)}...${paymentToken.substring(paymentToken.length - 50)}`);

    // Store transaction
    const transaction: Transaction = {
      transactionId,
      network,
      amount,
      currency,
      payTo,
      quoteToken,
      agenticPayId,
      status: 'authorized',
      createdAt: Date.now()
    };
    transactions.set(transactionId, transaction);

    logFlowSuccess('AGENTIC_PAY', `Transaction ${transactionId} authorized`);
    logFlowObject('AGENTIC_PAY', 'Stored Transaction', transaction);

    const response = {
      transactionId,
      paymentToken
    };

    logFlowResponse('AGENTIC_PAY', 200, {}, response);

    console.log(`✓ Authorized transaction ${transactionId}`);
    console.log(`  Amount: ${amount} ${currency}`);
    console.log(`  Agentic Pay ID: ${agenticPayId}`);
    console.log(`  Service: ${payTo}`);

    res.json(response);
  } catch (error) {
    logFlowError('AGENTIC_PAY', 'Error authorizing transaction', error);
    console.error('Error authorizing transaction:', error);
    res.status(500).json({
      error: 'Failed to authorize transaction',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * POST /capture
 * Capture/settle a previously authorized payment
 */
app.post('/capture', async (req, res) => {
  try {
    logFlowStep('AGENTIC_PAY', 3, 'Capture Payment Request');
    logFlowRequest('AGENTIC_PAY', 'POST', '/capture', req.headers, req.body);
    
    const { transactionId, amount, currency } = req.body;

    // Validate request
    if (!transactionId || !amount || !currency) {
      logFlowError('AGENTIC_PAY', 'Missing required fields in capture request');
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['transactionId', 'amount', 'currency']
      });
    }

    // Find transaction
    const transaction = transactions.get(transactionId);
    if (!transaction) {
      logFlowError('AGENTIC_PAY', `Transaction not found: ${transactionId}`);
      return res.status(404).json({
        error: 'Transaction not found',
        transactionId
      });
    }

    logFlow('AGENTIC_PAY', `Found transaction: ${transactionId}`);
    logFlowObject('AGENTIC_PAY', 'Transaction Details', transaction);

    // Check if already captured
    if (transaction.status === 'captured') {
      logFlowError('AGENTIC_PAY', `Transaction already captured: ${transactionId}`);
      return res.status(400).json({
        error: 'Transaction already captured',
        transactionId,
        captureId: transaction.captureId
      });
    }

    // Validate amount matches
    if (transaction.amount !== amount || transaction.currency !== currency) {
      logFlowError('AGENTIC_PAY', 'Amount mismatch', {
        expected: { amount: transaction.amount, currency: transaction.currency },
        received: { amount, currency }
      });
      return res.status(400).json({
        error: 'Amount mismatch',
        expected: { amount: transaction.amount, currency: transaction.currency },
        received: { amount, currency }
      });
    }

    // Capture transaction
    const captureId = `capture_${transactionId}`;
    transaction.status = 'captured';
    transaction.captureId = captureId;
    transaction.capturedAt = Date.now();

    logFlowSuccess('AGENTIC_PAY', `Transaction captured: ${transactionId}`);
    logFlow('AGENTIC_PAY', `Capture ID: ${captureId}`);
    logFlowObject('AGENTIC_PAY', 'Updated Transaction', transaction);

    const response = {
      success: true,
      captureId,
      timestamp: transaction.capturedAt
    };

    logFlowResponse('AGENTIC_PAY', 200, {}, response);

    console.log(`✓ Captured transaction ${transactionId}`);
    console.log(`  Capture ID: ${captureId}`);
    console.log(`  Amount: ${amount} ${currency}`);

    res.json(response);
  } catch (error) {
    logFlowError('AGENTIC_PAY', 'Error capturing transaction', error);
    console.error('Error capturing transaction:', error);
    res.status(500).json({
      error: 'Failed to capture transaction',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /.well-known/jwks.json
 * Serve public keys for payment token verification
 */
app.get('/.well-known/jwks.json', async (_req, res) => {
  try {
    console.log('🔍 GET /.well-known/jwks.json - Serving Agentic Pay public keys');
    logFlow('AGENTIC_PAY', 'JWKS request received');
    
    const publicJWK = await jose.exportJWK(agenticPayKeys!.publicKey);
    publicJWK.kid = 'mock-agentic-pay-key-1';
    publicJWK.use = 'sig';
    publicJWK.alg = 'RS256';

    const response = {
      keys: [publicJWK]
    };

    logFlowObject('AGENTIC_PAY', 'Serving JWKS', response);

    res.json(response);
  } catch (error) {
    logFlowError('AGENTIC_PAY', 'Error serving JWKS', error);
    console.error('Error serving JWKS:', error);
    res.status(500).json({
      error: 'Failed to serve JWKS',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /.well-known/x402-supported
 * Serve supported payment kinds (x402 facilitator endpoint)
 */
app.get('/.well-known/x402-supported', (_req, res) => {
  try {
    console.log('🔍 GET /.well-known/x402-supported - Serving supported payment kinds');
    logFlow('AGENTIC_PAY', 'x402-supported request received');
    
    const response = {
      x402Version: 2,
      kinds: [
        {
          x402Version: 2,
          scheme: 'fab',
          network: 'aws:marketplace',
          extra: {
            agenticPayId: AGENTIC_PAY_ID
          }
        },
        {
          x402Version: 2,
          scheme: 'fab',
          network: 'eip155:8453',
          extra: {
            agenticPayId: AGENTIC_PAY_ID
          }
        }
      ]
    };

    logFlowObject('AGENTIC_PAY', 'Serving x402-supported', response);

    res.json(response);
  } catch (error) {
    logFlowError('AGENTIC_PAY', 'Error serving x402-supported', error);
    console.error('Error serving x402-supported:', error);
    res.status(500).json({
      error: 'Failed to serve x402-supported',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /transactions/:transactionId
 * Get transaction details (optional - for debugging/monitoring only)
 * NOT required by FAB protocol - payment token signature is sufficient proof
 */
app.get('/transactions/:transactionId', (req, res) => {
  const transaction = transactions.get(req.params.transactionId);
  if (!transaction) {
    return res.status(404).json({
      error: 'Transaction not found',
      transactionId: req.params.transactionId
    });
  }
  res.json(transaction);
});

/**
 * GET /transactions
 * List all transactions (for debugging)
 */
app.get('/transactions', (req, res) => {
  res.json({
    count: transactions.size,
    transactions: Array.from(transactions.values())
  });
});

/**
 * GET /health
 * Health check endpoint
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    agenticPayId: AGENTIC_PAY_ID,
    transactions: transactions.size
  });
});

// Start server
async function start() {
  await initializeKeys();
  
  app.listen(PORT, () => {
    console.log('');
    console.log('🔐 Mock Agentic Pay Server');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Agentic Pay ID: ${AGENTIC_PAY_ID}`);
    console.log(`Base URL:  http://localhost:${PORT}`);
    console.log('');
    console.log('Authentication:');
    if (authConfig.enabled) {
      console.log('  Status: ✅ ENABLED');
      console.log('  Methods:');
      if (authConfig.methods.apiKey?.enabled) {
        console.log(`    - API Key (${authConfig.methods.apiKey.headerName})`);
        console.log(`      Accepted keys: ${authConfig.methods.apiKey.keys.length}`);
      }
      if (authConfig.methods.awsSigV4?.enabled) {
        console.log('    - AWS SigV4 (simplified validation)');
      }
      if (authConfig.methods.oauth2?.enabled) {
        console.log('    - OAuth2 Bearer Token');
        console.log(`      Accepted tokens: ${authConfig.methods.oauth2.validTokens.length}`);
      }
    } else {
      console.log('  Status: ⚠️  DISABLED (set AGENTIC_PAY_AUTH_ENABLED=false to disable)');
    }
    console.log('');
    console.log('Endpoints:');
    console.log(`  POST   /transactions          - Authorize payment`);
    console.log(`  POST   /capture               - Capture payment`);
    console.log(`  GET    /.well-known/jwks.json - Public keys`);
    console.log(`  GET    /transactions/:id      - Get transaction (optional, for debugging)`);
    console.log(`  GET    /transactions          - List all (optional, for debugging)`);
    console.log(`  GET    /health                - Health check`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('📝 Flow log: logs/payment-flow.log');
    console.log('');
  });
}

start().catch(console.error);
