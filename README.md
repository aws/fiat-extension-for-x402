# FAB x402 Extension

TypeScript extension for the x402 protocol that adds support for FAB (Federated Application Billing) - fiat payments through trusted Agentic Pay providers.

## What is FAB?

FAB enables HTTP APIs to accept fiat payments (USD, EUR, etc.) using the x402 protocol. Instead of cryptocurrency, FAB uses trusted Agentic Pay providers (like AWS Agentic Pay) that handle the actual money movement, while your API just verifies signed payment tokens.

## Requirements

- **Node.js**: 18.0.0 or higher (for `crypto.webcrypto` support)
- **TypeScript**: 5.0+ (optional, for development)

**Note**: This SDK is designed for Node.js environments (servers, backend services, AI agents). For browser-based clients, use the Agentic Pay provider's JavaScript SDK instead.

## Installation

FAB is an extension for the x402 protocol. You need to install both packages:

```bash
npm install @x402/core @x402/fab
```

The `@x402/core` package provides the base protocol implementation (`x402Client`, `x402ResourceServer`, `x402Facilitator`), while `@x402/fab` adds FAB-specific payment schemes.

## Quick Start

### For API Providers (Accepting Payments)

Protect your endpoints with FAB payment requirements:

```typescript
import { createFABResourceServer } from '@x402/fab';
import * as jose from 'jose';

// Generate signing keys for quote tokens
const { privateKey, publicKey } = await jose.generateKeyPair('RS256');

// Create server with base config
const fabServer = createFABResourceServer({
  agenticPayBaseUrl: 'https://pay.aws.amazon.com',
  agenticPayId: 'your-agentic-pay-id',
  signingKeys: {
    privateKey,
    publicKey: await jose.exportJWK(publicKey),
    alg: 'RS256'
  },
  serviceUrl: 'https://api.example.com',
});

// Register networks individually — easy to extend later
fabServer.registerNetwork('fab:aws');
fabServer.registerNetwork('eip155:8453');

// Initialize (fetches supported kinds from facilitators)
// Networks not registered (e.g., solana:mainnet) automatically
// fall back to the official x402 facilitator at https://x402.org/facilitator
const server = await fabServer.initialize();

// In your API endpoint
const requirements = await server.buildPaymentRequirements({
  scheme: 'fab',
  network: 'fab:aws',
  payTo: 'your-agentic-pay-id',
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

Pay for protected endpoints using your Agentic Pay:

```typescript
import { createFABClient } from '@x402/fab';

// Create client with base config
const fabClient = createFABClient({
  agenticPayBaseUrl: 'https://pay.aws.amazon.com',
  agenticPayId: 'your-agentic-pay-id',
  agenticPayAuth: {
    type: 'apiKey',
    apiKey: process.env.AGENTIC_PAY_API_KEY
  }
});

// Register networks
fabClient.registerNetwork('fab:aws');
fabClient.registerNetwork('eip155:8453');

// When you receive a 402 response
const paymentPayload = await fabClient.createPaymentPayload(paymentRequired);

// Retry request with payment
const response = await fetch(resourceUrl, {
  headers: {
    'Authorization': `x402 ${btoa(JSON.stringify(paymentPayload))}`
  }
});
```

## Multi-Facilitator Routing

FAB supports network-aware facilitator routing. You register which networks FAB should handle, and everything else falls back to the default x402 facilitator automatically.

```typescript
import { createFABResourceServer } from '@x402/fab';

const fabServer = createFABResourceServer({
  agenticPayBaseUrl: 'https://pay.aws.amazon.com',
  agenticPayId: 'my-agentic-pay',
  signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
  serviceUrl: 'https://api.example.com',
});

// FAB handles these networks via your Agentic Pay provider
fabServer.registerNetwork('fab:aws');
fabServer.registerNetwork('eip155:8453');

// Networks not registered (e.g., solana:mainnet) automatically
// fall back to the official x402 facilitator at https://x402.org/facilitator
const server = await fabServer.initialize();
```

The precedence model works because `x402ResourceServer` accepts multiple facilitator clients. During `initialize()`, the FAB facilitator claims its networks first, and the default facilitator fills in the rest. A `networkFilter` on `AgenticPayFacilitatorClient` ensures Agentic Pay only claims the networks you explicitly registered.

### One-Liner (Convenience Builder)

If you prefer a single call, the legacy `buildFABResourceServer` still works:

```typescript
import { buildFABResourceServer } from '@x402/fab';

