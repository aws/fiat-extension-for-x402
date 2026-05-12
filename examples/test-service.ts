/**
 * Test Service with Agent Pay Payment Protection
 * 
 * A simple Express server with a protected endpoint that requires Agent Pay payment.
 * Demonstrates how to integrate Agent Pay into a service using x402ResourceServer.
 * 
 * Run with: npx tsx examples/test-service.ts
 * 
 * Prerequisites: Mock Agent Pay server must be running on port 3001
 */

import express from 'express';
import * as jose from 'jose';
import { x402ResourceServer } from '@x402/core/server';
import { createAgentPayResourceServer } from '../src/index';
import {
  logFlow,
  logFlowStep,
  logFlowKeys,
  logFlowObject
} from './shared-logger';

const app = express();
app.use(express.json());

const SERVICE_URL = 'http://localhost:3002';
const AGENT_PAY_BASE_URL = 'http://localhost:3001';
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
  const apServer = createAgentPayResourceServer({
    agentPayBaseUrl: AGENT_PAY_BASE_URL,
    agentPayId: 'mock-agent-pay-provider',
    signingKeys: {
      privateKey: serviceKeys.privateKey,
      publicKey: publicJWK,
      alg: 'RS256'
    },
    serviceUrl: SERVICE_URL,
    agentPayAuth: {
      getAuthHeaders: async () => ({
        'Authorization': 'AWS4-HMAC-SHA256 Credential=EXAMPLE/20260303/us-east-1/execute-api/aws4_request'
      })
    },
  });

  // Register networks individually
  apServer.registerNetwork('aws:base');
  apServer.registerNetwork('eip155:8453');

  // Initialize — routing decisions (like disabling the default fallback) go here.
  // In a real deployment you'd leave disableDefaultFallback false (the default)
  // so that networks like solana:mainnet fall back to the official facilitator.
  // For this local demo we disable it since we don't have connectivity.
  server = await apServer.initialize({ disableDefaultFallback: true });

  console.log('✓ x402 Resource Server initialized');
  console.log('  Agent Pay networks: aws:base, eip155:8453');
  console.log('  Default fallback: disabled (local demo)');
}

/**
 * GET /foo - Protected endpoint requiring Agent Pay payment
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
          scheme: 'aws:base',  // Agent Pay scheme
          network: 'aws:base',
          payTo: 'service-pay-789',
          price: 0.15,
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
 * GET /bar - Protected endpoint ($1.00)
 * 
 * Returns 402 Payment Required if no valid payment
 * Agent Pay payments during payment creation
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
      logFlow('SERVICE', 'No payment provided - generating 402 response with payment required');
      
      const paymentRequired = await server.createPaymentRequiredResponse(
        await server.buildPaymentRequirements({
          scheme: 'aws:base',
          network: 'aws:base',
          payTo: 'service-pay-789',
          price: 1.00,
        }),
        {
          url: `${SERVICE_URL}/bar`,
          description: 'Access to /bar endpoint with payment required',
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
          message: 'This endpoint requires payment with payment required',
          price: '$1.00',
          captureMode: 'auto'
        });
    }

    // Extract payment payload from Authorization header
    const paymentData = authHeader.substring(5);
    const paymentPayload = JSON.parse(Buffer.from(paymentData, 'base64').toString());

    logFlowObject('SERVICE', 'Received Payment Payload (AUTO CAPTURE)', paymentPayload);
    
    console.log('💳 Payment received for /bar (payment required)');
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

    // Agent Pay payments during CreateAgentPayment — no settle call needed.
    // The payment was already captured when the buyer created it.
    logFlow('SERVICE', 'Payment already captured by Agent Pay during creation');

    // Payment is valid — return the protected resource
    const responseData = {
      message: 'Hello from /bar!',
      data: {
        secret: 'This is premium content',
        timestamp: new Date().toISOString(),
        paidBy: verifyResult.payer,
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
 * Demonstrates that Agent Pay can delegate payments on pre-existing networks
 * like EVM (eip155:*), Solana (solana:*), etc. Agent Pay handles the
 * actual settlement; Agent Pay just wraps the quote/payment token flow.
 */
app.get('/baz', async (req, res) => {
  try {
    logFlowStep('SERVICE', 4, 'Request to /baz (eip155:8453 — Base mainnet via Agent Pay)');
    logFlowObject('SERVICE', 'Request Headers', req.headers);
    
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('x402 ')) {
      console.log('❌ No payment provided for /baz');
      logFlow('SERVICE', 'No payment provided - generating 402 response for eip155:8453');
      
      const paymentRequired = await server.createPaymentRequiredResponse(
        await server.buildPaymentRequirements({
          scheme: 'aws:base',
          network: 'eip155:8453',
          payTo: 'merchant-pay-on-base',
          price: 2.00,
        }),
        {
          url: `${SERVICE_URL}/baz`,
          description: 'Access to /baz endpoint (EVM Base mainnet via Agent Pay)',
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
          message: 'This endpoint requires payment via Agent Pay on EVM Base',
          price: '$2.00'
        });
    }

    const paymentData = authHeader.substring(5);
    const paymentPayload = JSON.parse(Buffer.from(paymentData, 'base64').toString());

    logFlowObject('SERVICE', 'Received Payment Payload (eip155:8453)', paymentPayload);
    
    console.log('💳 Payment received for /baz (EVM Base via Agent Pay)');
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

    console.log('✅ Payment verified on eip155:8453 (Base mainnet via Agent Pay)');
    console.log(`   Payer: ${verifyResult.payer}`);

    const responseData = {
      message: 'Hello from /baz!',
      data: {
        secret: 'This content was paid via Agent Pay on EVM Base mainnet (eip155:8453)',
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
    paymentScheme: 'aws:base'
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
    console.log('🔒 Test Service with Agent Pay Payment Protection');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Service URL: ${SERVICE_URL}`);
    console.log(`Agent Pay URL:  ${AGENT_PAY_BASE_URL}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  GET    /foo                   - Protected (requires $0.15, aws:base)`);
    console.log(`  GET    /bar                   - Protected (requires $1.00, aws:base)`);
    console.log(`  GET    /baz                   - Protected (requires $2.00, eip155:8453 EVM Base via Agent Pay)`);
    console.log(`  GET    /health                - Public`);
    console.log(`  GET    /.well-known/jwks.json - Public keys`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('⚠️  Make sure mock Agent Pay server is running:');
    console.log('   npm run example:agent-pay');
    console.log('');
  });
}

start().catch(console.error);
