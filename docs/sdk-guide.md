# Agent Pay x402 Extension — SDK Guide

**Package:** `@aws/fiat-extension-for-x402`
**Version:** 0.1.0
**Peer dependency:** `@x402/core >=2.23.0 <3` (the `exact` scheme needs core's `dynamicExtraFields` and `paymentFlows`)
**Runtime:** Node.js ≥ 18.0.0

---

## Table of Contents

1. [How the x402 SDK Works](#1-how-the-x402-sdk-works)
2. [What Agent Pay Introduces](#2-what-agent-pay-introduces)
3. [Extension Specification and Behaviour](#3-extension-specification-and-behaviour)
4. [Additional Notes](#4-additional-notes)

---

## 1. How the x402 SDK Works

The `@x402/core` package implements the HTTP 402 Payment Required protocol for machine-to-machine payments. It defines a pluggable architecture with three roles, each backed by a base class and a scheme interface that extensions implement.

### 1.1 The Three Roles

| Role | Core class | Scheme interface | Purpose |
|------|-----------|-----------------|---------|
| **Resource Server** | `x402ResourceServer` | `SchemeNetworkServer` | Protects API endpoints behind payment requirements. Generates 402 responses, verifies incoming payments, and settles them. |
| **Client** | `x402Client` | `SchemeNetworkClient` | Consumes protected APIs. Parses 402 responses, obtains payment credentials, and retries the request with proof of payment. |
| **Facilitator** | `HTTPFacilitatorClient` (implements `FacilitatorClient`) | `SchemeNetworkFacilitator` | Intermediary that verifies and settles payments on behalf of the resource server. In the default x402 setup this is a remote service at `https://x402.org/facilitator`. |

### 1.2 Scheme Registration

Each core class maintains a registry of `(network → scheme)` pairs. You call `.register(network, scheme)` to teach the core class how to handle a specific payment network:

```typescript
// Pseudocode — this is what happens under the hood
server.register('eip155:8453', evmServerScheme);   // Base chain (EVM)
server.register('solana:mainnet', solanaScheme);    // Solana
server.register('aws:base', agentPayServerScheme);        // Agent Pay (this extension)
```

When a payment comes in, the core class looks up the network from the `PaymentRequirements` and delegates to the matching scheme.

### 1.3 Key Core Types

```typescript
// What the server sends in a 402 response
interface PaymentRequirements {
  scheme: string;           // e.g. "exact", "aws:base"
  network: string;          // e.g. "eip155:8453", "aws:base"
  payTo: string;            // recipient address/ID
  amount: string;           // e.g. "0.15"
  asset: string;            // e.g. "iso4217:USD", "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  maxTimeoutSeconds: number; // validity window
  extra: Record<string, unknown>; // scheme-specific data
}

// What the client sends back as proof of payment
interface PaymentPayload {
  x402Version: number;
  payload: Record<string, unknown>; // scheme-specific
}

// Facilitator responses
interface VerifyResponse { isValid: boolean; payer?: string; invalidReason?: string; }
interface SettleResponse { success: boolean; transaction: string; network: string; }
```

### 1.4 Scheme Interfaces

Each scheme interface has a small surface area:

```typescript
// Server scheme — generates 402 responses
interface SchemeNetworkServer {
  scheme: string;
  parsePrice(price: Price, network: Network): Promise<AssetAmount>;
  enhancePaymentRequirements(
    requirements: PaymentRequirements,
    supportedKind: { ... },
    extensionKeys: string[]
  ): Promise<PaymentRequirements>;
}

// Client scheme — creates payment payloads
interface SchemeNetworkClient {
  scheme: string;
  createPaymentPayload(
    x402Version: number,
    requirements: PaymentRequirements
  ): Promise<PaymentPayloadResult>;
}

// Facilitator scheme — verifies and settles
interface SchemeNetworkFacilitator {
  scheme: string;
  caipFamily: string;
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
  getSigners(network: string): string[];
  getExtra(network: Network): Record<string, unknown> | undefined;
}
```

### 1.5 Facilitator Routing

`x402ResourceServer` accepts an array of `FacilitatorClient` instances. During `initialize()`, it queries each facilitator's `getSupported()` endpoint and builds a routing table: for each `(scheme, network)` pair, it knows which facilitator to call. The first facilitator that claims a network wins.

This is how Agent Pay coexists with the default x402 facilitator — Agent Pay claims `fab:*` networks, and the default facilitator handles everything else (EVM, Solana, etc.).

---

## 2. What Agent Pay Introduces

Agent Pay extends x402 to support **fiat currency payments** through trusted Agent Pay providers. Instead of on-chain transactions, Agent Pay uses JWT-signed tokens as proof of payment.

### 2.1 Core Concept: Two Signed Tokens

The entire Agent Pay security model rests on two JWTs:

| Token | Signed by | Purpose |
|-------|-----------|---------|
| **Quote Token** | Service (API provider) | "I will sell you this resource for $0.15 USD. This offer expires in 5 minutes." |
| **Payment Token** | Agent Pay provider | "I have authorized $0.15 USD from buyer X to seller Y. Here is the transaction ID." |

The quote token is embedded in the 402 response (`extra.quoteToken`). The client forwards it to Agent Pay, which returns a payment token. The service verifies both signatures to confirm the payment.

### 2.2 The Agent Pay's Dual Role

In the default x402 model, the facilitator is a separate third-party service. In Agent Pay, the **Agent Pay provider IS the facilitator**. It:

- Authorizes transactions (client-facing: `POST /transactions`)
- Signs payment tokens (JWT with the Agent Pay's private key)
- Verifies payment tokens (facilitator-facing: JWKS at `/.well-known/jwks.json`)
- Settles payments (facilitator-facing: `POST /capture`)

This eliminates the need for a separate facilitator service. The `AgenticCommerceFacilitatorClient` adapter translates x402's `FacilitatorClient` interface into Agent Pay API calls.

### 2.3 What We Built

| Module | File(s) | Purpose |
|--------|---------|---------|
| **ExactAgenticCommerceServerScheme** | `src/agentic-commerce/exact/server.ts`, `quote.ts` | Implements `SchemeNetworkServer` for the `exact` scheme. Generates quote tokens, signs them with the service's key, and embeds them in the 402 response. `registerExactAgenticCommerceServer` (`exact/register.ts`) registers it on an `x402ResourceServer`. |
| **AgentPayClientScheme** | `src/agent-pay/client/scheme.ts` | Implements `SchemeNetworkClient`. Extracts the quote token from the 402 response, sends it to Agent Pay for authorization, and wraps the payment token into a `PaymentPayload`. |
| **ExactAgenticCommerceFacilitatorScheme** | `src/agentic-commerce/exact/facilitator.ts` | Implements `SchemeNetworkFacilitator` for the `exact` scheme. Verifies through `AgenticCommerceVerifier` (`src/agentic-commerce/verifier.ts`) with the seller-configured `SellerKeyResolver` (`keys.ts`); settle is a no-op returning the token's `payment_id`. |
| **AgenticCommerceFacilitatorClient** | `src/agentic-commerce/facilitator-client.ts` | Implements `FacilitatorClient` (the x402 facilitator interface) with the same verification as the facilitator scheme; requires a `sellerKeyResolver`. |
| **DefaultAgentPayClient** | `src/agent-pay-client.ts` | HTTP client for Agent Pay API calls (`/transactions`, `/capture`, `/.well-known/jwks.json`). Used by both the client scheme and the facilitator scheme. This is a reference implementation — it will be replaced by the official AWS SDK Agent Pay client in production. The scheme constructors accept either a `AgenticCommerceConfig` (which creates a `DefaultAgentPayClient`) or a custom object implementing `AgentPayClientForClient` / `AgenticCommerceClientForFacilitator`, so swapping in the AWS SDK client requires no changes to the scheme layer. |
| **Authentication** | `src/auth/` | Pluggable auth for Agent Pay API calls: API Key, AWS SigV4, OAuth2, Custom. Factory pattern via `createAuthenticator()`. |
| **DPoP** | `src/dpop/` | RFC 9449 Demonstrating Proof-of-Possession: proof verification and JWK thumbprints, used by the `exact` server scheme's `onBeforeVerify` hook. |
| **Discovery** | `src/discovery.ts` | Network registry (`registerNetwork`) and OIDC-based Agent Pay endpoint discovery. |
| **Signers** | `src/signers/` | `QuoteSigner` (`signQuote` and `getServiceUrl`) and its implementations: `KmsQuoteSigner` (`kms.ts`, the key stays in AWS KMS) and `LocalQuoteSigner` (`local.ts`, a key you manage, `fromPem` and `publicJwk`). `protocol.ts` also has the `toQuoteSigner()` and `toPaymentTokenSigner()` adapters for `jose` key pairs. |
| **Types** | `src/types.ts` | All Agent Pay-specific types: `QuoteTokenPayload`, `PaymentTokenPayload`, `AgenticCommercePayloadV2`, settlement types, DPoP types, error classes. |
| **Constants** | `src/constants.ts` | `SCHEME_EXACT`, `AGENTIC_COMMERCE_CAIP_FAMILY`, `SENTINEL_PAY_TO`, default validity windows. |
| **Utilities** | `src/utils.ts` | JWT decode/verify helpers, transaction ID parsing, money parsing, service JWKS caching. |

---

## 3. Extension Specification and Behaviour

### 3.1 Payment Flow (Step by Step)

```
Client                          Service                         Agent Pay Provider
  │                                │                                │
  │  1. GET /resource              │                                │
  │──────────────────────────────►│                                │
  │                                │                                │
  │  2. 402 Payment Required       │                                │
  │     { accepts: [{              │                                │
  │         scheme: "aws:base",         │                                │
  │         network: "aws:base",    │                                │
  │         amount: "0.15",        │                                │
  │         asset: "iso4217:USD",  │                                │
  │         extra: {               │                                │
  │           quoteToken: "<JWT>"  │  ◄── signed by service         │
  │         }                      │                                │
  │       }]                       │                                │
  │     }                          │                                │
  │◄──────────────────────────────│                                │
  │                                │                                │
  │  3. POST /transactions         │                                │
  │     { quoteToken, agentPayId }   │                                │
  │────────────────────────────────────────────────────────────────►│
  │                                │                                │
  │  4. { transactionId,           │                                │
  │       paymentToken: "<JWT>" }  │  ◄── signed by Agent Pay          │
  │◄────────────────────────────────────────────────────────────────│
  │                                │                                │
  │  5. GET /resource              │                                │
  │     X-PAYMENT: { paymentToken, │                                │
  │                  transactionId }                                │
  │──────────────────────────────►│                                │
  │                                │  6. Verify payment token       │
  │                                │     (check Agent Pay JWKS)        │
  │                                │  7. Verify quote token         │
  │                                │     (check service JWKS)       │
  │                                │  8. POST /capture              │
  │                                │─────────────────────────────►│
  │                                │  9. { success: true }          │
  │                                │◄─────────────────────────────│
  │                                │                                │
  │  10. 200 OK + resource         │                                │
  │◄──────────────────────────────│                                │
```

### 3.2 Quote Token Structure

The quote token is a JWT signed by the service's private key (RS256 or ES256):

```json
{
  "iss": "https://api.example.com",
  "aud": "aws:base",
  "iat": 1709654400,
  "exp": 1709654700,
  "jti": "550e8400-e29b-41d4-a716-446655440000",
  "price": { "amount": "0.15", "currency": "USD" },
  "payTo": "seller-agent-pay-id",
  "capture": "manual",
  "reference": "premium-api-access",
  "settlement": { "method": "INST" },
  "support": { "uri": "https://support.example.com", "method": "human" },
  "terms": [{ "description": "API Terms of Service", "uri": "https://example.com/tos" }]
}
```

Default validity: 300 seconds (5 minutes). The `price`, `payTo`, `capture`, and `reference` fields are always present. `settlement`, `support`, and `terms` are optional.

### 3.3 Payment Token Structure

The payment token is a JWT signed by the Agent Pay provider's private key:

```json
{
  "iss": "https://pay.aws.amazon.com",
  "sub": "buyer-identity",
  "aud": "https://api.example.com",
  "iat": 1709654410,
  "exp": 1709658010,
  "payment_context": {
    "transaction_id": "aws:base:a1b2c3d4e5f6g7h8",
    "quote_token": "<original quote token JWT>"
  },
  "cnf": {
    "jkt": "sha256-thumbprint-of-dpop-key"
  }
}
```

The `cnf.jkt` field is only present when DPoP is used. Default validity: 3600 seconds (1 hour).

### 3.4 Sentinel Values

The `@x402/core` `PaymentRequirements` type requires `payTo` and `maxTimeoutSeconds` as mandatory fields. In Agent Pay, these are semantically redundant because the signed quote token is the authoritative source. Rather than forking the core types, Agent Pay uses sentinel values:

| Field | Sentinel value | Rationale |
|-------|---------------|-----------|
| `payTo` | `"urn:x402:agentic-commerce:see-quote"` | Not a real address. Signals that the quote token's `payTo` is authoritative. The outer field is unsigned and could be tampered with. |
| `maxTimeoutSeconds` | `exp - iat` from quote token (default: 300) | Numerically valid for any middleware that inspects it, but derived from the quote rather than independently configured. |

Both sentinels are applied in `enhancePaymentRequirements` (server scheme). The client scheme and facilitator scheme already use the quote token directly and ignore these outer fields.

### 3.5 Verification Logic

The facilitator's `verify()` performs these checks in order:

1. **Payment token signature** — Fetch the Agent Pay's JWKS (`/.well-known/jwks.json`), verify the JWT signature. This proves Agent Pay authorized the payment.
2. **Quote token extraction** — Extract `payment_context.quote_token` from the verified payment token.
3. **Quote token match** — Confirm the extracted quote token string matches `requirements.extra.quoteToken` (the one the service originally issued).
4. **Quote token signature** (best-effort) — Fetch the service's JWKS and verify the quote token's signature. If the JWKS endpoint is unreachable, this step is skipped — the string match in step 3 is still valid because Agent Pay already verified the quote when it authorized the transaction.
5. **Transaction ID match** — Confirm `apPayload.transactionId` matches `payment_context.transaction_id`.
6. **Expiry check** — Confirm the payment token hasn't expired.

### 3.6 Settlement Logic

The facilitator's `settle()` calls the Agent Pay's `POST /capture` endpoint with the transaction ID, amount, and currency. Agent Pay transfers the held funds to the service's account.

Settlement uses `requirements.amount` and `requirements.asset` (which are real values, not sentinels). It does not use `requirements.payTo` or `requirements.maxTimeoutSeconds`.

### 3.7 Authentication

Agent Pay API calls support four authentication methods, configured via the `auth` field on `AgenticCommerceConfig`:

```typescript
// API Key
{ type: 'apiKey', apiKey: 'sk-...', headerName: 'X-API-Key' }

// AWS SigV4
{ type: 'awsSigV4', region: 'us-east-1', credentials: { accessKeyId, secretAccessKey } }

// OAuth2
{ type: 'oauth2', accessToken: '...', refreshToken: '...', tokenEndpoint: '...' }

// Custom
{ type: 'custom', authenticate: async (request) => ({ ...request, headers: { ...request.headers, 'Authorization': '...' } }) }
```

The `createAuthenticator()` factory returns an `Authenticator` instance that is applied to every outgoing Agent Pay request.

### 3.8 DPoP (Demonstrating Proof-of-Possession)

DPoP binds a payment token to the buyer's key (`cnf.jkt`). The `exact` server
scheme checks the proof in its `onBeforeVerify` hook, before x402 core calls the
facilitator:

1. A `DPoP` (or `dpop`) header is present, else `dpop_required`.
2. Its key thumbprint equals `cnf.jkt`; `typ` is `dpop+jwt` (any case); `alg` is
   ES256, ES384, ES512, RS256 or PS256; the signature verifies.
3. `iat` is at most 5 seconds ahead and at most `dpopMaxAgeSeconds` (60) plus 5
   seconds old.
4. `htm` equals the request method upper-cased, and `htu` the request URL without
   its query and fragment, exactly.
5. `ath` is the hash of the payment token; with a `dpopNonceStore`, `jti` has not
   been seen.

Any other failure is `dpop_invalid`. `verifyDPoPProof` and `extractDPoPThumbprint`
run these checks on their own.

### 3.9 Agent Pay Provider Endpoints

Any Agent Pay provider can integrate with Agent Pay by exposing these standardized endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/transactions` | POST | Authorize a payment. Accepts quote token, returns transaction ID + payment token. |
| `/capture` | POST | Settle a payment. Accepts transaction ID, amount, currency. |
| `/.well-known/jwks.json` | GET | Public keys for payment token signature verification. |
| `/.well-known/x402-supported` | GET | Supported payment kinds (schemes/networks). |
| `/.well-known/openid-configuration` | GET | OIDC discovery document (optional, for endpoint discovery). |

### 3.10 Network Registration and Facilitator Routing

This package no longer ships a builder or network presets. Register `ExactAgenticCommerceServerScheme` per network with the stock x402 `x402ResourceServer.register(network, scheme)` (or `registerExactAgenticCommerceServer`), and pass it the facilitator clients you want explicitly: given none, the stock server uses x402's default facilitator. Pass the same networks as the `networkFilter` set to `AgenticCommerceFacilitatorClient`; without it, Agent Pay claims every network its provider reports, and the first facilitator to claim a network wins.

---

## 4. Additional Notes

### 4.1 Error Hierarchy

All Agent Pay errors extend `AgenticCommerceError`, which extends `Error`:

| Error class | Code | When thrown |
|-------------|------|------------|
| `ValidationError` | `VALIDATION_ERROR` | Schema/format validation failures, missing required fields |
| `SigningError` | `SIGNING_ERROR` | Quote signing failures and quote signer misconfiguration (`LocalQuoteSigner`, `KmsQuoteSigner`); optional `details` |
| `SignatureError` | `SIGNATURE_ERROR` | JWT signature verification failures (includes `tokenType: 'quote' \| 'payment'`) |
| `ExpiryError` | `EXPIRY_ERROR` | Token `exp` is in the past (includes `expiry` and `currentTime` timestamps) |
| `MismatchError` | `MISMATCH_ERROR` | Expected vs actual data mismatch during verification (includes `expected` and `actual`) |
| `DPoPError` | `DPOP_ERROR` | DPoP proof verification failures |

### 4.2 Caching Strategy

| Cache | TTL | Purpose |
|-------|-----|---------|
| Agent Pay JWKS | 1 hour | Avoid fetching public keys on every verification |
| Service JWKS | 1 hour | Avoid fetching service keys on every quote token verification |
| OIDC Discovery | 24 hours | Agent Pay endpoint metadata changes rarely |

All caches can be cleared programmatically (`clearServiceJWKSCache()`, `clearJWKSCache()`, `clearDiscoveryCache()`).

### 4.3 Build Outputs

The package is built with `tsup`. The root entry produces:

- `dist/index.js` — ESM
- `dist/index.cjs` — CommonJS
- `dist/index.d.ts` / `dist/index.d.cts` — TypeScript declarations (ESM / CommonJS)

Sub-path exports are available for tree-shaking: `@aws/fiat-extension-for-x402/agent-pay/client`, `@aws/fiat-extension-for-x402/agentic-commerce/exact`.

### 4.4 Known Limitations

1. **OIDC Discovery** — Full OIDC discovery (`/.well-known/openid-configuration`) is a stub. However, `fetchServiceJWKS` (direct JWKS fetching from `/.well-known/jwks.json`) is fully implemented with 1-hour caching.
2. **Zod Schemas** — Types are fully defined but Zod runtime validation schemas are not fully wired up yet.

### 4.5 Test Suite

380 tests passing across 34 test files. Run with:

```bash
npm test              # single run
npm run test:coverage # with coverage report
```

### 4.6 Project Structure

```
src/
├── index.ts                    # Package entry point and exports
├── types.ts                    # All Agent Pay type definitions and error classes
├── constants.ts                # Scheme identifiers, defaults, sentinel values
├── config.ts                   # Configuration interfaces (signing keys, Agent Pay, schemes)
├── signers/protocol.ts         # JWT signer adapters (service + Agent Pay)
├── utils.ts                    # JWT helpers, transaction IDs, money parsing, JWKS cache
├── discovery.ts                # Network registry and OIDC Agent Pay discovery
├── agent-pay-client.ts            # HTTP client for Agent Pay API calls
├── agentic-commerce/facilitator-client.ts # x402 FacilitatorClient adapter for Agent Pay providers
├── facilitator-client.ts       # In-process facilitator (for testing/demos)
├── agentic-commerce/
│   ├── client/scheme.ts        # SchemeNetworkClient implementation
│   ├── exact/                  # exact scheme: server.ts, quote.ts, register.ts, facilitator.ts
│   ├── verifier.ts             # AgenticCommerceVerifier: the payment gate
│   └── keys.ts                 # SellerKeyResolver (KMS, JWKS or static key) and jwksDocument
├── auth/
│   ├── types.ts                # Auth config interfaces
│   ├── factory.ts              # createAuthenticator()
│   ├── api-key.ts              # API Key authenticator
│   ├── aws-sigv4.ts            # AWS SigV4 authenticator
│   ├── oauth2.ts               # OAuth2 authenticator
│   └── custom.ts               # Custom authenticator
└── dpop/
    └── verification.ts         # verifyDPoPProof, extractDPoPThumbprint, computeJWKThumbprint
```
