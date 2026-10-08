# Agent Pay x402 Extension

TypeScript SDK for AWS Marketplace Agent Pay — enables AI agents to pay for API calls using the x402 protocol.

## What is Agent Pay?

Agent Pay enables HTTP APIs to accept pay-per-request payments via AWS Marketplace. When a buyer's AI agent hits a seller's paid endpoint, the seller returns HTTP 402 with a signed price quote. The agent pays via Agent Pay and retries with a payment token. The seller verifies the token and delivers the resource. Charges appear on the buyer's AWS bill.

## Installation

```bash
npm install @aws/fiat-extension-for-x402
```

---

## Seller: Generate Quote Token (402 Response)

When a buyer requests a paid resource without payment, return a signed quote:

### Option A: KMS-hosted keys (recommended for AWS sellers)

```typescript
import { createKmsQuoteSigner, AgenticCommerceServerScheme } from '@aws/fiat-extension-for-x402';

// Once at startup
const signer = createKmsQuoteSigner({
  keyArn: 'arn:aws:kms:us-east-1:YOUR_ACCOUNT:alias/your-signing-key',
  region: 'us-east-1',
  serviceUrl: 'https://api.your-service.com',
});
const agentPay = new AgenticCommerceServerScheme({ signer });

// In your API handler:
const requirements = await agentPay.enhancePaymentRequirements({
  scheme: 'agent-pay',
  network: 'aws:base',
  amount: '0.50',
  asset: 'iso4217:USD',
  payTo: 'your-seller-id',
  maxTimeoutSeconds: 3600,
  extra: { settlement: { product_id: 'YOUR_PRODUCT_ID' } },
});

res.status(402).json({ x402Version: 2, accepts: [requirements] });
```

### Option B: Self-hosted keys

```typescript
import { AgenticCommerceServerScheme } from '@aws/fiat-extension-for-x402';
import * as jose from 'jose';

const { privateKey, publicKey } = await jose.generateKeyPair('ES384');

const agentPay = new AgenticCommerceServerScheme({
  signer: {
    signQuote: async (payload) =>
      new jose.SignJWT(payload)
        .setProtectedHeader({ alg: 'ES384', typ: 'JWT', kid: 'my-key-1' })
        .sign(privateKey),
    getPublicKey: () => jose.exportJWK(publicKey),
    getServiceUrl: () => 'https://api.your-service.com',
  },
});

// Same enhancePaymentRequirements() call as Option A
// Host your public key at: {serviceUrl}/.well-known/jwks.json
// The serviceUrl you pass becomes the quote token's `iss` claim.
// Agent Pay and the SDK fetch your key from: {iss}/.well-known/jwks.json
```

---

## Buyer (AI Agent): Authorize Payment

When your agent receives a 402 response:

```typescript
import { createAgentPayClient } from '@aws/fiat-extension-for-x402';

const client = createAgentPayClient({
  agentPayBaseUrl: 'https://agentpay.marketplace.aws.dev',
  agentPayId: 'YOUR_AWS_ACCOUNT_ID',
  agentPayAuth: {
    type: 'awsSigV4',
    region: 'us-east-1',
    service: 'aws-marketplace',
    credentialProvider: () => getAwsCredentials(),
  },
});
client.registerNetwork('aws:base');

// Pass the 402 response body — SDK calls CreateAgentPayment automatically
const payment = await client.createPaymentPayload(response402Body);
// payment.payload = { paymentId: "awsmp-...", paymentToken: "eyJ..." }

// Retry the original request with the payment token
const result = await fetch(url, {
  headers: { 'X-Payment': JSON.stringify(payment) },
});
```

---

## Seller: Verify Payment Token

When the buyer retries with a payment token, verify it before delivering the resource.

**Important:** For JWKS URLs, pass only the **base URL** — the SDK automatically appends `/.well-known/jwks.json`.

