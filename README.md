# Agent Pay x402 Extension

TypeScript extension for the x402 protocol that adds support for Agent Pay - fiat payments through trusted Agent Pay providers.

## What is Agent Pay?

Agent Pay enables HTTP APIs to accept fiat payments (USD, EUR, etc.) using the x402 protocol. Instead of cryptocurrency, Agent Pay uses trusted Agent Pay providers (like AWS Agent Pay) that handle the actual money movement, while your API just verifies signed payment tokens.

## Requirements

- **Node.js**: 18.0.0 or higher (for `crypto.webcrypto` support)
- **TypeScript**: 5.0+ (optional, for development)

**Note**: This SDK is designed for Node.js environments (servers, backend services, AI agents). For browser-based clients, use the Agent Pay provider's JavaScript SDK instead.

## Installation

Agent Pay is an extension for the x402 protocol. You need to install both packages:

```bash
npm install @x402/core aws-agent-pay-x402
```

The `@x402/core` package provides the base protocol implementation (`x402Client`, `x402ResourceServer`, `x402Facilitator`), while `aws-agent-pay-x402` adds Agent Pay payment schemes.

## Quick Start

### For API Providers (Accepting Payments)

Protect your endpoints with Agent Pay payment requirements:

```typescript
import { createAgentPayResourceServer } from 'aws-agent-pay-x402';
import * as jose from 'jose';

// Generate signing keys for quote tokens
const { privateKey, publicKey } = await jose.generateKeyPair('RS256');

// Create server with base config
const apServer = createAgentPayResourceServer({
  agentPayBaseUrl: 'https://pay.aws.amazon.com',
  agentPayId: 'your-agent-pay-id',
  signingKeys: {
    privateKey,
    publicKey: await jose.exportJWK(publicKey),
    alg: 'RS256'
  },
  serviceUrl: 'https://api.example.com',
});

// Register networks individually — easy to extend later
apServer.registerNetwork('aws:base');
apServer.registerNetwork('eip155:8453');

// Initialize (fetches supported kinds from facilitators)
// Networks not registered (e.g., solana:mainnet) automatically
// fall back to the official x402 facilitator at https://x402.org/facilitator
const server = await apServer.initialize();

// In your API endpoint
const requirements = await server.buildPaymentRequirements({
  scheme: 'aws:base',
  network: 'aws:base',
  payTo: 'your-agent-pay-id',
  price: 0.15,
});

// Return 402 Payment Required
const paymentRequired = await server.createPaymentRequiredResponse(
  requirements,
  { url: 'https://api.example.com/resource', description: 'Premium API access', mimeType: 'application/json' }
);

// Later, verify payment
const result = await server.verifyPayment(paymentPayload, accepted);
if (result.isValid) {
  // Deliver resource
}
```

### For API Consumers (Making Payments)

Pay for protected endpoints using your Agent Pay:

```typescript
import { createAgentPayClient } from 'aws-agent-pay-x402';

// Create client with base config
const apClient = createAgentPayClient({
  agentPayBaseUrl: 'https://pay.aws.amazon.com',
  agentPayId: 'your-agent-pay-id',
  agentPayAuth: {
    type: 'apiKey',
    apiKey: process.env.AGENT_PAY_API_KEY
  }
});

// Register networks
apClient.registerNetwork('aws:base');
apClient.registerNetwork('eip155:8453');

// When you receive a 402 response
const paymentPayload = await apClient.createPaymentPayload(paymentRequired);

// Retry request with payment
const response = await fetch(resourceUrl, {
  headers: {
    'Authorization': `x402 ${btoa(JSON.stringify(paymentPayload))}`
  }
});
```

## Multi-Facilitator Routing

Agent Pay supports network-aware facilitator routing. You register which networks Agent Pay should handle, and everything else falls back to the default x402 facilitator automatically.

```typescript
import { createAgentPayResourceServer } from 'aws-agent-pay-x402';

const apServer = createAgentPayResourceServer({
  agentPayBaseUrl: 'https://pay.aws.amazon.com',
  agentPayId: 'my-agent-pay',
  signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
  serviceUrl: 'https://api.example.com',
});

// Agent Pay handles these networks via your Agent Pay provider
apServer.registerNetwork('aws:base');
apServer.registerNetwork('eip155:8453');

// Networks not registered (e.g., solana:mainnet) automatically
// fall back to the official x402 facilitator at https://x402.org/facilitator
const server = await apServer.initialize();
```

