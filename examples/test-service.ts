/**
 * Test Service with Agentic Pay Payment Protection
 * 
 * A simple Express server with a protected endpoint that requires Agentic Pay payment.
 * Demonstrates how to integrate Agentic Pay into a service using x402ResourceServer.
 * 
 * Run with: npx tsx examples/test-service.ts
 * 
 * Prerequisites: Mock Agentic Pay server must be running on port 3001
 */

import express from 'express';
import * as jose from 'jose';
import { x402ResourceServer } from '@x402/core/server';
import { createAgenticPayResourceServer } from '../src/index';
import {
  logFlow,
  logFlowStep,
  logFlowKeys,
  logFlowObject
} from './shared-logger';

const app = express();
app.use(express.json());

const SERVICE_URL = 'http://localhost:3002';
const AGENTIC_PAY_BASE_URL = 'http://localhost:3001';
const PORT = 3002;

// Generate service signing keys
let serviceKeys: { privateKey: jose.KeyLike; publicKey: jose.KeyLike };
let server: x402ResourceServer;

async function initializeServer() {
  logFlowStep('SERVICE', 1, 'Service Initialization - Generate Keys');
  
  // Generate keys for signing quote tokens
  serviceKeys = await jose.generateKeyPair('RS256');
  const publicJWK = await jose.exportJWK(serviceKeys.publicKey);
  const privateJWK = await jose.exportJWK(serviceKeys.privateKey);
  
  logFlowKeys('SERVICE', 'Service Signing Keys', {
    publicKey: publicJWK,
    privateKey: privateJWK
  });
  
  console.log('✓ Service keys generated');
  console.log('');
  console.log('🔑 Service Signing Keys:');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Public Key (JWK):');
  console.log(JSON.stringify(publicJWK, null, 2));
  console.log('');
  console.log('Private Key (JWK):');
  console.log(JSON.stringify(privateJWK, null, 2));
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Use the two-phase API to create a resource server, then register networks.
  // This separates construction from configuration and makes it easy to extend.
  const apServer = createAgenticPayResourceServer({
    agenticPayBaseUrl: AGENTIC_PAY_BASE_URL,
    agenticPayId: 'mock-agentic-pay-provider',
    signingKeys: {
      privateKey: serviceKeys.privateKey,
      publicKey: publicJWK,
      alg: 'RS256'
    },
    serviceUrl: SERVICE_URL,
    agenticPayAuth: {
      getAuthHeaders: async () => ({
        'Authorization': 'AWS4-HMAC-SHA256 Credential=EXAMPLE/20260303/us-east-1/execute-api/aws4_request'
      })
    },
  });

  // Register networks individually
  apServer.registerNetwork('aws:marketplace');
  apServer.registerNetwork('eip155:8453');

  // Initialize — routing decisions (like disabling the default fallback) go here.
  // In a real deployment you'd leave disableDefaultFallback false (the default)
  // so that networks like solana:mainnet fall back to the official facilitator.
  // For this local demo we disable it since we don't have connectivity.
  server = await apServer.initialize({ disableDefaultFallback: true });

  console.log('✓ x402 Resource Server initialized');
  console.log('  Agentic Pay networks: aws:marketplace, eip155:8453');
  console.log('  Default fallback: disabled (local demo)');
}

/**
 * GET /foo - Protected endpoint requiring Agentic Pay payment
 * 
 * Returns 402 Payment Required if no valid payment
 * Returns 200 with data if payment is valid
 */
