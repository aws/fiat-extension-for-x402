# FAB x402 Extension — SDK Guide

**Package:** `@x402/fab`
**Version:** 0.1.0
**Peer dependency:** `@x402/core ^2.0.0`
**Runtime:** Node.js ≥ 18.0.0

---

## Table of Contents

1. [How the x402 SDK Works](#1-how-the-x402-sdk-works)
2. [What FAB Introduces](#2-what-fab-introduces)
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
server.register('fab:aws', fabServerScheme);        // FAB (this extension)
```

When a payment comes in, the core class looks up the network from the `PaymentRequirements` and delegates to the matching scheme.

### 1.3 Key Core Types

```typescript
// What the server sends in a 402 response
interface PaymentRequirements {
  scheme: string;           // e.g. "exact", "fab"
  network: string;          // e.g. "eip155:8453", "fab:aws"
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

This is how FAB coexists with the default x402 facilitator — FAB claims `fab:*` networks, and the default facilitator handles everything else (EVM, Solana, etc.).

---

## 2. What FAB Introduces

FAB (Federated Application Billing) extends x402 to support **fiat currency payments** through trusted wallet providers. Instead of on-chain transactions, FAB uses JWT-signed tokens as proof of payment.

### 2.1 Core Concept: Two Signed Tokens

The entire FAB security model rests on two JWTs:

| Token | Signed by | Purpose |
|-------|-----------|---------|
| **Quote Token** | Service (API provider) | "I will sell you this resource for $0.15 USD. This offer expires in 5 minutes." |
| **Payment Token** | Wallet provider | "I have authorized $0.15 USD from buyer X to seller Y. Here is the transaction ID." |

The quote token is embedded in the 402 response (`extra.quoteToken`). The client forwards it to the wallet, which returns a payment token. The service verifies both signatures to confirm the payment.

### 2.2 The Wallet's Dual Role

In the default x402 model, the facilitator is a separate third-party service. In FAB, the **wallet provider IS the facilitator**. It:

- Authorizes transactions (client-facing: `POST /transactions`)
- Signs payment tokens (JWT with the wallet's private key)
- Verifies payment tokens (facilitator-facing: JWKS at `/.well-known/jwks.json`)
- Settles payments (facilitator-facing: `POST /capture`)

This eliminates the need for a separate facilitator service. The `WalletFacilitatorClient` adapter translates x402's `FacilitatorClient` interface into wallet API calls.

### 2.3 What We Built

| Module | File(s) | Purpose |
|--------|---------|---------|
| **FABServerScheme** | `src/fab/server/scheme.ts` | Implements `SchemeNetworkServer`. Generates quote tokens, signs them with the service's key, and embeds them in the 402 response. |
| **FABClientScheme** | `src/fab/client/scheme.ts` | Implements `SchemeNetworkClient`. Extracts the quote token from the 402 response, sends it to the wallet for authorization, and wraps the payment token into a `PaymentPayload`. |
| **FABFacilitatorScheme** | `src/fab/facilitator/scheme.ts` | Implements `SchemeNetworkFacilitator`. Delegates to `verify.ts` and `settle.ts` for cryptographic verification and wallet capture calls. |
| **WalletFacilitatorClient** | `src/wallet-facilitator-client.ts` | Implements `FacilitatorClient` (the x402 facilitator interface). Verifies payment tokens by checking JWT signatures against the wallet's JWKS, then settles via the wallet's `/capture` endpoint. |
| **DefaultWalletClient** | `src/wallet-client.ts` | HTTP client for wallet API calls (`/transactions`, `/capture`, `/.well-known/jwks.json`). Used by both the client scheme and the facilitator scheme. This is a reference implementation — it will be replaced by the official AWS SDK wallet client in production. The scheme constructors accept either a `WalletConfig` (which creates a `DefaultWalletClient`) or a custom object implementing `WalletClientForClient` / `WalletClientForFacilitator`, so swapping in the AWS SDK client requires no changes to the scheme layer. |
| **Builders** | `src/builders/` | `createFABResourceServer()` and `createFABClient()` — high-level APIs that wire up schemes, facilitators, and network registration in a fluent two-phase pattern. |
| **Authentication** | `src/auth/` | Pluggable auth for wallet API calls: API Key, AWS SigV4, OAuth2, Custom. Factory pattern via `createAuthenticator()`. |
| **DPoP** | `src/dpop/` | RFC 9449 Demonstrating Proof-of-Possession. Key generation, proof creation, proof verification with replay protection. Prevents token theft by binding payment tokens to ephemeral client keys. |
| **Discovery** | `src/discovery.ts` | Network registry (`registerNetwork`) and OIDC-based wallet endpoint discovery. |
| **Signers** | `src/signer.ts` | `toServiceFABSigner()` and `toWalletFABSigner()` — adapter functions that wrap `jose` key pairs into the `ServiceFABSigner` / `WalletFABSigner` interfaces. |
| **AWS Presets** | `src/networks/aws.ts` | Pre-configured scheme classes for AWS Wallet (`FABAWSClientScheme`, `FABAWSServerScheme`, `FABAWSFacilitatorScheme`) with `https://wallet.aws.com` as the default base URL. |
| **Types** | `src/types.ts` | All FAB-specific types: `QuoteTokenPayload`, `PaymentTokenPayload`, `FABPayloadV2`, settlement types, DPoP types, error classes. |
| **Constants** | `src/constants.ts` | `FAB_SCHEME`, `FAB_CAIP_FAMILY`, `FAB_SENTINEL_PAY_TO`, default validity windows. |
| **Utilities** | `src/utils.ts` | JWT decode/verify helpers, transaction ID parsing, money parsing, service JWKS caching. |

---

## 3. Extension Specification and Behaviour

### 3.1 Payment Flow (Step by Step)

```
Client                          Service                         Wallet Provider
  │                                │                                │
  │  1. GET /resource              │                                │
  │──────────────────────────────►│                                │
  │                                │                                │
  │  2. 402 Payment Required       │                                │
  │     { accepts: [{              │                                │
  │         scheme: "fab",         │                                │
  │         network: "fab:aws",    │                                │
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
  │     { quoteToken, walletId }   │                                │
  │────────────────────────────────────────────────────────────────►│
  │                                │                                │
  │  4. { transactionId,           │                                │
  │       paymentToken: "<JWT>" }  │  ◄── signed by wallet          │
  │◄────────────────────────────────────────────────────────────────│
  │                                │                                │
  │  5. GET /resource              │                                │
  │     X-PAYMENT: { paymentToken, │                                │
  │                  transactionId }                                │
  │──────────────────────────────►│                                │
  │                                │  6. Verify payment token       │
  │                                │     (check wallet JWKS)        │
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
  "aud": "fab:aws",
  "iat": 1709654400,
  "exp": 1709654700,
  "jti": "550e8400-e29b-41d4-a716-446655440000",
  "price": { "amount": "0.15", "currency": "USD" },
  "payTo": "seller-wallet-id",
  "capture": "manual",
  "reference": "premium-api-access",
  "settlement": { "method": "INST" },
  "support": { "uri": "https://support.example.com", "method": "human" },
  "terms": [{ "description": "API Terms of Service", "uri": "https://example.com/tos" }]
}
```

Default validity: 300 seconds (5 minutes). The `price`, `payTo`, `capture`, and `reference` fields are always present. `settlement`, `support`, and `terms` are optional.

### 3.3 Payment Token Structure

The payment token is a JWT signed by the wallet provider's private key:

```json
{
  "iss": "https://wallet.aws.com",
  "sub": "buyer-identity",
  "aud": "https://api.example.com",
  "iat": 1709654410,
  "exp": 1709658010,
  "payment_context": {
    "transaction_id": "fab:aws:a1b2c3d4e5f6g7h8",
    "quote_token": "<original quote token JWT>"
  },
  "cnf": {
    "jkt": "sha256-thumbprint-of-dpop-key"
  }
}
```

The `cnf.jkt` field is only present when DPoP is used. Default validity: 3600 seconds (1 hour).

### 3.4 Sentinel Values

The `@x402/core` `PaymentRequirements` type requires `payTo` and `maxTimeoutSeconds` as mandatory fields. In FAB, these are semantically redundant because the signed quote token is the authoritative source. Rather than forking the core types, FAB uses sentinel values:

| Field | Sentinel value | Rationale |
|-------|---------------|-----------|
| `payTo` | `"urn:x402:fab:see-quote"` | Not a real address. Signals that the quote token's `payTo` is authoritative. The outer field is unsigned and could be tampered with. |
| `maxTimeoutSeconds` | `exp - iat` from quote token (default: 300) | Numerically valid for any middleware that inspects it, but derived from the quote rather than independently configured. |

Both sentinels are applied in `enhancePaymentRequirements` (server scheme). The client scheme and facilitator scheme already use the quote token directly and ignore these outer fields.

### 3.5 Verification Logic

The facilitator's `verify()` performs these checks in order:

1. **Payment token signature** — Fetch the wallet's JWKS (`/.well-known/jwks.json`), verify the JWT signature. This proves the wallet authorized the payment.
2. **Quote token extraction** — Extract `payment_context.quote_token` from the verified payment token.
3. **Quote token match** — Confirm the extracted quote token string matches `requirements.extra.quoteToken` (the one the service originally issued).
4. **Quote token signature** (best-effort) — Fetch the service's JWKS and verify the quote token's signature. If the JWKS endpoint is unreachable, this step is skipped — the string match in step 3 is still valid because the wallet already verified the quote when it authorized the transaction.
5. **Transaction ID match** — Confirm `fabPayload.transactionId` matches `payment_context.transaction_id`.
6. **Expiry check** — Confirm the payment token hasn't expired.

### 3.6 Settlement Logic

The facilitator's `settle()` calls the wallet's `POST /capture` endpoint with the transaction ID, amount, and currency. The wallet transfers the held funds to the service's account.

Settlement uses `requirements.amount` and `requirements.asset` (which are real values, not sentinels). It does not use `requirements.payTo` or `requirements.maxTimeoutSeconds`.

### 3.7 Authentication

Wallet API calls support four authentication methods, configured via the `auth` field on `WalletConfig`:

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

The `createAuthenticator()` factory returns an `Authenticator` instance that is applied to every outgoing wallet request.

### 3.8 DPoP (Demonstrating Proof-of-Possession)

DPoP binds payment tokens to ephemeral client keys, preventing token theft. The flow:

1. Client generates an ephemeral key pair (`generateDPoPKeyPair('ES256')`)
2. Client creates a DPoP proof JWT (`createDPoPProof(keyPair, { method: 'POST', url: '...' })`)
3. Client sends the proof alongside the payment request
4. Server verifies the proof (`verifyDPoPProof(proof, { method, url, accessToken })`)
5. Server checks the `cnf.jkt` claim in the payment token matches the DPoP key's thumbprint

Supported algorithms: ES256 (EC P-256) and RS256 (RSA 2048). Replay protection is available via the `DPoPNonceStore` interface.

### 3.9 Wallet Provider Endpoints

Any wallet provider can integrate with FAB by exposing these standardized endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/transactions` | POST | Authorize a payment. Accepts quote token, returns transaction ID + payment token. |
| `/capture` | POST | Settle a payment. Accepts transaction ID, amount, currency. |
| `/.well-known/jwks.json` | GET | Public keys for payment token signature verification. |
| `/.well-known/x402-supported` | GET | Supported payment kinds (schemes/networks). |
| `/.well-known/openid-configuration` | GET | OIDC discovery document (optional, for endpoint discovery). |

### 3.10 Network Registration and Facilitator Routing

FAB uses a two-phase builder pattern:

```typescript
const server = createFABResourceServer({
  walletBaseUrl: 'https://wallet.aws.com',
  walletId: 'my-wallet',
  signingKeys: { privateKey, publicKey: publicJWK, alg: 'RS256' },
  serviceUrl: 'https://api.example.com',
});

// Phase 1: register which networks FAB should handle
server.registerNetwork('fab:aws');

// Phase 2: initialize (fetches supported kinds, builds routing table)
const x402Server = await server.initialize();
```

During `initialize()`, the server queries the FAB facilitator's `getSupported()` and the default x402 facilitator's `getSupported()`. The FAB facilitator only claims networks that were explicitly registered (via the `networkFilter` on `WalletFacilitatorClient`). Unregistered networks fall through to the default facilitator.

This prevents FAB from accidentally shadowing EVM or Solana networks that should be handled by the default `https://x402.org/facilitator`.

---

## 4. Additional Notes

### 4.1 Error Hierarchy

All FAB errors extend `FABError`, which extends `Error`:

| Error class | Code | When thrown |
|-------------|------|------------|
| `ValidationError` | `VALIDATION_ERROR` | Schema/format validation failures, missing required fields |
| `SignatureError` | `SIGNATURE_ERROR` | JWT signature verification failures (includes `tokenType: 'quote' \| 'payment'`) |
| `ExpiryError` | `EXPIRY_ERROR` | Token `exp` is in the past (includes `expiry` and `currentTime` timestamps) |
| `MismatchError` | `MISMATCH_ERROR` | Expected vs actual data mismatch during verification (includes `expected` and `actual`) |
| `DPoPError` | `DPOP_ERROR` | DPoP proof verification failures |

### 4.2 Caching Strategy

| Cache | TTL | Purpose |
|-------|-----|---------|
| Wallet JWKS | 1 hour | Avoid fetching public keys on every verification |
| Service JWKS | 1 hour | Avoid fetching service keys on every quote token verification |
| OIDC Discovery | 24 hours | Wallet endpoint metadata changes rarely |

All caches can be cleared programmatically (`clearServiceJWKSCache()`, `clearJWKSCache()`, `clearDiscoveryCache()`).

### 4.3 Build Outputs

The package produces three outputs via `tsup`:

- `dist/index.js` — ESM
- `dist/index.cjs` — CommonJS
- `dist/index.d.ts` — TypeScript declarations

Sub-path exports are available for tree-shaking: `@x402/fab/client`, `@x402/fab/server`, `@x402/fab/facilitator`.

### 4.4 Known Limitations

1. **AWS SigV4** — Simplified placeholder implementation. Production should use `@aws-sdk/signature-v4`.
2. **OIDC Discovery** — Stub exists but needs a real OIDC client for production use.
3. **Settlement** — The `/capture` call is a simple HTTP POST. Real settlement depends on the wallet provider's backend implementation.
4. **Zod Schemas** — Types are fully defined but Zod runtime validation schemas are not fully wired up yet.

### 4.5 Test Suite

184 tests passing across 19 test files. Run with:

```bash
npm test              # single run
npm run test:coverage # with coverage report
```

### 4.6 Project Structure

```
src/
├── index.ts                    # Package entry point and exports
├── types.ts                    # All FAB type definitions and error classes
├── constants.ts                # Scheme identifiers, defaults, sentinel values
├── config.ts                   # Configuration interfaces (signing keys, wallet, schemes)
├── signer.ts                   # JWT signer adapters (service + wallet)
├── utils.ts                    # JWT helpers, transaction IDs, money parsing, JWKS cache
├── discovery.ts                # Network registry and OIDC wallet discovery
├── wallet-client.ts            # HTTP client for wallet API calls
├── wallet-facilitator-client.ts # x402 FacilitatorClient adapter for wallet providers
├── facilitator-client.ts       # In-process facilitator (for testing/demos)
├── fab/
│   ├── client/scheme.ts        # SchemeNetworkClient implementation
│   ├── server/scheme.ts        # SchemeNetworkServer implementation
│   └── facilitator/
│       ├── scheme.ts           # SchemeNetworkFacilitator implementation
│       ├── verify.ts           # Payment verification logic
│       └── settle.ts           # Payment settlement logic
├── builders/
│   ├── resource-server-builder.ts  # createFABResourceServer / buildFABResourceServer
│   ├── client-builder.ts          # createFABClient / buildFABClient
│   └── register.ts                # registerFABNetworks helper
├── auth/
│   ├── types.ts                # Auth config interfaces
│   ├── factory.ts              # createAuthenticator()
│   ├── api-key.ts              # API Key authenticator
│   ├── aws-sigv4.ts            # AWS SigV4 authenticator
│   ├── oauth2.ts               # OAuth2 authenticator
│   └── custom.ts               # Custom authenticator
├── dpop/
│   ├── key-generation.ts       # generateDPoPKeyPair
│   ├── proof-creation.ts       # createDPoPProof, computeJWKThumbprint
│   └── proof-verification.ts   # verifyDPoPProof, extractDPoPThumbprint
└── networks/
    └── aws.ts                  # Pre-configured AWS Wallet schemes
```