The precedence model works because `x402ResourceServer` accepts multiple facilitator clients. During `initialize()`, the Agent Pay facilitator claims its networks first, and the default facilitator fills in the rest. A `networkFilter` on `AgentPayFacilitatorClient` ensures Agent Pay only claims the networks you explicitly registered.

### One-Liner (Convenience Builder)

If you prefer a single call, the legacy `buildAgentPayResourceServer` still works:

```typescript
import { buildAgentPayResourceServer } from 'aws-agent-pay-x402';

const server = await buildAgentPayResourceServer({
  networks: ['aws:base', 'eip155:8453'],
  agentPayBaseUrl: 'https://pay.aws.amazon.com',
  agentPayId: 'my-agent-pay',
  signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
  serviceUrl: 'https://api.example.com',
});
```

### Manual Registration (Advanced)

If you need more control, you can still register schemes manually:

```typescript
import { x402ResourceServer } from '@x402/core/server';
import { AgentPayServerScheme, AgentPayFacilitatorClient, registerAgentPayNetworks } from 'aws-agent-pay-x402';

const facilitatorClient = new AgentPayFacilitatorClient('https://pay.aws.amazon.com');
const server = new x402ResourceServer(facilitatorClient);

// Helper to register Agent Pay for multiple networks in one call
registerAgentPayNetworks(server, ['aws:base', 'eip155:8453'], {
  signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
  serviceUrl: 'https://api.example.com',
});

await server.initialize();
```

## Authentication

Agent Pay supports multiple authentication methods for Agent Pay communication:

### API Key (Simplest)

```typescript
Agent Pay: {
  baseUrl: 'https://pay.example.com',
  auth: {
    type: 'apiKey',
    apiKey: process.env.AGENT_PAY_API_KEY
  }
}
```

### OAuth2 (With Token Refresh)

```typescript
Agent Pay: {
  baseUrl: 'https://pay.example.com',
  auth: {
    type: 'oauth2',
    accessToken: process.env.OAUTH_ACCESS_TOKEN,
    refreshToken: process.env.OAUTH_REFRESH_TOKEN,
    tokenEndpoint: 'https://pay.example.com/oauth/token',
    onTokenRefresh: (newToken) => {
      // Save refreshed token
    }
  }
}
```

### AWS SigV4 (For AWS Services)

```typescript
Agent Pay: {
  baseUrl: 'https://pay.aws.amazon.com',
  auth: {
    type: 'awsSigV4',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
    },
    region: 'us-east-1'
  }
}
```

### Custom Authentication

```typescript
Agent Pay: {
  baseUrl: 'https://pay.example.com',
  auth: {
    type: 'custom',
    authenticate: async (request) => {
      // Your custom auth logic
      return { ...request, headers: { ...request.headers, 'X-Auth': signature } };
    }
  }
}
```

