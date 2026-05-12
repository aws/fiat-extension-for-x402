# Agent Pay x402 Extension Examples

Working examples demonstrating the Agent Pay x402 extension with authentication and DPoP support.

## Quick Start

Run the three components in separate terminals:

```bash
# Terminal 1: Start Agent Pay server (port 3001)
npm run example:Agent Pay

# Terminal 2: Start test service (port 3002)
npm run example:service

# Terminal 3: Run test client
npm run example:client
```

## What Gets Demonstrated

- **Two-Phase API**: `createAgentPayResourceServer` / `createAgentPayClient` with `registerNetwork()` for adding networks individually
- **Multi-Facilitator Routing**: Agent Pay handles registered networks, default x402 facilitator handles the rest
- **Method Chaining**: `server.registerNetwork('aws:base').registerNetwork('eip155:8453')`
- **Authentication**: API Key, OAuth2, and AWS SigV4 authentication to Agent Pay
- **DPoP**: Token binding with ephemeral client keys to prevent theft
- **Payment Flow**: Complete 402 Payment Required → authorize → pay → access flow
- **Auto Capture**: Automatic payment settlement on verification
- **Cross-Network FAB**: Agent Pay handling both `aws:base` and `eip155:8453` (EVM Base) via the same Agent Pay

## Files

- `mock-agent-pay-server.ts` - Agent Pay provider with authentication (port 3001)
- `test-service.ts` - Protected API using `createAgentPayResourceServer` (port 3002)
- `test-client.ts` - Client using `createAgentPayClient` with auth and DPoP
- `multi-facilitator.ts` - Standalone example showing Agent Pay + default facilitator routing
- `shared-logger.ts` - Unified logging for all examples

## Logs

All examples write detailed flow logs to:

```
logs/payment-flow.log
```

The log file is created automatically and includes:
- Timestamped entries for each step
- Request/response details
- Key generation and signing operations
- Authentication attempts
- Payment verification results

View logs in real-time:
```bash
tail -f logs/payment-flow.log
```

## Configuration

### Agent Pay Authentication

Authentication is enabled by default. To disable:
```bash
AGENT_PAY_AUTH_ENABLED=false npm run example:Agent Pay
```

Accepted credentials (configured in `mock-agent-pay-server.ts`):
- API Key: `test-api-key-123`, `demo-key-456`
- OAuth2 Token: `test-bearer-token`
- AWS SigV4: Any request with `AWS4-HMAC-SHA256` header (simplified validation)

### Ports

Change ports by editing the respective files:
- Agent Pay: `mock-agent-pay-server.ts` → `const PORT = 3001`
- Service: `test-service.ts` → `const PORT = 3002`

## Requirements

- Node.js 18+
- Both `@x402/core` and `aws-agent-pay-x402` packages (examples use local source)
- All dependencies installed (`npm install`)
- Ports 3001 and 3002 available