```typescript
import { AgenticCommerceFacilitatorClient } from '@aws/fiat-extension-for-x402';

// Option 1: KMS-hosted key
const verifier = new AgenticCommerceFacilitatorClient(
  'https://agentpay.marketplace.aws.dev',
  undefined, undefined, undefined,
  {
    type: 'kms',
    kmsKeyArn: 'arn:aws:kms:us-east-1:YOUR_ACCOUNT:alias/your-key',
    region: 'us-east-1',
    credentials: () => getAwsCredentials(),
  }
);

// Option 2: Self-hosted JWKS endpoint
const verifier2 = new AgenticCommerceFacilitatorClient(
  'https://agentpay.marketplace.aws.dev',
  undefined, undefined, undefined,
  {
    type: 'jwks',
    jwksUrl: 'https://keys.your-service.com'  // BASE URL only!
    // SDK fetches: https://keys.your-service.com/.well-known/jwks.json
  }
);

// Option 3: No config — auto-discovers from quote token's iss claim
// SDK fetches: {iss}/.well-known/jwks.json
const verifier3 = new AgenticCommerceFacilitatorClient('https://agentpay.marketplace.aws.dev');
```

```typescript
// Verify the payment
const result = await verifier.verify(paymentPayload, originalRequirements);
if (result.isValid) {
  res.json({ data: 'premium content' });
} else {
  res.status(402).json({ error: result.invalidMessage });
}

// Settle is a no-op (Agent Pay auto-captures at payment creation)
await verifier.settle(paymentPayload, originalRequirements);
```

---

## HTTP Middleware

This package does not ship HTTP middleware. To protect routes, register `AgenticCommerceServerScheme` on the stock x402 `x402ResourceServer` and use x402's own server middleware for your framework. Known gap: with the current `agent-pay` scheme the stock middleware mints a new quote token on the paid retry, so it does not match the payment and the request gets 402 again; the `exact` scheme rewrite fixes this.

---

## Payment Flow

```
Buyer Agent                    Seller API                  Agent Pay Service
     |                              |                              |
     |--- GET /resource ----------->|                              |
     |<-- 402 + signed quote -------|                              |
     |                              |                              |
     |--- POST /CreateAgentPayment (SigV4) ---------------------->|
     |<-- { paymentId, paymentToken } ----------------------------|
     |                              |                              |
     |--- GET /resource + token --->|                              |
     |                              |-- verify (JWKS + KMS) ------>|
     |<-- 200 OK + resource --------|                              |
```

---

## Key Constants

| Constant | Value | Description |
|----------|-------|-------------|
| `QUOTE_TOKEN_AUDIENCE` | `aws:marketplace` | Required `aud` in quote tokens |
| `PAYMENT_TOKEN_ISSUER` | `awsmp-agentpay.amazonaws.com` | `iss` in payment tokens |
| `DEFAULT_NETWORK` | `aws:base` | Network identifier for AWS Marketplace |

## Supported Algorithms

| Curve | KMS Spec | JWT Algorithm |
|-------|----------|---------------|
| P-256 | `ECC_NIST_P256` | ES256 |
| P-384 | `ECC_NIST_P384` | ES384 (default) |
| P-521 | `ECC_NIST_P521` | ES512 |

---

## DPoP (Optional Token Security)

Bind payment tokens to the buyer's ephemeral key to prevent replay:

```typescript
import { generateDPoPKeyPair } from '@aws/fiat-extension-for-x402';

const dpopKeyPair = await generateDPoPKeyPair('ES256');
// Pass to client config — SDK handles DPoP proof creation automatically
```

---

## Error Handling

```typescript
import { ValidationError, SignatureError, ExpiryError } from '@aws/fiat-extension-for-x402';

try {
  await verifier.verify(payload, requirements);
} catch (error) {
  if (error instanceof SignatureError) { /* Invalid signature */ }
  if (error instanceof ExpiryError) { /* Token expired */ }
  if (error instanceof ValidationError) { /* Validation failed */ }
}
```

---

## Testing

```bash
npm test                    # Run test suite (425 tests)
npm run test:coverage       # With coverage report
npx tsx test/e2e/agent-pay-beta.ts  # E2E against Agent Pay beta
```

---

## Status

Core implementation complete (v0.2.0):
- AWS Marketplace Agent Pay API integration
- KMS signer for quote token generation
- SellerKeyResolver for payment verification (KMS, JWKS, auto-discovery)
- JWT-based quote and payment tokens (ES384)
- Auto-capture on payment creation
- Client token idempotency
- DPoP proof-of-possession
- 425 tests passing

See [docs/sdk-guide.md](./docs/sdk-guide.md) for the SDK guide.

## License

Apache-2.0