All authentication methods are documented in the [spec.md](./docs/spec.md#310-authentication) specification.

## DPoP (Token Security)

DPoP binds payment tokens to client keys, preventing token theft:

```typescript
import { generateDPoPKeyPair, createDPoPProof, verifyDPoPProof } from 'aws-agent-pay-x402';

// Generate ephemeral key pair
const dpopKeyPair = await generateDPoPKeyPair('ES256');

// Create a DPoP proof for a specific request
const proof = await createDPoPProof(dpopKeyPair, {
  method: 'POST',
  url: 'https://pay.aws.amazon.com/CreateAgentPayment',
});

// Server-side: verify the proof
const result = await verifyDPoPProof(proof, {
  method: 'POST',
  url: 'https://pay.aws.amazon.com/CreateAgentPayment',
});
```

Benefits:
- Prevents token theft (tokens bound to client keys)
- Prevents replay attacks (unique nonce per request)
- HTTP method/URL binding

DPoP implementation details are in the [spec.md](./docs/spec.md#311-dpop-demonstrating-proof-of-possession) specification.

## Configuration Options

### Simple: Use Signing Keys

For most use cases, provide signing keys directly:

```typescript
new AgentPayServerScheme({
  signingKeys: {
    privateKey,
    publicKey: publicJWK,
    alg: 'RS256'
  },
  serviceUrl: 'https://api.example.com'
})
```

### Advanced: Custom Signer

For external key management (AWS KMS, HSM, etc.):

```typescript
import { ServiceAgentPaySigner } from 'aws-agent-pay-x402';

const customSigner: ServiceAgentPaySigner = {
  signQuote: async (payload) => {
    // Sign with KMS, HSM, etc.
    return signedJWT;
  },
  getPublicKey: () => publicJWK,
  getServiceUrl: () => 'https://api.example.com'
};

new AgentPayServerScheme({ signer: customSigner })
```

### Preconfigured Networks

For known Agent Pay providers:

```typescript
import { AgentPayAWSClientScheme, AgentPayAWSServerScheme } from 'aws-agent-pay-x402';

// AWS Agent Pay preconfigured
const client = new AgentPayAWSClientScheme({ agentPayId: 'your-agent-pay-id' });
const server = new AgentPayAWSServerScheme({ signingKeys, serviceUrl });
```

## Payment Flow

1. Client requests protected resource
2. Service returns 402 Payment Required with signed quote token
3. Client sends quote token to Agent Pay (`POST /CreateAgentPayment`)
4. Agent Pay verifies quote, auto-captures payment, returns signed payment JWT
5. Client retries request with payment token
6. Service verifies payment token signature (Agent Pay's ES384 public key)
7. Service delivers resource

Agent Pay auto-captures on creation — there is no separate settlement step.

## Agent Pay Integration

Agent Pay integrates with the AWS Marketplace Agent Pay Service. The SDK communicates with the following API:

### Agent Pay API Endpoints

**For Clients (AI agents / buyers):**
- `POST /CreateAgentPayment` - Create and auto-capture a payment
  - Request: `{ quoteToken, clientToken?, dpopJwk? }`
  - Response: `{ paymentId, paymentToken, createdAt }`
- `GET /GetAgentPayment/{paymentId}` - Get full payment detail
- `POST /ListAgentPayments` - List payments (paginated)

**For Services (sellers / verifiers):**
- `GET /.well-known/jwks.json` - Public keys for payment token signature verification (ES384)

**Authentication:** All endpoints use AWS SigV4.

### Security Model

Agent Pay's security is based on cryptographic signatures:

1. **Payment token signature** - Proves Agent Pay authorized the transaction (ES384, KMS-backed)
2. **Quote token signature** - Proves the service issued the quote (RS256 or ES256)
3. **DPoP binding** - Optional `cnf.jkt` in payment token binds it to the buyer's ephemeral key
4. **Idempotency** - `clientToken` ensures duplicate requests return the same response

The signed payment token IS the proof of payment. Agent Pay auto-captures on creation — there is no separate settlement step.

### Authentication Flexibility

The facilitator client accepts any authentication mechanism via `AgentPayFacilitatorAuthConfig`:

```typescript
const facilitatorClient = new AgentPayFacilitatorClient(
  'https://pay.example.com',
  {
    getAuthHeaders: async () => ({
      'Authorization': 'Bearer token',
      'X-Custom-Auth': 'signature'
    })
  }
);
```

This means you can integrate with:
- AWS Agent Pay (using SigV4)
- Stripe (using API keys)
- PayPal (using OAuth2)
- Custom Agent Pay implementations
- Any provider that exposes the standard REST API

The SDK doesn't care about the Agent Pay provider's internal implementation - only that it exposes the required HTTP interface and issues JWT tokens signed with published keys.

## Express Middleware

For the simplest server-side integration, use the Express middleware:

```typescript
import express from 'express';
import { agentPayMiddleware } from 'aws-agent-pay-x402';

const app = express();
app.use(express.json());

app.use(agentPayMiddleware({
  agentPayBaseUrl: 'https://pay.aws.amazon.com',
  agentPayId: 'my-agent-pay',
  signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
  serviceUrl: 'https://api.example.com',
  networks: ['aws:base'],
  routes: {
    'GET /api/premium': {
      price: 0.15,
      network: 'aws:base',
      payTo: 'seller-agent-pay-id',
    },
  },
}));

// Route handler — req.agentPayPayment is set after successful verification
app.get('/api/premium', (req, res) => {
  res.json({ data: 'premium content', paidBy: req.agentPayPayment?.payer });
});
```

The middleware handles 402 generation, payment verification, and auto-capture settlement. See [sdk-guide.md](./docs/sdk-guide.md) for details.

## Examples

Working examples in `examples/` directory:

```bash
# Terminal 1: Start mock Agent Pay server
npm run example:Agent Pay

# Terminal 2: Start test service
npm run example:service

# Terminal 3: Run test client
npm run example:client
```

See [examples/README.md](./examples/README.md) for details.

## Documentation

- [Specification](./docs/spec.md) - Complete system specification including requirements, architecture decisions, and data model examples
- [Tasks & Status](./docs/tasks.md) - Implementation progress and task tracking

## API Reference

### Client Configuration

```typescript
interface AgentPayClientSchemeConfig {
  agentPayId: string;                    // Your Agent Pay identifier
  // Option A: Provide Agent Pay config (DefaultAgentPayClient created automatically)
  Agent Pay: {
    baseUrl: string;                   // Agent Pay provider URL
    auth?: AuthConfig;                 // Authentication config
  };
  // Option B: Provide a custom Agent Pay client
  agentPayClient: AgentPayClientForClient; // Custom Agent Pay client implementation
}
```

### Server Configuration

```typescript
type AgentPayServerSchemeConfig =
  // Option A: Provide signing keys (signer created automatically)
  | {
      signingKeys: {
        privateKey: KeyLike;
        publicKey: JWK;
        alg: 'RS256' | 'ES256';
      };
      serviceUrl: string;
      Agent Pay?: { baseUrl: string };
    }
  // Option B: Provide a custom signer
  | { signer: ServiceAgentPaySigner };
```

### Payment Requirements Extra

```typescript
interface AgentPayPaymentExtra {
  quoteToken: string;                  // Signed JWT from service (auto-generated)
  capture?: 'manual' | 'auto';        // Capture mode (default: 'manual')
  reference?: string;                  // Payment reference
  settlement?: {
    method: 'INST' | 'CLRG' | 'CRDT';
    cycle?: 'MNTH' | 'WEEK' | 'QRTR';
  };
  support?: {
    uri: string;
    method: 'human' | 'agent';
  };
  terms?: Array<{
    description: string;
    uri: string;
  }>;
}
```

## Error Handling

```typescript
import { ValidationError, SignatureError, ExpiryError } from 'aws-agent-pay-x402';

try {
  await server.verifyPayment(paymentPayload, accepted);
} catch (error) {
  if (error instanceof SignatureError) {
    // Invalid signature
  } else if (error instanceof ExpiryError) {
    // Token expired
  } else if (error instanceof ValidationError) {
    // Validation failed
  }
}
```

## Testing

```bash
# Run test suite
npm test

# Run with coverage report
npm run test:coverage

# Watch mode for development
npm run test:watch
```

### Test Coverage

The project targets 90% coverage across all metrics:

- **Lines**: 90%
- **Functions**: 90%
- **Branches**: 90%
- **Statements**: 90%

332 tests currently passing across unit and integration suites.

## Status

Core implementation complete (v0.2.0):
- AWS Marketplace Agent Pay API integration (`CreateAgentPayment`, `GetAgentPayment`, `ListAgentPayments`)
- x402 scheme integration (client, server, facilitator)
- JWT-based quote and payment tokens (ES384 payment tokens from Agent Pay)
- Auto-capture on payment creation (no separate settle step)
- Client token idempotency support
- DPoP proof-of-possession (EC keys: P-256, P-384, P-521)
- Authentication (API Key, OAuth2, AWS SigV4, Custom)
- Express middleware (`agentPayMiddleware`)
- Network-aware facilitator routing with default fallback
- Quote token extensions (description, dimensions)
- Sentinel values for redundant x402 core fields
- 332 tests passing
- Working examples

Known limitations:
- AWS SigV4 auth is a simplified placeholder (production use needs `@aws-sdk/signature-v4`)
- Network identifier is `aws:base` (configurable via `DEFAULT_NETWORK` constant)

See [tasks.md](./docs/tasks.md) for full status and roadmap.

## License

MIT
