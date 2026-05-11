/**
 * Test Client with FAB Payment
 * 
 * Demonstrates how to use x402Client with FAB to access protected endpoints.
 * Shows the complete flow:
 * 1. Try to access protected endpoint
 * 2. Receive 402 Payment Required
 * 3. Create payment using FAB
 * 4. Retry with payment
 * 5. Access granted
 * 
 * Run with: npx tsx examples/test-client.ts
 * 
 * Prerequisites:
 * - Mock Agentic Pay server running on port 3001
 * - Test service running on port 3002
 */

import { createFABClient } from '../src/index';
import { generateDPoPKeyPair } from '../src/dpop';
import {
  initFlowLog,
  logFlow,
  logFlowStep,
  logFlowObject
} from './shared-logger';

const SERVICE_URL = 'http://localhost:3002';
const AGENTIC_PAY_BASE_URL = 'http://localhost:3001';
const AGENTIC_PAY_ID = 'user-agentic-pay-123';
const API_KEY = 'test-api-key-123'; // For Agentic Pay authentication

async function main() {
  // Initialize the flow log (clear previous run)
  initFlowLog();
  
  logFlowStep('CLIENT', 1, 'Client Initialization');
  logFlow('CLIENT', `Service URL: ${SERVICE_URL}`);
  logFlow('CLIENT', `Agentic Pay URL: ${AGENTIC_PAY_BASE_URL}`);
  logFlow('CLIENT', `Agentic Pay ID: ${AGENTIC_PAY_ID}`);
  
  console.log('');
  console.log('🧪 Testing FAB Payment Flow with Authentication & DPoP');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  try {
    // Step 1: Generate DPoP key pair for token binding
    console.log('1️⃣  Generating DPoP key pair...');
    logFlow('CLIENT', 'Generating DPoP key pair for token binding');
    const dpopKeyPair = await generateDPoPKeyPair('ES256');
    console.log('   ✓ DPoP keys generated (ES256)');
    console.log('');

    // Step 2: Create x402 client with FAB using the two-phase API
    // Create the client, then register networks individually.
    console.log('2️⃣  Setting up x402 client with FAB...');
    logFlow('CLIENT', 'Setting up x402 client with FAB scheme, auth, and DPoP');
    
    const fabClient = createFABClient({
      agenticPayBaseUrl: AGENTIC_PAY_BASE_URL,
      agenticPayId: AGENTIC_PAY_ID,
      agenticPayAuth: {
        type: 'apiKey',
        apiKey: API_KEY,
      },
    });

    // Register networks individually
    fabClient.registerNetwork('fab:aws');
    fabClient.registerNetwork('eip155:8453');

    // The underlying x402Client handles payment creation
    const paymentClient = fabClient.client;

    console.log('   ✓ Client configured');
    console.log(`   Agentic Pay: ${AGENTIC_PAY_BASE_URL}`);
    console.log(`   Agentic Pay ID: ${AGENTIC_PAY_ID}`);
    console.log(`   Auth: API Key`);
    console.log(`   DPoP: Enabled`);
    console.log('');

    // Step 3: Try to access protected endpoint without payment
    console.log('3️⃣  Attempting to access /foo without payment...');
    logFlowStep('CLIENT', 2, 'Request /foo without payment');
    
    const response1 = await fetch(`${SERVICE_URL}/foo`);
    
    logFlow('CLIENT', `Response status: ${response1.status}`);
    logFlowObject('CLIENT', 'Response Headers', Object.fromEntries(response1.headers.entries()));
    
    if (response1.status === 402) {
      console.log('   ✓ Received 402 Payment Required');
      const error1 = await response1.json();
      logFlowObject('CLIENT', '402 Response Body', error1);
      console.log(`   Price: ${error1.price}`);
      console.log(`   Message: ${error1.message}`);
    } else {
      console.log(`   ⚠️  Expected 402, got ${response1.status}`);
    }
    console.log('');

    // Step 4: Manual payment flow
    console.log('4️⃣  Creating payment for /foo...');
    logFlowStep('CLIENT', 3, 'Create payment for /foo');
    
    // Get 402 response with payment requirements
    const response2 = await fetch(`${SERVICE_URL}/foo`);
    const wwwAuth = response2.headers.get('WWW-Authenticate');
    
    if (!wwwAuth) {
      throw new Error('No WWW-Authenticate header');
    }

    logFlow('CLIENT', `WWW-Authenticate header: ${wwwAuth.substring(0, 150)}...`);
    console.log('   ✓ Received payment requirements');
    
    // Parse WWW-Authenticate header manually
    // Format: x402 version=2, accepts="base64-encoded-json"
    const acceptsMatch = wwwAuth.match(/accepts="([^"]+)"/);
    if (!acceptsMatch) {
      throw new Error('Invalid WWW-Authenticate header format');
    }
    
    const acceptsJson = Buffer.from(acceptsMatch[1], 'base64').toString();
    const paymentRequired = JSON.parse(acceptsJson);
    
    logFlowObject('CLIENT', 'Parsed Payment Required', paymentRequired);
    
    console.log(`   Scheme: ${paymentRequired.accepts[0].scheme}`);
    console.log(`   Network: ${paymentRequired.accepts[0].network}`);
    console.log(`   Amount: ${paymentRequired.accepts[0].amount}`);
    
    // Create payment using FAB
    const paymentPayload = await paymentClient.createPaymentPayload(paymentRequired);
    
    logFlowObject('CLIENT', 'Created Payment Payload', paymentPayload);
    
    console.log('   ✓ Payment created');
    console.log(`   Transaction: ${(paymentPayload.payload as any).transactionId}`);
    console.log('');
    
    // Step 5: Make request with payment
    console.log('5️⃣  Accessing /foo with payment...');
    logFlowStep('CLIENT', 4, 'Access /foo with payment');
    
    const authHeader = `x402 ${Buffer.from(JSON.stringify(paymentPayload)).toString('base64')}`;
    logFlow('CLIENT', `Authorization header: ${authHeader.substring(0, 150)}...`);
    
    const response3 = await fetch(`${SERVICE_URL}/foo`, {
      headers: {
        'Authorization': authHeader
      }
    });
    
    logFlow('CLIENT', `Response status: ${response3.status}`);
    
    if (!response3.ok) {
      const error = await response3.json();
      logFlowObject('CLIENT', 'Error Response', error);
      throw new Error(`Request failed: ${response3.status} - ${error.message || response3.statusText}`);
    }

    const data = await response3.json();
    logFlowObject('CLIENT', 'Success Response', data);
    
    console.log('   ✓ Payment successful!');
    console.log(`   Message: ${data.message}`);
    console.log(`   Secret: ${data.data.secret}`);
    console.log(`   Paid by: ${data.data.paidBy}`);
    console.log(`   Timestamp: ${data.data.timestamp}`);
    console.log('');

    // Step 6: Try using the same payment again
    console.log('6️⃣  Reusing payment for another request...');
    logFlowStep('CLIENT', 5, 'Reuse payment for /foo');
    
    const response4 = await fetch(`${SERVICE_URL}/foo`, {
      headers: {
        'Authorization': authHeader
      }
    });
    
    if (!response4.ok) {
      const error = await response4.json();
      throw new Error(`Request failed: ${response4.status} - ${error.message || response4.statusText}`);
    }

    const data2 = await response4.json();
    logFlowObject('CLIENT', 'Reused Payment Response', data2);
    
    console.log('   ✓ Access granted (reused payment)');
    console.log(`   Message: ${data2.message}`);
    console.log('');

    // Step 7: Test /bar endpoint with auto capture
    console.log('7️⃣  Testing /bar endpoint with auto capture...');
    logFlowStep('CLIENT', 6, 'Test /bar with auto capture');
    
    // Get 402 response for /bar
    const response5 = await fetch(`${SERVICE_URL}/bar`);
    const wwwAuth2 = response5.headers.get('WWW-Authenticate');
    
    if (!wwwAuth2) {
      throw new Error('No WWW-Authenticate header for /bar');
    }

    logFlow('CLIENT', `WWW-Authenticate header for /bar: ${wwwAuth2.substring(0, 150)}...`);
    
    const acceptsMatch2 = wwwAuth2.match(/accepts="([^"]+)"/);
    if (!acceptsMatch2) {
      throw new Error('Invalid WWW-Authenticate header format for /bar');
    }
    
    const acceptsJson2 = Buffer.from(acceptsMatch2[1], 'base64').toString();
    const paymentRequired2 = JSON.parse(acceptsJson2);
    
    logFlowObject('CLIENT', 'Parsed Payment Required for /bar', paymentRequired2);
    
    console.log('   ✓ Received payment requirements for /bar');
    console.log(`   Amount: ${paymentRequired2.accepts[0].amount}`);
    console.log(`   Capture mode: ${paymentRequired2.accepts[0].extra?.capture || 'manual'}`);
    
    // Create payment for /bar
    const paymentPayload2 = await paymentClient.createPaymentPayload(paymentRequired2);
    
    logFlowObject('CLIENT', 'Created Payment Payload for /bar', paymentPayload2);
    
    console.log('   ✓ Payment created');
    console.log(`   Transaction: ${(paymentPayload2.payload as any).transactionId}`);
    
    // Access /bar with payment
    const authHeader2 = `x402 ${Buffer.from(JSON.stringify(paymentPayload2)).toString('base64')}`;
    logFlow('CLIENT', `Authorization header for /bar: ${authHeader2.substring(0, 150)}...`);
    
    const response6 = await fetch(`${SERVICE_URL}/bar`, {
      headers: {
        'Authorization': authHeader2
      }
    });
    
    logFlow('CLIENT', `Response status: ${response6.status}`);
    
    if (!response6.ok) {
      const error = await response6.json();
      logFlowObject('CLIENT', 'Error Response for /bar', error);
      throw new Error(`Request failed: ${response6.status} - ${error.message || response6.statusText}`);
    }

    const data3 = await response6.json();
    logFlowObject('CLIENT', 'Success Response for /bar (AUTO CAPTURE)', data3);
    
    console.log('   ✓ Payment successful with auto capture!');
    console.log(`   Message: ${data3.message}`);
    console.log(`   Secret: ${data3.data.secret}`);
    console.log(`   Captured: ${data3.data.captured}`);
    console.log(`   Transaction: ${data3.data.transaction}`);
    console.log('');

    // Step 8: Test /baz endpoint on EVM Base mainnet (eip155:8453) via FAB
    console.log('8️⃣  Testing /baz endpoint on eip155:8453 (EVM Base via FAB)...');
    logFlowStep('CLIENT', 7, 'Test /baz on eip155:8453 (EVM Base mainnet delegated to Agentic Pay via FAB)');
    
    // Get 402 response for /baz
    const response7 = await fetch(`${SERVICE_URL}/baz`);
    const wwwAuth3 = response7.headers.get('WWW-Authenticate');
    
    if (!wwwAuth3) {
      throw new Error('No WWW-Authenticate header for /baz');
    }

    const acceptsMatch3 = wwwAuth3.match(/accepts="([^"]+)"/);
    if (!acceptsMatch3) {
      throw new Error('Invalid WWW-Authenticate header format for /baz');
    }
    
    const acceptsJson3 = Buffer.from(acceptsMatch3[1], 'base64').toString();
    const paymentRequired3 = JSON.parse(acceptsJson3);
    
    logFlowObject('CLIENT', 'Parsed Payment Required for /baz (eip155:8453)', paymentRequired3);
    
    console.log('   ✓ Received payment requirements for /baz');
    console.log(`   Network: ${paymentRequired3.accepts[0].network}`);
    console.log(`   Amount: ${paymentRequired3.accepts[0].amount}`);
    
    // Create payment for /baz — Agentic Pay handles eip155:8453 via FAB
    const paymentPayload3 = await paymentClient.createPaymentPayload(paymentRequired3);
    
    logFlowObject('CLIENT', 'Created Payment Payload for /baz (eip155:8453)', paymentPayload3);
    
    console.log('   ✓ Payment created');
    console.log(`   Transaction: ${(paymentPayload3.payload as any).transactionId}`);
    
    // Access /baz with payment
    const authHeader3 = `x402 ${Buffer.from(JSON.stringify(paymentPayload3)).toString('base64')}`;
    
    const response8 = await fetch(`${SERVICE_URL}/baz`, {
      headers: {
        'Authorization': authHeader3
      }
    });
    
    logFlow('CLIENT', `Response status: ${response8.status}`);
    
    if (!response8.ok) {
      const error = await response8.json();
      logFlowObject('CLIENT', 'Error Response for /baz', error);
      throw new Error(`Request failed: ${response8.status} - ${error.message || response8.statusText}`);
    }

    const data4 = await response8.json();
    logFlowObject('CLIENT', 'Success Response for /baz (eip155:8453)', data4);
    
    console.log('   ✓ Payment successful on eip155:8453 (EVM Base) via FAB!');
    console.log(`   Message: ${data4.message}`);
    console.log(`   Network: ${data4.data.network}`);
    console.log(`   Paid by: ${data4.data.paidBy}`);
    console.log('');

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ All tests passed!');
    console.log('');
    console.log('Summary:');
    console.log('  • Client generates DPoP key pair for token binding');
    console.log('  • Client authenticates to Agentic Pay using API Key');
    console.log('  • Client receives 402 Payment Required');
    console.log('  • Parses payment requirements from WWW-Authenticate header');
    console.log('  • Creates payment using FAB scheme (calls Agentic Pay with auth)');
    console.log('  • Payment token is bound to DPoP key (cnf claim)');
    console.log('  • Retries request with x402 Authorization header');
    console.log('  • Payment can be reused for subsequent requests');
    console.log('  • Auto capture mode automatically settles payments');
    console.log('  • EVM network (eip155:8453) payments delegated through same Agentic Pay');
    console.log('');
    console.log(`📝 Complete flow log: logs/payment-flow.log`);
    console.log('');
    
    logFlow('CLIENT', '');
    logFlow('CLIENT', '='.repeat(80));
    logFlow('CLIENT', 'ALL TESTS PASSED');
    logFlow('CLIENT', '='.repeat(80));

  } catch (error) {
    console.error('');
    console.error('❌ Test failed:', error);
    logFlow('CLIENT', `ERROR: ${error instanceof Error ? error.stack : String(error)}`);
    console.error('');
    console.error('Make sure both servers are running:');
    console.error('  Terminal 1: npm run example:agentic-pay');
    console.error('  Terminal 2: npm run example:service');
    console.error('');
    console.error(`📝 Complete flow log: logs/payment-flow.log`);
    console.error('');
    process.exit(1);
  }
}

main();
