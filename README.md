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
  KmsQuoteSigner,
  registerExactAgenticCommerceServer,
} from '@aws/fiat-extension-for-x402';

// Once at startup
const signer = new KmsQuoteSigner({
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

### Option B: Your own key with a JWKS URL

Sign with your own private key and publish the public key at
`https://<seller>/.well-known/jwks.json`, the JWKS URL registered for the
listing:

```typescript
import { readFileSync } from 'node:fs';
import {
  AgenticCommerceVerifier,
  ExactAgenticCommerceServerScheme,
  LocalQuoteSigner,
  jwksDocument,
} from '@aws/fiat-extension-for-x402';

// 1. Load the key. The algorithm follows the key: P-256/P-384/P-521, or RSA
//    of at least 2048 bits. Pass `password` for an encrypted PEM.
const signer = LocalQuoteSigner.fromPem(readFileSync('quote-key.pem'), {
  kid: 'quote-key-2026-10',
  serviceUrl: 'https://api.your-service.com',
});
server.register('aws:base', new ExactAgenticCommerceServerScheme({ signer }));

// 2. Serve the public key, built once at startup. Leave this route out of the
//    payment routes.
const jwks = jwksDocument(signer.publicJwk);
app.get('/.well-known/jwks.json', (_req, res) => res.json(jwks));

// 3. Point the facilitator at the JWKS (no headers are sent to it).
const verifier = new AgenticCommerceVerifier({
  sellerKeyResolver: { type: 'jwks', jwksUrl: 'https://api.your-service.com' },
});
```

Create a P-384 key with OpenSSL:

```bash
openssl ecparam -name secp384r1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out quote-key.pem
```

Use an EC key (P-256, P-384 or P-521) or a plain RSA key of at least 2048 bits.
RSA keys marked for RSA-PSS only (`openssl genpkey -algorithm RSA-PSS`) are not
supported: quote tokens are signed with RS256, which such a key does not allow.
`LocalQuoteSigner` rejects them, including an encrypted RSA-PSS PEM.

Every key needs a unique `kid`: verifiers pick the key named in the quote's
header. To rotate, publish both keys (`jwksDocument(next.publicJwk,
current.publicJwk)`), switch the signer to the new key, and remove the old key
once its quotes have expired. Facilitators cache the JWKS for up to an hour, so
publish a new key at least an hour before signing with it.

`jwksDocument` accepts only keys verifiers will use: EC on P-256, P-384 or
P-521, or RSA of at least 2048 bits, each with a unique `kid` and an `alg` that
matches the key. It parses the key material and rejects anything malformed or
containing private key fields. `LocalQuoteSigner` refuses a public JWK with
private key fields, and `publicJwk` never holds any. Never publish the PEM.

To keep the key elsewhere, for example in an HSM that signs remotely, implement
`QuoteSigner` (`signQuote(payload): Promise<string>` and `getServiceUrl()`).

For local development, `new LocalQuoteSigner(privateKey, publicJwk, serviceUrl)`
takes a key pair directly, and the facilitator can use
`{ type: 'static', publicJwk }`. The JWK's `alg` defaults to `ES256`, so set it for a P-384, P-521 or RSA key; the constructor checks it
matches the key and that the JWK is the key's public half.

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

When the buyer retries with a payment token, the facilitator verifies it before the resource is served. Verification needs the seller's quote-signing key, which **you configure**: a `sellerKeyResolver` is required, and the key is never discovered from the quote token's `iss` claim.

**Important:** For JWKS URLs, pass only the **base URL** — the SDK automatically appends `/.well-known/jwks.json`.

```typescript
import { x402Facilitator } from '@x402/core/facilitator';
import { x402ResourceServer } from '@x402/core/server';
import {
  AgenticCommerceVerifier,
  ExactAgenticCommerceFacilitatorScheme,
  InProcessFacilitatorClient,
  registerExactAgenticCommerceServer,
} from '@aws/fiat-extension-for-x402';

// Option 1: KMS-hosted key (credentials are optional; the default AWS chain is used)
const verifier = new AgenticCommerceVerifier({
  sellerKeyResolver: {
    type: 'kms',
    kmsKeyArn: 'arn:aws:kms:us-east-1:YOUR_ACCOUNT:alias/your-key',
    region: 'us-east-1',
  },
});

// Option 2: Self-hosted JWKS endpoint
//   sellerKeyResolver: { type: 'jwks', jwksUrl: 'https://keys.your-service.com' }
// Option 3: A public key you already hold
//   sellerKeyResolver: { type: 'static', publicJwk }

const facilitator = new x402Facilitator().register(
  'aws:base',
  new ExactAgenticCommerceFacilitatorScheme({ verifier })
);
const server = new x402ResourceServer(new InProcessFacilitatorClient(facilitator));
registerExactAgenticCommerceServer(server, { signer });
```

`AgenticCommerceFacilitatorClient` runs the same verification as a `FacilitatorClient`:

```typescript
const facilitatorClient = new AgenticCommerceFacilitatorClient({
  baseUrl: 'https://facilitator.example.com',
  sellerKeyResolver: { type: 'jwks', jwksUrl: 'https://keys.your-service.com' },
});
```

Verification checks, in order: the payment token's signature (service JWKS), its issuer and expiry, that it was issued for the quote the buyer accepted, the quote's signature (your key), that the token's audience is the quote's issuer, the quote's expiry, the price and currency, and the product. Settle is a no-op that returns the token's `payment_id` (Agent Pay auto-captures at payment creation).

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
| `PAYMENT_TOKEN_ISSUER` | `awsmp-agentpay.amazonaws.com` | `iss` in payment tokens |
| `DEFAULT_NETWORK` | `aws:base` | Network identifier for AWS Marketplace |

## Supported Algorithms

| Curve | KMS Spec | JWT Algorithm |
|-------|----------|---------------|
| P-256 | `ECC_NIST_P256` | ES256 |
| P-384 | `ECC_NIST_P384` | ES384 (default) |
| P-521 | `ECC_NIST_P521` | ES512 |

---

## DPoP

When a payment token is bound to a key (`cnf.jkt`), the request must carry a
`DPoP` header (RFC 9449) proving possession of that key for this method, URL and
payment token. The server scheme checks this in its `onBeforeVerify` hook, which
x402 core runs before it calls the facilitator. To reject replayed proofs, pass a
`DPoPNonceStore` shared by all instances of the seller:

```typescript
registerExactAgenticCommerceServer(server, { signer, dpopNonceStore: store });
```

`dpopMaxAgeSeconds` (default 60) limits how old a proof may be; 5 seconds of
clock skew are allowed on either side. Each proof id is added to the store with an
expiry (Unix seconds) one second after the last second in which the proof is still
fresh, `iat + dpopMaxAgeSeconds + 6` for a whole number of seconds; the store must
report the id as seen until then.

The proof's `htu` must equal the URL the framework reports for the request
(`HTTPAdapter.getUrl()`), without its query and fragment. Nothing is normalised
(scheme or host case, default port, trailing slash), and there is no setting for
a public base URL. Behind a proxy or load balancer, configure the framework and
the proxy so that the request URL is the public one. `@x402/express`, for
example, builds it from `req.protocol` (which honours Express's `trust proxy`
setting) and the `Host` header, so the proxy must forward the original `Host`.
The 402 response's `resource.url`, from which buyers sign `htu`, comes from the
same adapter unless the route sets `resource`.

The facilitator does not check DPoP: a facilitator called without the server
scheme's hook (for example directly, outside `x402ResourceServer`) accepts a
DPoP-bound token without a proof.

| Reason | Meaning |
|---|---|
| `dpop_required` | The payment token is bound to a key but the request has no `DPoP` header |
| `dpop_invalid` | The `DPoP` proof does not match the key, method, URL or token, is too old, or was replayed |

---

## Error Handling

Verification never throws for an invalid payment: check `isValid`.

```typescript
const result = await verifier.verify(paymentToken, {
  amount: requirements.amount,
  asset: requirements.asset,
  extra: { quoteToken: acceptedQuoteToken },
});
if (!result.isValid) {
  // result.invalidReason: invalid_payment | payment_expired | invalid_quote | quote_expired
  return res.status(402).json({ error: result.invalidReason });
}
```

Configuration errors throw `ValidationError`. The quote signers
(`LocalQuoteSigner`, `KmsQuoteSigner`) throw `SigningError` (code
`SIGNING_ERROR`) when they are misconfigured, a PEM cannot be loaded, or the
KMS Sign call fails or returns no signature. When a PEM fails to load or the
KMS Sign call fails, the original error is its `cause`. A malformed DER signature from KMS is a plain
`Error`, and an error from the signing library itself is passed through.
`SigningError` and `ValidationError` extend `AgenticCommerceError`.

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
- SellerKeyResolver for payment verification (KMS, JWKS, static key; required)
- JWT-based quote and payment tokens (ES384)
- Auto-capture on payment creation
- Client token idempotency
- DPoP proof-of-possession
- 425 tests passing

See [docs/sdk-guide.md](./docs/sdk-guide.md) for the SDK guide.

## License

Apache-2.0