const server = await buildFABResourceServer({
  fabNetworks: ['fab:aws', 'eip155:8453'],
  agenticPayBaseUrl: 'https://pay.aws.amazon.com',
  agenticPayId: 'my-agentic-pay',
  signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
  serviceUrl: 'https://api.example.com',
});
```

### Manual Registration (Advanced)

If you need more control, you can still register schemes manually:

```typescript
import { x402ResourceServer } from '@x402/core/server';
import { FABServerScheme, AgenticPayFacilitatorClient, registerFABNetworks } from '@x402/fab';

const facilitatorClient = new AgenticPayFacilitatorClient('https://pay.aws.amazon.com');
const server = new x402ResourceServer(facilitatorClient);

// Helper to register FAB for multiple networks in one call
registerFABNetworks(server, ['fab:aws', 'eip155:8453'], {
  signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
  serviceUrl: 'https://api.example.com',
});

await server.initialize();
```

## Authentication

FAB supports multiple authentication methods for Agentic Pay communication:

### API Key (Simplest)

```typescript
Agentic Pay: {
  baseUrl: 'https://pay.example.com',
  auth: {
    type: 'apiKey',
    apiKey: process.env.AGENTIC_PAY_API_KEY
  }
}
```

### OAuth2 (With Token Refresh)

```typescript
Agentic Pay: {
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
Agentic Pay: {
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
Agentic Pay: {
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
import { generateDPoPKeyPair, createDPoPProof, verifyDPoPProof } from '@x402/fab';

// Generate ephemeral key pair
const dpopKeyPair = await generateDPoPKeyPair('ES256');

// Create a DPoP proof for a specific request
const proof = await createDPoPProof(dpopKeyPair, {
  method: 'POST',
  url: 'https://pay.aws.amazon.com/transactions',
});

// Server-side: verify the proof
const result = await verifyDPoPProof(proof, {
  method: 'POST',
  url: 'https://pay.aws.amazon.com/transactions',
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
new FABServerScheme({
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
import { ServiceFABSigner } from '@x402/fab';

const customSigner: ServiceFABSigner = {
  signQuote: async (payload) => {
    // Sign with KMS, HSM, etc.
    return signedJWT;
  },
  getPublicKey: () => publicJWK,
  getServiceUrl: () => 'https://api.example.com'
};

new FABServerScheme({ signer: customSigner })
```

### Preconfigured Networks

For known Agentic Pay providers:

```typescript
import { FABAWSClientScheme, FABAWSServerScheme } from '@x402/fab';

// AWS Agentic Pay preconfigured
const client = new FABAWSClientScheme({ agenticPayId: 'your-agentic-pay-id' });
const server = new FABAWSServerScheme({ signingKeys, serviceUrl });
```

## Payment Flow

1. Client requests protected resource
2. Service returns 402 Payment Required with quote token
3. Client sends quote to Agentic Pay for authorization
4. Agentic Pay returns signed payment token
5. Client retries request with payment token
6. Service verifies payment with Agentic Pay (via facilitator)
7. Service settles payment (capture)
8. Service delivers resource

The Agentic Pay provider acts as both payment issuer and facilitator - no separate facilitator service needed.

## Agentic Pay Compatibility

FAB is Agentic Pay provider agnostic. Any Agentic Pay provider can work with this SDK as long as it implements the standard HTTP API interface:

### Required Agentic Pay Endpoints

**For Clients (end users):**
- `POST /transactions` - Create/authorize a new transaction
  - Request: `{ network, amount, currency, payTo, quoteToken, agenticPayId }`
  - Response: `{ transactionId, paymentToken }`

**For Services (merchants/facilitators):**
- `POST /capture` - Capture/settle an authorized transaction
  - Request: `{ transactionId, amount, currency }`
  - Response: `{ success, captureId, timestamp }`

**For Both:**
- `GET /.well-known/jwks.json` - Public keys for JWT signature verification
- `GET /.well-known/x402-supported` - Supported payment kinds and networks

### Security Model

FAB's security is based on cryptographic signatures, not transaction state lookups:

1. **Payment token signature** - Proves Agentic Pay authorized the transaction
2. **Quote token signature** - Proves the service issued the quote
3. **Amount verification** - Ensures amounts in both tokens match
4. **Service-side idempotency** - Services track processed transaction IDs to prevent double-spending

The signed payment token IS the proof of payment. Services should maintain their own records of processed transactions rather than querying Agentic Pay state.

### Authentication Flexibility

The facilitator client accepts any authentication mechanism via `AgenticPayFacilitatorAuthConfig`:

```typescript
const facilitatorClient = new AgenticPayFacilitatorClient(
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
- AWS Agentic Pay (using SigV4)
- Stripe (using API keys)
- PayPal (using OAuth2)
- Custom Agentic Pay implementations
- Any provider that exposes the standard REST API

The SDK doesn't care about the Agentic Pay provider's internal implementation - only that it exposes the required HTTP interface and issues JWT tokens signed with published keys.

## Express Middleware

For the simplest server-side integration, use the Express middleware:

```typescript
import express from 'express';
import { fabPaymentMiddleware } from '@x402/fab';

const app = express();
app.use(express.json());

app.use(fabPaymentMiddleware({
  agenticPayBaseUrl: 'https://pay.aws.amazon.com',
  agenticPayId: 'my-agentic-pay',
  signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
  serviceUrl: 'https://api.example.com',
  networks: ['fab:aws'],
  routes: {
    'GET /api/premium': {
      price: 0.15,
      network: 'fab:aws',
      payTo: 'seller-agentic-pay-id',
    },
  },
}));

// Route handler — req.fabPayment is set after successful verification
app.get('/api/premium', (req, res) => {
  res.json({ data: 'premium content', paidBy: req.fabPayment?.payer });
});
```

The middleware handles 402 generation, payment verification, and auto-capture settlement. See [sdk-guide.md](./docs/sdk-guide.md) for details.

## Examples

Working examples in `examples/` directory:

```bash
# Terminal 1: Start mock Agentic Pay server
npm run example:Agentic Pay

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
interface FABClientSchemeConfig {
  agenticPayId: string;                    // Your Agentic Pay identifier
  // Option A: Provide Agentic Pay config (DefaultAgenticPayClient created automatically)
  Agentic Pay: {
    baseUrl: string;                   // Agentic Pay provider URL
    auth?: AuthConfig;                 // Authentication config
  };
  // Option B: Provide a custom Agentic Pay client
  agenticPayClient: AgenticPayClientForClient; // Custom Agentic Pay client implementation
}
```

### Server Configuration

```typescript
type FABServerSchemeConfig =
  // Option A: Provide signing keys (signer created automatically)
  | {
      signingKeys: {
        privateKey: KeyLike;
        publicKey: JWK;
        alg: 'RS256' | 'ES256';
      };
      serviceUrl: string;
      Agentic Pay?: { baseUrl: string };
    }
  // Option B: Provide a custom signer
  | { signer: ServiceFABSigner };
```

### Payment Requirements Extra

```typescript
interface FABPaymentExtra {
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
import { ValidationError, SignatureError, ExpiryError } from '@x402/fab';

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

306 tests currently passing across unit and integration suites.

## Status

Core implementation complete (v0.1.0):
- x402 scheme integration (client, server, facilitator)
- JWT-based quote and payment tokens
- Authentication (API Key, OAuth2, AWS SigV4, Custom)
- DPoP proof-of-possession
- Express middleware (`fabPaymentMiddleware`)
- Network-aware facilitator routing with default fallback
- Sentinel values for redundant x402 core fields
- 306 tests passing
- Working examples

Known limitations:
- AWS SigV4 auth is a simplified placeholder (production use needs `@aws-sdk/signature-v4`)
- Quote token signature verification in the in-process facilitator is best-effort (silently swallows failures); `AgenticPayFacilitatorClient` verifies fully
- Settlement in the in-process facilitator is a placeholder (use `AgenticPayFacilitatorClient` for real capture)

See [tasks.md](./docs/tasks.md) for full status and roadmap.

## License

MIT
