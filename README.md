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

Register the `exact` server scheme on the stock x402 resource server. On every
402 it signs a quote token for the route and adds it to `extra.quoteToken`.

### Option A: KMS-hosted keys (recommended for AWS sellers)

```typescript
import { x402ResourceServer } from '@x402/core/server';
import {
  createKmsQuoteSigner,
  registerExactAgenticCommerceServer,
} from '@aws/fiat-extension-for-x402';

// Once at startup
const signer = createKmsQuoteSigner({
  keyArn: 'arn:aws:kms:us-east-1:YOUR_ACCOUNT:alias/your-signing-key',
  region: 'us-east-1',
  serviceUrl: 'https://api.your-service.com',
});
const server = registerExactAgenticCommerceServer(new x402ResourceServer(facilitatorClient), {
  signer, // networks defaults to ['aws:base']
});

// A route: payTo is your AWS Marketplace product ID.
const route = {
  accepts: { scheme: 'exact', network: 'aws:base', payTo: 'YOUR_PRODUCT_ID', price: '$0.50' },
};
```

The quote token carries `payTo` and `settlement.product_id` (both the product
ID). The 402 itself carries `payTo: 'urn:x402:agentic-commerce:see-quote'` and a
`maxTimeoutSeconds` equal to the quote's lifetime (default 300 s).

### Option B: Self-hosted keys

```typescript
import { ExactAgenticCommerceServerScheme, toQuoteSigner } from '@aws/fiat-extension-for-x402';
import * as jose from 'jose';

const { privateKey, publicKey } = await jose.generateKeyPair('ES384');

// Signs with the key's own alg (ES384 here).
const signer = toQuoteSigner(privateKey, await jose.exportJWK(publicKey), 'https://api.your-service.com');
server.register('aws:base', new ExactAgenticCommerceServerScheme({ signer }));

// Host your public key at: {serviceUrl}/.well-known/jwks.json
// The serviceUrl you pass becomes the quote token's `iss` claim; it must not be empty.
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

This package does not ship HTTP middleware. To protect routes, register the
`exact` scheme on the stock x402 `x402ResourceServer` (see above) and use x402's
own server middleware for your framework, for example `paymentMiddleware` from
`@x402/express`. The middleware builds the requirements again on the buyer's
paid retry, which signs a new quote token; the scheme declares `quoteToken` as a
dynamic extra field, so x402 core ignores it when it matches the buyer's
`accepted` requirements, and every other field is the same on each 402.
Requires `@x402/core` 2.23.0 or later.

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