app.get('/foo', async (req, res) => {
  try {
    logFlowStep('SERVICE', 2, 'Request to /foo');
    logFlowObject('SERVICE', 'Request Headers', req.headers);
    
    // Check for payment in Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('x402 ')) {
      // No payment provided - return 402 with payment requirements
      console.log('❌ No payment provided for /foo');
      logFlow('SERVICE', 'No payment provided - generating 402 response');
      
      const paymentRequired = await server.createPaymentRequiredResponse(
        await server.buildPaymentRequirements({
          scheme: 'aws:marketplace',  // Agentic Pay scheme
          network: 'aws:marketplace',
          payTo: 'service-pay-789',
          price: 0.15,
          asset: 'iso4217:USD',
        }),
        {
          url: `${SERVICE_URL}/foo`,
          description: 'Access to /foo endpoint',
          mimeType: 'application/json'
        }
      );

      if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
        console.error('No payment options available!');
        return res.status(500).json({
          error: 'Server Configuration Error',
          message: 'No payment schemes configured'
        });
      }

      logFlowObject('SERVICE', 'Payment Required Response', paymentRequired);
      
      // Create WWW-Authenticate header
      const acceptsBase64 = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
      const wwwAuth = `x402 version=${paymentRequired.x402Version}, accepts="${acceptsBase64}"`;
      
      logFlow('SERVICE', `WWW-Authenticate header: ${wwwAuth.substring(0, 100)}...`);

      return res.status(402)
        .set('WWW-Authenticate', wwwAuth)
        .json({
          error: 'Payment Required',
          message: 'This endpoint requires payment',
          price: '$0.15'
        });
    }

    // Extract payment payload from Authorization header
    const paymentData = authHeader.substring(5); // Remove 'x402 '
    const paymentPayload = JSON.parse(Buffer.from(paymentData, 'base64').toString());

    logFlowObject('SERVICE', 'Received Payment Payload', paymentPayload);
    
    console.log('💳 Payment received for /foo');
    console.log(`   Transaction: ${paymentPayload.payload.transactionId}`);

    // The payment payload contains the accepted requirements that were used
    // We should use those instead of generating new ones
    const accepted = paymentPayload.accepted;
    
    if (!accepted) {
      console.log('❌ Payment missing accepted requirements');
      return res.status(402).json({
        error: 'Invalid Payment',
        message: 'Payment missing accepted requirements'
      });
    }

    const verifyResult = await server.verifyPayment(paymentPayload, accepted);
    
    logFlowObject('SERVICE', 'Verify Result', verifyResult);

    if (!verifyResult.isValid) {
      console.log('❌ Payment verification failed');
      console.log(`   Reason: ${verifyResult.invalidReason}`);
      return res.status(402).json({
        error: 'Payment Verification Failed',
        message: verifyResult.invalidMessage,
        reason: verifyResult.invalidReason
      });
    }

    console.log('✅ Payment verified successfully');
    console.log(`   Payer: ${verifyResult.payer}`);
    logFlow('SERVICE', `Payment verified successfully - Payer: ${verifyResult.payer}`);

    // Payment is valid - return the protected resource
    const responseData = {
      message: 'Hello from /foo!',
      data: {
        secret: 'This is protected content',
        timestamp: new Date().toISOString(),
        paidBy: verifyResult.payer
      }
    };
    
    logFlowObject('SERVICE', 'Response Data', responseData);
    res.json(responseData);

  } catch (error) {
    console.error('Error processing request:', error);
    logFlow('SERVICE', `ERROR: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /bar - Protected endpoint with AUTO capture
 * 
 * Returns 402 Payment Required if no valid payment
 * Automatically captures payment upon verification
 */
app.get('/bar', async (req, res) => {
  try {
    logFlowStep('SERVICE', 3, 'Request to /bar (AUTO CAPTURE)');
    logFlowObject('SERVICE', 'Request Headers', req.headers);
    
    // Check for payment in Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('x402 ')) {
      // No payment provided - return 402 with payment requirements
      console.log('❌ No payment provided for /bar');
      logFlow('SERVICE', 'No payment provided - generating 402 response with auto capture');
      
      const paymentRequired = await server.createPaymentRequiredResponse(
        await server.buildPaymentRequirements({
          scheme: 'aws:marketplace',
          network: 'aws:marketplace',
          payTo: 'service-pay-789',
          price: 1.00,
          asset: 'iso4217:USD',
          extra: {
            capture: 'auto' // Auto capture mode
          }
        }),
        {
          url: `${SERVICE_URL}/bar`,
          description: 'Access to /bar endpoint with auto capture',
          mimeType: 'application/json'
        }
      );

      if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
        console.error('No payment options available!');
        return res.status(500).json({
          error: 'Server Configuration Error',
          message: 'No payment schemes configured'
        });
      }

      logFlowObject('SERVICE', 'Payment Required Response (AUTO CAPTURE)', paymentRequired);
      
      // Create WWW-Authenticate header
      const acceptsBase64 = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
      const wwwAuth = `x402 version=${paymentRequired.x402Version}, accepts="${acceptsBase64}"`;
      
      logFlow('SERVICE', `WWW-Authenticate header: ${wwwAuth.substring(0, 100)}...`);

      return res.status(402)
        .set('WWW-Authenticate', wwwAuth)
        .json({
          error: 'Payment Required',
          message: 'This endpoint requires payment with auto capture',
          price: '$1.00',
          captureMode: 'auto'
        });
    }

    // Extract payment payload from Authorization header
    const paymentData = authHeader.substring(5);
    const paymentPayload = JSON.parse(Buffer.from(paymentData, 'base64').toString());

    logFlowObject('SERVICE', 'Received Payment Payload (AUTO CAPTURE)', paymentPayload);
    
    console.log('💳 Payment received for /bar (auto capture)');
    console.log(`   Transaction: ${paymentPayload.payload.transactionId}`);

    const accepted = paymentPayload.accepted;
    
    if (!accepted) {
      console.log('❌ Payment missing accepted requirements');
      return res.status(402).json({
        error: 'Invalid Payment',
        message: 'Payment missing accepted requirements'
      });
    }

    // Verify payment
    const verifyResult = await server.verifyPayment(paymentPayload, accepted);
    
    logFlowObject('SERVICE', 'Verify Result (AUTO CAPTURE)', verifyResult);

    if (!verifyResult.isValid) {
      console.log('❌ Payment verification failed');
      console.log(`   Reason: ${verifyResult.invalidReason}`);
      return res.status(402).json({
        error: 'Payment Verification Failed',
        message: verifyResult.invalidMessage,
        reason: verifyResult.invalidReason
      });
    }

    console.log('✅ Payment verified successfully');
    console.log(`   Payer: ${verifyResult.payer}`);

    // Auto capture: settle the payment immediately
    console.log('💰 Auto-capturing payment...');
    logFlow('SERVICE', 'Initiating auto-capture...');
    
    const settleResult = await server.settlePayment(paymentPayload, accepted);
    
    logFlowObject('SERVICE', 'Settle Result', settleResult);

    if (!settleResult.success) {
      console.log('❌ Payment settlement failed');
      console.log(`   Reason: ${settleResult.errorReason}`);
      logFlow('SERVICE', `Settlement failed: ${settleResult.errorReason}`);
      return res.status(500).json({
        error: 'Payment Settlement Failed',
        message: settleResult.errorMessage,
        reason: settleResult.errorReason
      });
    }

    console.log('✅ Payment captured successfully');
    console.log(`   Transaction: ${settleResult.transaction}`);
    logFlow('SERVICE', `Payment captured successfully - Transaction: ${settleResult.transaction}`);

    // Payment is valid and captured - return the protected resource
    const responseData = {
      message: 'Hello from /bar!',
      data: {
        secret: 'This is auto-captured content',
        timestamp: new Date().toISOString(),
        paidBy: verifyResult.payer,
        captured: true,
        transaction: settleResult.transaction
      }
    };
    
    logFlowObject('SERVICE', 'Response Data (AUTO CAPTURE)', responseData);
    res.json(responseData);

  } catch (error) {
    console.error('Error processing request:', error);
    logFlow('SERVICE', `ERROR: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /baz - Protected endpoint on an EVM network (eip155:8453 = Base mainnet)
 * 
 * Demonstrates that Agentic Pay can delegate payments on pre-existing networks
 * like EVM (eip155:*), Solana (solana:*), etc. Agentic Pay handles the
 * actual settlement; Agentic Pay just wraps the quote/payment token flow.
 */
app.get('/baz', async (req, res) => {
  try {
    logFlowStep('SERVICE', 4, 'Request to /baz (eip155:8453 — Base mainnet via Agentic Pay)');
    logFlowObject('SERVICE', 'Request Headers', req.headers);
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('x402 ')) {
      console.log('❌ No payment provided for /baz');
      logFlow('SERVICE', 'No payment provided - generating 402 response for eip155:8453');
      
      const paymentRequired = await server.createPaymentRequiredResponse(
        await server.buildPaymentRequirements({
          scheme: 'aws:marketplace',
          network: 'eip155:8453',
          payTo: 'merchant-pay-on-base',
          price: 2.00,
          asset: 'iso4217:USD',
        }),
        {
          url: `${SERVICE_URL}/baz`,
          description: 'Access to /baz endpoint (EVM Base mainnet via Agentic Pay)',
          mimeType: 'application/json'
        }
      );

      if (!paymentRequired.accepts || paymentRequired.accepts.length === 0) {
        return res.status(500).json({
          error: 'Server Configuration Error',
          message: 'No payment schemes configured'
        });
      }

      logFlowObject('SERVICE', 'Payment Required Response (eip155:8453)', paymentRequired);
      
      const acceptsBase64 = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');
      const wwwAuth = `x402 version=${paymentRequired.x402Version}, accepts="${acceptsBase64}"`;

      return res.status(402)
        .set('WWW-Authenticate', wwwAuth)
        .json({
          error: 'Payment Required',
          message: 'This endpoint requires payment via Agentic Pay on EVM Base',
          price: '$2.00'
        });
    }

    const paymentData = authHeader.substring(5);
    const paymentPayload = JSON.parse(Buffer.from(paymentData, 'base64').toString());

    logFlowObject('SERVICE', 'Received Payment Payload (eip155:8453)', paymentPayload);
    
    console.log('💳 Payment received for /baz (EVM Base via Agentic Pay)');
    console.log(`   Transaction: ${paymentPayload.payload.transactionId}`);

    const accepted = paymentPayload.accepted;
    
    if (!accepted) {
      return res.status(402).json({
        error: 'Invalid Payment',
        message: 'Payment missing accepted requirements'
      });
    }

    const verifyResult = await server.verifyPayment(paymentPayload, accepted);
    
    logFlowObject('SERVICE', 'Verify Result (eip155:8453)', verifyResult);

    if (!verifyResult.isValid) {
      console.log('❌ Payment verification failed');
      return res.status(402).json({
        error: 'Payment Verification Failed',
        message: verifyResult.invalidMessage,
        reason: verifyResult.invalidReason
      });
    }

    console.log('✅ Payment verified on eip155:8453 (Base mainnet via Agentic Pay)');
    console.log(`   Payer: ${verifyResult.payer}`);

    const responseData = {
      message: 'Hello from /baz!',
      data: {
        secret: 'This content was paid via Agentic Pay on EVM Base mainnet (eip155:8453)',
        network: 'eip155:8453',
        timestamp: new Date().toISOString(),
        paidBy: verifyResult.payer
      }
    };
    
    logFlowObject('SERVICE', 'Response Data (eip155:8453)', responseData);
    res.json(responseData);

  } catch (error) {
    console.error('Error processing request:', error);
    logFlow('SERVICE', `ERROR: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * GET /health - Health check endpoint (no payment required)
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'healthy',
    service: 'test-service',
    paymentScheme: 'aws:marketplace'
  });
});

/**
 * GET /.well-known/jwks.json - Service public keys
 */
app.get('/.well-known/jwks.json', async (_req, res) => {
  try {
    console.log('🔍 GET /.well-known/jwks.json - Serving service public keys');
    const publicJWK = await jose.exportJWK(serviceKeys.publicKey);
    publicJWK.kid = 'test-service-key-1';
    publicJWK.use = 'sig';
    publicJWK.alg = 'RS256';

    res.json({
      keys: [publicJWK]
    });
  } catch (error) {
    console.error('Error serving JWKS:', error);
    res.status(500).json({
      error: 'Failed to serve JWKS',
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Start server
async function start() {
  await initializeServer();
  
  app.listen(PORT, () => {
    console.log('');
    console.log('🔒 Test Service with Agentic Pay Payment Protection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Service URL: ${SERVICE_URL}`);
    console.log(`Agentic Pay URL:  ${AGENTIC_PAY_BASE_URL}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  GET    /foo                   - Protected (requires $0.15, manual capture, aws:marketplace)`);
    console.log(`  GET    /bar                   - Protected (requires $1.00, auto capture, aws:marketplace)`);
    console.log(`  GET    /baz                   - Protected (requires $2.00, eip155:8453 EVM Base via Agentic Pay)`);
    console.log(`  GET    /health                - Public`);
    console.log(`  GET    /.well-known/jwks.json - Public keys`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('⚠️  Make sure mock Agentic Pay server is running:');
    console.log('   npm run example:agentic-pay');
    console.log('');
  });
}

start().catch(console.error);
