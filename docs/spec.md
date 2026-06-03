# Agent Pay x402 Extension — System Requirements Specification

**Document ID:** APAY-SRS-001  
**Version:** 0.2.0  
**Date:** 2026-05-11  
**Status:** Current State Capture  
**Methodology:** EARS (Easy Approach to Requirements Syntax) per INCOSE best practices  
**System:** aws-agent-pay-x402 — Agent Pay Extension for x402 Protocol

---

## 1. Introduction

### 1.1 Purpose

This document captures the current-state requirements of the Agent Pay x402 TypeScript extension using EARS syntax, consistent with INCOSE systems engineering practices. It serves as a formal, testable specification derived from the implemented codebase, design documentation, and task tracking artifacts.

### 1.2 Scope

The system under specification is the `aws-agent-pay-x402` npm package — a TypeScript library that extends the x402 HTTP payment protocol to support fiat currency payments through trusted Agent Pay providers. The system operates within a three-party architecture: API consumers (clients), API providers (servers/resource services), and Agent Pay providers (facilitators).

### 1.3 Definitions and Abbreviations

| Term | Definition |
|------|-----------|
| Agent Pay | Agent Pay — fiat payment scheme for x402 |
| x402 | HTTP 402 Payment Required protocol for machine-to-machine payments |
| JWT | JSON Web Token (RFC 7519) |
| JWK | JSON Web Key (RFC 7517) |
| DPoP | Demonstrating Proof-of-Possession (RFC 9449) |
| Quote Token | Service-signed JWT describing price, terms, and payment recipient |
| Payment Token | Agent Pay-signed JWT authorizing a specific payment transaction |
| Facilitator | Entity that verifies and settles payments (Agent Pay provider in Agent Pay) |
| CAIP | Chain Agnostic Improvement Proposal (network identifier format) |
| SigV4 | AWS Signature Version 4 authentication protocol |

### 1.4 Stakeholders

| Stakeholder | Role |
|-------------|------|
| API Provider (Service) | Protects resources behind payment requirements, generates quote tokens, verifies payments |
| API Consumer (Client) | Requests resources, obtains payment tokens from Agent Pay, submits payments |
| Agent Pay Provider | Authorizes transactions, signs payment tokens, settles funds |

### 1.5 References

| ID | Document |
|----|----------|
| REF-1 | `docs/tasks.md` — Implementation Plan and Task Tracking |
| REF-2 | `README.md` — Package Overview and Usage Guide |
| REF-3 | x402 Protocol Specification (x402.org) |
| REF-4 | RFC 7519 — JSON Web Token (JWT) |
| REF-5 | RFC 7517 — JSON Web Key (JWK) |
| REF-6 | RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP) |
| REF-7 | INCOSE Guide for Writing Requirements (INCOSE-TP-2010-006-04) |
| REF-8 | `docs/sdd-process.md` — SDD Collaboration Process |

---

## 2. System Overview

### 2.1 System Context

The Agent Pay x402 extension operates as a library consumed by three categories of integrators within the x402 payment ecosystem:

```
┌─────────────┐       HTTP 402        ┌─────────────┐
│  API Client  │◄─────────────────────►│ API Service  │
│  (Consumer)  │   Payment Tokens      │  (Provider)  │
└──────┬───────┘                       └──────┬───────┘
       │                                      │
       │  Authorize                    Verify/│Settle
       │  Transaction                         │
       ▼                                      ▼
┌──────────────────────────────────────────────┐
│            Agent Pay Provider                    │
│         (Facilitator in x402)                │
└──────────────────────────────────────────────┘
```

### 2.2 Payment Flow Summary

1. Client requests a protected resource from the service.
2. Service returns HTTP 402 with payment requirements containing a signed quote token.
3. Client sends the quote token to its Agent Pay provider for authorization.
4. Agent Pay provider verifies the quote, captures the payment, and returns a signed payment token.
5. Client retries the resource request with the payment token.
6. Service verifies the payment token signature (Agent Pay's public key via JWKS).
7. Service delivers the resource.

Note: Agent Pay auto-captures during step 4. The `capture` field in the quote token (`"auto"` or `"manual"`) is a seller-side semantic that controls whether the middleware delivers immediately after verification or defers to the route handler for additional logic.

### 2.3 Architectural Constraints

- CON-1: The system shall be implemented as a TypeScript npm package.
- CON-2: The system shall depend on `@x402/core` as a peer dependency.
- CON-3: The system shall target Node.js 18.0.0 or higher.
- CON-4: The system shall produce ESM, CommonJS, and TypeScript declaration outputs.
- CON-5: The system shall use `jose` for all JWT/JWK operations and `zod` for schema validation.

### 2.4 Sentinel Value Convention for x402 Core Fields

The `@x402/core` `PaymentRequirements` type requires `payTo` (string) and `maxTimeoutSeconds` (number) as mandatory fields. In Agent Pay, these fields are semantically redundant because the signed quote token is the authoritative source for payment recipient and validity:

- The quote token's `payTo` field (signed by the service) is the trusted recipient. The outer `PaymentRequirements.payTo` is unsigned and could be tampered with.
- The quote token's `exp - iat` window defines validity. The outer `maxTimeoutSeconds` is a leftover from the EVM/SVM `exact` scheme where it controls on-chain `validBefore`.

Rather than modifying the `@x402/core` type contract (which would be a breaking change across all x402 mechanisms), Agent Pay uses sentinel values:

- `payTo` is set to `"urn:x402:agent-pay:see-quote"` — a URN that is clearly not a real address and signals that the quote token should be consulted.
- `maxTimeoutSeconds` is set to the quote token's validity window (`exp - iat`), keeping the field numerically meaningful for any x402 middleware that inspects it.

Both sentinels are applied in `enhancePaymentRequirements` (the server scheme's last touch before the 402 response). The Agent Pay client scheme and facilitator scheme already use the quote token rather than these outer fields, so this change formalizes existing behavior.

---

## 3. Requirements

Requirements are organized by functional area and written in EARS syntax. Each requirement is uniquely identified and traceable to design artifacts.

### EARS Pattern Key

| Pattern | Template | Use |
|---------|----------|-----|
| Ubiquitous | The \<system\> shall \<action\>. | Always-on behavior |
| Event-Driven | When \<event\>, the \<system\> shall \<action\>. | Triggered behavior |
| State-Driven | While \<state\>, the \<system\> shall \<action\>. | Behavior during a condition |
| Unwanted Behavior | If \<condition\>, then the \<system\> shall \<action\>. | Error/exception handling |
| Optional Feature | Where \<feature is configured\>, the \<system\> shall \<action\>. | Configurable behavior |
| Complex | While \<state\>, when \<event\>, the \<system\> shall \<action\>. | Combined triggers |

---

### 3.1 Scheme Registration and Identity

| ID | Requirement |
|----|-------------|
| APAY-REG-001 | The Agent Pay extension shall identify itself with the scheme name `"fab"`. |
| APAY-REG-002 | The Agent Pay extension shall use the CAIP family identifier `"fab:*"` for facilitator network matching. |
| APAY-REG-003 | The Agent Pay extension shall support network identifiers in the format `fab:<provider>` (e.g., `aws:base`). |
| APAY-REG-004 | The Agent Pay extension shall implement the `SchemeNetworkClient`, `SchemeNetworkServer`, and `SchemeNetworkFacilitator` interfaces from `@x402/core`. |

### 3.2 Type System

| ID | Requirement |
|----|-------------|
| APAY-TYP-001 | The system shall define a `CaptureMode` type constrained to the values `"manual"` and `"auto"`. |
| APAY-TYP-002 | The system shall define a `SettlementMethod` type constrained to the values `"INST"` (instant), `"CLRG"` (clearing/batch), and `"CRDT"` (credit/invoice). |
| APAY-TYP-003 | The system shall define a `SettlementCycle` type constrained to the values `"MNTH"` (monthly), `"WEEK"` (weekly), and `"QRTR"` (quarterly). |
| APAY-TYP-004 | The system shall define a `AgentPayPaymentExtra` interface containing a required `quoteToken` string field and optional `capture`, `reference`, `settlement`, `support`, and `terms` fields. |
| APAY-TYP-005 | The system shall define a `QuoteTokenPayload` interface containing the JWT claims `iss`, `aud`, `iat`, `exp`, `jti`, `price`, `payTo`, `capture`, `reference`, and optional `settlement`, `support`, `terms`, `description` (string), and `dimensions` (Record<string, string \| number>). |
| APAY-TYP-006 | The system shall define a `PaymentTokenPayload` interface containing the JWT claims `iss`, `sub`, `aud`, `iat`, `exp`, `payment_context` (with `transaction_id` and `quote_token`), and optional `cnf.jkt` for DPoP binding. |
| APAY-TYP-007 | The system shall define a `AgentPayPayloadV2` interface containing `paymentToken`, `paymentId`, and `transactionId` (deprecated alias for `paymentId`) string fields for x402 payload transport. |

### 3.3 Error Handling

| ID | Requirement |
|----|-------------|
| APAY-ERR-001 | The system shall define a `AgentPayError` base class extending `Error` with `code` (string) and `details` (optional record) properties. |
| APAY-ERR-002 | If schema or format validation fails, then the system shall throw a `ValidationError` with code `"VALIDATION_ERROR"` and a descriptive message indicating the violated constraint. |
| APAY-ERR-003 | If JWT signature verification fails, then the system shall throw a `SignatureError` with code `"SIGNATURE_ERROR"` and a `tokenType` property indicating `"quote"` or `"payment"`. |
| APAY-ERR-004 | If a token's `exp` claim is earlier than the current time, then the system shall throw an `ExpiryError` with code `"EXPIRY_ERROR"` containing the `expiry` and `currentTime` timestamps. |
| APAY-ERR-005 | If expected and actual data values do not match during verification, then the system shall throw a `MismatchError` with code `"MISMATCH_ERROR"` containing `expected` and `actual` values. |
| APAY-ERR-006 | If DPoP proof verification fails, then the system shall throw a `DPoPError` with code `"DPOP_ERROR"` and contextual details describing the failure reason. |

---

### 3.4 Server Scheme (Quote Token Generation)

| ID | Requirement |
|----|-------------|
| APAY-SRV-001 | When `enhancePaymentRequirements` is called, the server scheme shall generate a quote token JWT signed with the service's private key using the RS256 or ES256 algorithm. |
| APAY-SRV-002 | The server scheme shall set the quote token `iss` claim to the service URL. |
| APAY-SRV-003 | The server scheme shall set the quote token `aud` claim to the target network identifier. |
| APAY-SRV-004 | The server scheme shall set the quote token `iat` claim to the current Unix timestamp in seconds. |
| APAY-SRV-005 | The server scheme shall set the quote token `exp` claim to `iat` plus 300 seconds (5 minutes) by default. |
| APAY-SRV-006 | The server scheme shall set the quote token `jti` claim to a unique UUID generated via `crypto.randomUUID()`. |
| APAY-SRV-007 | The server scheme shall populate the quote token `price` field with the amount and currency extracted from the payment requirements. |
| APAY-SRV-008 | The server scheme shall set the quote token `payTo` field to the service's Agent Pay identifier from the payment requirements. |
| APAY-SRV-009 | The server scheme shall set the quote token `capture` field to the value from `extra.capture`, defaulting to `"manual"`. |
| APAY-SRV-010 | The server scheme shall set the quote token `reference` field to the value from `extra.reference`, defaulting to `"RESOURCE"`. |
| APAY-SRV-011 | Where settlement, support, terms, description, or dimensions are provided in the payment requirements extra data, the server scheme shall include them in the quote token payload. |
| APAY-SRV-012 | When `enhancePaymentRequirements` completes, the server scheme shall return the original payment requirements with the signed quote token added to the `extra.quoteToken` field. |
| APAY-SRV-013 | When `parsePrice` is called with a money string, the server scheme shall extract the numeric amount and currency code and return an `AssetAmount` with the asset formatted as `iso4217:<currency>`. |
| APAY-SRV-014 | The server scheme constructor shall accept either a `ServiceFABSigner` instance or a `SigningKeysConfig` with `serviceUrl` (from which a signer is created via `toServiceAgentPaySigner`). |
| APAY-SRV-015 | If the server scheme constructor receives neither a `signer` nor `signingKeys` + `serviceUrl`, then it shall throw a `ValidationError`. |
| APAY-SRV-016 | When `enhancePaymentRequirements` completes, the server scheme shall set the returned `PaymentRequirements.payTo` field to the sentinel value `AGENT_PAY_SENTINEL_PAY_TO` (`"urn:x402:agent-pay:see-quote"`). |
| APAY-SRV-017 | When `enhancePaymentRequirements` completes, the server scheme shall set the returned `PaymentRequirements.maxTimeoutSeconds` field to the quote token's validity window (`exp` minus `iat`). |

### 3.5 Client Scheme (Payment Token Creation)

| ID | Requirement |
|----|-------------|
| APAY-CLI-001 | When `createPaymentPayload` is called, the client scheme shall extract the `quoteToken` from the payment requirements `extra` field. |
| APAY-CLI-002 | If the payment requirements `extra` field does not contain a `quoteToken`, then the client scheme shall throw a `ValidationError`. |
| APAY-CLI-003 | The client scheme shall generate a `clientToken` (UUID) for idempotency if one is not provided. |
| APAY-CLI-004 | The client scheme shall call the Agent Pay provider's `createPayment()` method with `{ quoteToken, clientToken, dpopJwk? }`. |
| APAY-CLI-005 | When the Agent Pay provider returns a `paymentId` and `paymentToken`, the client scheme shall wrap them in a `AgentPayPayloadV2` (setting both `paymentId` and `transactionId` for backward compatibility) and return a `PaymentPayloadResult`. |
| APAY-CLI-006 | Where a `dpopJwk` is configured on the client scheme, the client scheme shall include it in the `createPayment` request for DPoP binding. |
| APAY-CLI-007 | The client scheme constructor shall accept either a `AgentPayClientForClient` instance or a `AgentPayConfig` (from which a `DefaultAgentPayClient` is created). |
| APAY-CLI-008 | If the client scheme constructor receives neither a `agentPayClient` nor a `Agent Pay` configuration, then it shall throw a `ValidationError`. |

### 3.6 Facilitator Scheme (Verification and Settlement)

| ID | Requirement |
|----|-------------|
| APAY-FAC-001 | When `verify` is called, the facilitator scheme shall verify the payment token JWT signature using the Agent Pay's public key via the `AgentPayClientForFacilitator`. |
| APAY-FAC-002 | When `verify` is called, the facilitator scheme shall verify that `requirements.extra.quoteToken` exists. |
| APAY-FAC-003 | When `verify` is called, the facilitator scheme shall verify the payment ID in the payload matches the payment ID in the verified payment token. |
| APAY-FAC-003a | When `verify` is called, the facilitator scheme shall verify the quote token JWT signature by fetching the service's JWKS from `{quote.iss}/.well-known/jwks.json` via `fetchServiceJWKS` and calling `jose.jwtVerify`. If signature verification fails, the facilitator shall return `{ isValid: false, invalidReason: "invalid_quote" }`. |
| APAY-FAC-003b | When `verify` is called, the facilitator scheme shall check the quote token's `exp` claim against the current time. If the quote token has expired, the facilitator shall return `{ isValid: false, invalidReason: "quote_expired" }`. |
| APAY-FAC-004 | When `verify` is called, the facilitator scheme shall verify that the amount and currency in the quote token match the payment requirements. |
| APAY-FAC-005 | When verification succeeds, the facilitator scheme shall return `{ valid: true, transactionId }`. |
| APAY-FAC-006 | If any verification step fails, then the facilitator scheme shall return `{ valid: false, error: <message> }` without throwing an exception. |
| APAY-FAC-007 | When `settle` is called, the facilitator scheme shall return `{ success: true }` immediately without making an HTTP call. Agent Pay auto-captures during `CreateAgentPayment` — there is no separate capture endpoint. The `capture` field in the quote token is a seller-side semantic only. |
| APAY-FAC-008 | When `verify` is called with a `requestContext` parameter, and the payment token contains `cnf.jkt`, the facilitator shall require a valid DPoP proof in `requestContext.dpopProof`. It shall compute the JWK thumbprint of the proof's embedded public key and compare it to `cnf.jkt`. If they do not match, return `{ isValid: false, invalidReason: "dpop_invalid" }`. If `cnf.jkt` is present but no DPoP proof is provided, return `{ isValid: false, invalidReason: "dpop_required" }`. If `cnf` is absent, skip DPoP verification entirely. |
| APAY-FAC-009 | When `getSigners` is called, the facilitator scheme shall return an array containing the configured `agentPayId`. |
| APAY-FAC-010 | When `getExtra` is called, the facilitator scheme shall return an object containing the `agentPayId`. |
| APAY-FAC-011 | The facilitator scheme constructor shall accept either a `AgentPayClientForFacilitator` instance or a `AgentPayConfig` (from which a `DefaultAgentPayClient` is created). |
| APAY-FAC-012 | If the facilitator scheme constructor receives neither a `agentPayClient` nor a `Agent Pay` configuration, then it shall throw a `ValidationError`. |

---

### 3.7 Signer Interfaces

| ID | Requirement |
|----|-------------|
| APAY-SGN-001 | The system shall define a `ServiceAgentPaySigner` interface with methods `signQuote(payload): Promise<string>`, `getPublicKey(): JWK`, and `getServiceUrl(): string`. |
| APAY-SGN-002 | The system shall define a `AgentPaySigner` interface with methods `signPayment(payload): Promise<string>`, `getPublicKey(): JWK`, and `getAddresses(): string[]`. |
| APAY-SGN-003 | When `toServiceAgentPaySigner` is called with a private key, public JWK, and service URL, the system shall return a `ServiceAgentPaySigner` that signs JWTs with the `RS256` algorithm and `typ: "JWT"` header. |
| APAY-SGN-004 | When `toAgentPaySigner` is called with a private key, public JWK, and Agent Pay ID, the system shall return a `AgentPaySigner` that signs JWTs with the `RS256` algorithm and `typ: "JWT"` header. |
| APAY-SGN-005 | The system shall provide a `createKmsSigner(config)` factory that returns a `ServiceAgentPaySigner` backed by AWS KMS. Config accepts: `keyArn`, `region`, `serviceUrl`, `credentials` (AWS credential provider), and `algorithm` (default `ECDSA_SHA_384`). |
| APAY-SGN-006 | When `createKmsSigner` signs a quote token, it shall call KMS `Sign` with `MessageType.DIGEST` and the SHA-384 hash of the JWT signing input, then convert the DER signature to JWS (r‖s) format. |
| APAY-SGN-007 | The `createKmsSigner` shall call KMS `GetPublicKey` to retrieve the public key material and export it as a JWK for the `getPublicKey()` method. |

### 3.8 Utility Functions

| ID | Requirement |
|----|-------------|
| APAY-UTL-001 | When `decodeQuoteToken` is called with a valid JWT string, the system shall return the decoded `QuoteTokenPayload` without verifying the signature. |
| APAY-UTL-002 | If `decodeQuoteToken` is called with a malformed JWT string, then the system shall throw a `ValidationError` with the message `"Invalid quote token format"`. |
| APAY-UTL-003 | When `verifyQuoteToken` is called with a token and public key, the system shall verify the JWT signature and check the `exp` claim against the current time. |
| APAY-UTL-004 | When `verifyPaymentToken` is called with a token and public key, the system shall verify the JWT signature and check the `exp` claim against the current time. |
| APAY-UTL-005 | When `extractQuoteFromPayment` is called with a `PaymentTokenPayload`, the system shall return the `payment_context.quote_token` value. |
| APAY-UTL-006 | When `generateTransactionId` is called with a network and Agent Pay ID, the system shall return a string in the format `{network}:{16-char-hex-id}`. |
| APAY-UTL-007 | When `parseMoneyToDecimal` is called with a numeric value, the system shall return `{ amount: <number>, currency: "USD" }`. |
| APAY-UTL-008 | When `parseMoneyToDecimal` is called with a string matching `$?(\d+\.?\d*)\s*([A-Z]{3})?`, the system shall extract the amount and currency (defaulting to `"USD"`). |
| APAY-UTL-009 | If `parseMoneyToDecimal` is called with a string that does not match the expected format, then the system shall throw a `ValidationError`. |
| APAY-UTL-010 | When `parseTransactionId` is called with a valid transaction ID, the system shall return `{ network, id }` components. |
| APAY-UTL-011 | If `parseTransactionId` is called with a string that does not contain a colon delimiter or whose network does not start with `"fab:"`, then the system shall throw a `ValidationError`. |
| APAY-UTL-012 | When `formatTransactionId` is called with a network starting with `"fab:"` and an ID, the system shall return `{network}:{id}`. |
| APAY-UTL-013 | If `formatTransactionId` is called with a network that does not start with `"fab:"`, then the system shall throw a `ValidationError`. |
| APAY-UTL-014 | When `isValidTransactionId` is called, the system shall return `true` if `parseTransactionId` succeeds and `false` otherwise, without throwing exceptions. |
| APAY-UTL-015 | When `extractNetworkFromTransactionId` is called, the system shall return the network component of the transaction ID. |

### 3.9 Constants

| ID | Requirement |
|----|-------------|
| APAY-CON-001 | The system shall define `AGENT_PAY_SCHEME` as the string `"fab"`. |
| APAY-CON-002 | The system shall define `DEFAULT_QUOTE_VALIDITY_SECONDS` as `300` (5 minutes). |
| APAY-CON-003 | The system shall define `DEFAULT_PAYMENT_VALIDITY_SECONDS` as `3600` (1 hour). |
| APAY-CON-004 | The system shall define `SETTLEMENT_METHODS` containing `INST`, `CLRG`, and `CRDT`. |
| APAY-CON-005 | The system shall define `SETTLEMENT_CYCLES` containing `MNTH`, `WEEK`, and `QRTR`. |
| APAY-CON-006 | The system shall define `AGENT_PAY_CAIP_FAMILY` as the string `"fab:*"`. |
| APAY-CON-007 | The system shall define a sentinel constant `AGENT_PAY_SENTINEL_PAY_TO` with value `"urn:x402:agent-pay:see-quote"` to indicate that the `payTo` field in `PaymentRequirements` is not authoritative and the quote token shall be consulted instead. |
| APAY-CON-008 | The system shall define `DEFAULT_NETWORK` as the string `"aws:base"`. |
| APAY-CON-009 | The system shall define `AGENT_PAY_AUDIENCE` as `"aws:marketplace"` — the required `aud` claim in quote tokens sent to the Agent Pay service. |
| APAY-CON-010 | The system shall define `PAYMENT_JWT_ISSUER` as `"awsmp-agentpay.amazonaws.com"` — the `iss` claim in payment tokens signed by the Agent Pay service. |
| APAY-CON-011 | The system shall define `AGENT_PAY_JWKS_BASE_URL` as the default CDN URL for Agent Pay's public signing keys. The SDK appends `/.well-known/jwks.json` automatically. |

---

### 3.10 Authentication

| ID | Requirement |
|----|-------------|
| APAY-AUTH-001 | The system shall support API Key authentication by adding a configurable header (default `"X-API-Key"`) with the key value to outgoing Agent Pay requests. |
| APAY-AUTH-002 | Where an optional `prefix` is configured for API Key authentication, the system shall prepend the prefix to the API key value in the header. |
| APAY-AUTH-003 | The system shall support OAuth2 Bearer token authentication by adding an `Authorization: Bearer <token>` header to outgoing Agent Pay requests. |
| APAY-AUTH-004 | Where a `refreshToken` and `tokenEndpoint` are configured for OAuth2 authentication, the system shall refresh the access token when it expires and invoke the `onTokenRefresh` callback with the new token. |
| APAY-AUTH-005 | The system shall support AWS SigV4 authentication by signing outgoing Agent Pay requests with the provided credentials and region. |
| APAY-AUTH-006 | The system shall support custom authentication by delegating to a user-provided `authenticate(request): Promise<AuthenticatedRequest>` function. |
| APAY-AUTH-007 | When `createAuthenticator` is called with an `AuthConfig`, the system shall return the appropriate authenticator instance based on the `type` discriminant (`"apiKey"`, `"awsSigV4"`, `"oauth2"`, or `"custom"`). |
| APAY-AUTH-008 | The system shall define authentication error types: `AuthenticationError` (base, with `authMethod`, `originalError`, and `retryable` properties), `InvalidCredentialsError`, `ExpiredCredentialsError` (retryable), `MissingCredentialsError`, and `AuthenticationTimeoutError` (retryable). |

### 3.11 DPoP (Demonstrating Proof-of-Possession)

| ID | Requirement |
|----|-------------|
| APAY-DPOP-001 | When `generateDPoPKeyPair` is called with algorithm `"ES256"`, the system shall generate an EC P-256 key pair and return the public key in JWK format with `alg: "ES256"` and `use: "sig"`. |
| APAY-DPOP-002 | When `generateDPoPKeyPair` is called with algorithm `"RS256"`, the system shall generate an RSA 2048-bit key pair and return the public key in JWK format with `alg: "RS256"` and `use: "sig"`. |
| APAY-DPOP-003 | When `createDPoPProof` is called, the system shall create a JWT with `typ: "dpop+jwt"` in the protected header, the public key embedded as `jwk`, and a payload containing `jti`, `htm` (HTTP method, uppercased), `htu` (HTTP URL), and `iat` (current timestamp). |
| APAY-DPOP-004 | Where an `accessToken` is provided in the DPoP proof options, the system shall compute a SHA-256 hash of the access token, base64url-encode it, and include it as the `ath` claim. |
| APAY-DPOP-005 | When `computeJWKThumbprint` is called with a JWK, the system shall return the SHA-256 thumbprint using `jose.calculateJwkThumbprint`. |
| APAY-DPOP-006 | When `verifyDPoPProof` is called, the system shall extract the public key from the proof's `jwk` header, verify the JWT signature, and validate the payload claims. |
| APAY-DPOP-007 | If the DPoP proof `typ` header is not `"dpop+jwt"`, then the system shall throw a `DPoPError`. |
| APAY-DPOP-008 | If the DPoP proof `jwk` header is missing, then the system shall throw a `DPoPError`. |
| APAY-DPOP-009 | If the DPoP proof `iat` is older than `maxAge` seconds (default 60), then the system shall throw a `DPoPError` indicating the proof is stale. If the `iat` is more than 5 seconds in the future, the system shall throw a `DPoPError` indicating the proof is from the future. |
| APAY-DPOP-010 | If the DPoP proof `htm` does not match the expected HTTP method (case-insensitive comparison after uppercasing), then the system shall throw a `DPoPError`. |
| APAY-DPOP-011 | If the DPoP proof `htu` does not match the expected HTTP URL, then the system shall throw a `DPoPError`. |
| APAY-DPOP-012 | Where an `accessToken` is provided for verification, if the DPoP proof `ath` claim does not match the SHA-256 hash of the access token, then the system shall throw a `DPoPError`. |
| APAY-DPOP-013 | Where a `nonceStore` is configured, if the DPoP proof `jti` has already been seen, then the system shall throw a `DPoPError` indicating a replay attack. |
| APAY-DPOP-014 | Where a `nonceStore` is configured and the `jti` is new, the system shall store the `jti` with an expiry of `iat + maxAge`. |
| APAY-DPOP-015 | When `extractDPoPThumbprint` is called with a DPoP proof JWT, the system shall extract the `jwk` from the protected header and return its SHA-256 thumbprint. |
| APAY-DPOP-016 | If `extractDPoPThumbprint` is called with a proof that has no `jwk` header, then the system shall throw a `DPoPError`. |
| APAY-DPOP-017 | The system shall define a `DPoPAlgorithm` type constrained to the values `"ES256"`, `"ES384"`, `"ES512"`, and `"RS256"`. |
| APAY-DPOP-018 | The system shall provide a `toDpopJwk` function that converts a DPoP key pair's public key to the `DpopJwk` format (`{ kty: 'EC', crv, x, y }`) expected by the Agent Pay API. If the key is not EC, it shall throw a `DPoPError`. |

---

### 3.12 Agent Pay Client

| ID | Requirement |
|----|-------------|
| APAY-WCL-001 | The system shall define a `DefaultAgentPayClient` class that implements both `AgentPayClientForClient` and `AgentPayClientForFacilitator` interfaces. |
| APAY-WCL-002 | When `createPayment` is called on the Agent Pay client, the system shall send an HTTP POST to `{baseUrl}/CreateAgentPayment` with `{ quoteToken, clientToken?, dpopJwk? }` as JSON. |
| APAY-WCL-003 | When `verifyPaymentToken` is called on Agent Pay client, the system shall fetch the Agent Pay's public keys from `{baseUrl}/.well-known/jwks.json` using `jose.createRemoteJWKSet` and verify the JWT signature. |
| APAY-WCL-004 | The `DefaultAgentPayClient` shall NOT provide a `capturePayment` method. Agent Pay auto-captures on creation. |
| APAY-WCL-005 | Where authentication is configured on Agent Pay client, the system shall apply the configured authenticator to all outgoing HTTP requests before sending. |
| APAY-WCL-006 | Agent Pay client shall use a single `createRemoteJWKSet` instance for payment token verification. Jose's internal behavior handles key rotation via kid-miss refetch and coalesces concurrent requests. Client-side TTL caching is not applied — Agent Pay enforces `Cache-Control: no-store` on their JWKS endpoint. |
| APAY-WCL-007 | If Agent Pay returns a non-OK HTTP response to `authorize`, then Agent Pay client shall throw a `ValidationError` containing the HTTP status code and response body. |
| APAY-WCL-008 | If the Agent Pay response to `createPayment` is missing `paymentId` or `paymentToken`, then the Agent Pay client shall throw a `ValidationError`. |
| APAY-WCL-010 | The `DefaultAgentPayClient` constructor shall strip trailing slashes from the `baseUrl`. |
| APAY-WCL-011 | If the Agent Pay service returns HTTP 409 (Conflict), the client shall throw an `IdempotencyConflictError` with the `clientToken` that caused the conflict. |

### 3.13 Facilitator Client

| ID | Requirement |
|----|-------------|
| APAY-FCL-001 | The system shall provide an `InProcessFacilitatorClient` that implements the `FacilitatorClient` interface from `@x402/core/http` by wrapping an in-process `x402Facilitator` instance. |
| APAY-FCL-002 | The `InProcessFacilitatorClient` shall delegate `verify`, `settle`, and `getSupported` calls directly to the wrapped `x402Facilitator`. |
| APAY-FCL-003 | The system shall provide a `AgentPayFacilitatorClient` that implements the `FacilitatorClient` interface from `@x402/core/http` by communicating with the Agent Pay provider's HTTP API. |
| APAY-FCL-004 | The `AgentPayFacilitatorClient` constructor shall accept: `agentPayBaseUrl` (string), optional `AgentPayFacilitatorAuthConfig`, optional `networkFilter` (Set<Network>), optional `jwksBaseUrl` (defaults to `AGENT_PAY_JWKS_BASE_URL` CDN), and optional `SellerKeyResolver`. |
| APAY-FCL-005 | The system shall define a `AgentPayFacilitatorAuthConfig` interface with an optional `getAuthHeaders(): Promise<Record<string, string>>` method. |
| APAY-FCL-005a | The system shall define a `SellerKeyResolver` discriminated union type with two variants: `{ type: 'kms'; kmsKeyArn; region; credentials }` for KMS-hosted seller keys, and `{ type: 'jwks'; jwksUrl }` for explicit JWKS URL resolution. |
| APAY-FCL-006 | When `getSupported` is called on the `AgentPayFacilitatorClient`, the system shall fetch from `{agentPayBaseUrl}/.well-known/x402-supported` and return the supported payment kinds. |
| APAY-FCL-007 | When `verify` is called on the `AgentPayFacilitatorClient`, the system shall: (a) fetch the Agent Pay's JWKS from `{jwksBaseUrl}/.well-known/jwks.json`, (b) verify the payment token signature, (c) check payment token expiry, (d) extract and match the quote token against requirements (constant-time compare), (e) resolve the seller's public key via `SellerKeyResolver` (KMS, explicit JWKS URL, or fallback to `{quote.iss}/.well-known/jwks.json`), (f) verify the quote token signature, and (g) verify amounts match. |
| APAY-FCL-007a | When `SellerKeyResolver` is `{ type: 'kms' }`, the system shall call `kms:GetPublicKey` with the provided ARN and credentials, then import the DER-encoded public key for signature verification. |
| APAY-FCL-007b | When `SellerKeyResolver` is `{ type: 'jwks' }`, the system shall fetch JWKS from the provided `jwksUrl` instead of the quote token's `iss` claim. |
| APAY-FCL-007c | When `SellerKeyResolver` is omitted, the system shall fall back to fetching JWKS from `{quote.iss}/.well-known/jwks.json` (original behavior). |
| APAY-FCL-008 | When `settle` is called on the `AgentPayFacilitatorClient`, the system shall return `{ success: true }` immediately without making an HTTP call. Agent Pay auto-captures during `CreateAgentPayment` — there is no `/capture` endpoint. |
| APAY-FCL-009 | The `AgentPayFacilitatorClient` shall cache JWKS responses with a TTL of 1 hour. |
| APAY-FCL-010 | Where `AgentPayFacilitatorAuthConfig` is provided, the `AgentPayFacilitatorClient` shall include the auth headers in JWKS fetch requests. |

### 3.13a Builders (Network-Aware Facilitator Routing)

| ID | Requirement |
|----|-------------|
| APAY-BLD-001 | The system shall provide a `createAgentPayResourceServer` factory function that accepts base configuration (Agent Pay URL, signing keys, service URL) and returns a `FABResourceServer` object with a `registerNetwork` method for adding networks individually. |
| APAY-BLD-001a | The system shall provide a `buildAgentPayResourceServer` convenience function that accepts a list of networks and returns a fully configured `x402ResourceServer` with Agent Pay facilitator precedence over the default facilitator. This delegates to `createAgentPayResourceServer` internally. |
| APAY-BLD-002 | The system shall provide a `createAgentPayClient` factory function that accepts base configuration (Agent Pay URL, Agent Pay ID, auth) and returns a `FABClient` object with a `registerNetwork` method for adding networks individually. |
| APAY-BLD-002a | The system shall provide a `buildAgentPayClient` convenience function that accepts a list of networks and returns a fully configured `x402Client` with Agent Pay client schemes registered for each network. This delegates to `createAgentPayClient` internally. |
| APAY-BLD-003 | When `initialize()` is called without `disableDefaultFallback`, the system shall include an `HTTPFacilitatorClient` as a fallback facilitator for networks not handled by FAB. Routing options (`disableDefaultFallback`, `defaultFacilitatorUrl`) are passed to `initialize()`, not to `createAgentPayResourceServer`. |
| APAY-BLD-004 | The `AgentPayFacilitatorClient` shall support an optional `networkFilter` parameter that restricts `getSupported()` to only return kinds for networks in the filter set. |
| APAY-BLD-005 | When multiple facilitator clients are provided to `x402ResourceServer`, the Agent Pay facilitator client shall be positioned first in the array to ensure precedence during `initialize()`. |
| APAY-BLD-006 | The system shall provide a `registerAgentPayNetworks` helper that registers a `AgentPayServerScheme` for each specified network on an existing `x402ResourceServer` without modifying facilitator client configuration. |
| APAY-BLD-007 | The `registerNetwork` method on `FABResourceServer` and `FABClient` shall be idempotent — calling it with the same network twice shall have no additional effect. |
| APAY-BLD-008 | The `registerNetwork` method shall return `this` to support method chaining (e.g., `server.registerNetwork('aws:base').registerNetwork('eip155:8453')`). |
| APAY-BLD-009 | If `initialize()` is called on a `FABResourceServer` with no networks registered, the system shall throw a `ValidationError`. |

### 3.14 Agent Pay Discovery

| ID | Requirement |
|----|-------------|
| APAY-DSC-001 | The system shall define a `AgentPayDiscoveryMetadata` interface containing `issuer`, `jwks_uri`, `payment_endpoint`, `capture_endpoint` (required), and optional `supported_settlement_methods`, `signing_alg_values_supported`, `dpop_signing_alg_values_supported`, `token_endpoint_auth_methods_supported`, and `grant_types_supported`. |
| APAY-DSC-002 | When `registerNetwork` is called with a valid `fab:<provider>` network identifier and a valid URL, the system shall store the mapping in an internal registry. |
| APAY-DSC-003 | The system shall accept any `scheme:provider` format for network identifiers (e.g., `aws:base`, `fab:aws`, `eip155:8453`). The `fab:` prefix restriction has been removed. |
| APAY-DSC-004 | When `unregisterNetwork` is called, the system shall remove the network from the registry and return `true` if it existed, `false` otherwise. |
| APAY-DSC-005 | When `getRegisteredNetworks` is called, the system shall return a copy of the network-to-URL registry as a `Map<string, string>`. |
| APAY-DSC-006 | When `clearNetworkRegistry` is called, the system shall remove all registered networks. |
| APAY-DSC-007 | When `getAgentPayBaseUrl` is called with a registered network identifier, the system shall return the corresponding base URL. |
| APAY-DSC-008 | If `getAgentPayBaseUrl` is called with an unregistered network, then the system shall throw an `Error` instructing the caller to use `registerNetwork()`. |
| APAY-DSC-009 | When `discoverAgentPayEndpoints` is called, the system shall fetch the OIDC discovery document from `{baseUrl}/.well-known/openid-configuration` and return the parsed `AgentPayDiscoveryMetadata`. |
| APAY-DSC-010 | The system shall cache discovery metadata for 24 hours. Where `skipCache: true` is passed, the system shall bypass the cache. |
| APAY-DSC-011 | When `fetchAgentPayPublicKeys` is called, the system shall first discover the `jwks_uri` via `discoverAgentPayEndpoints`, then fetch and return the JWK Set from that URI. |
| APAY-DSC-012 | The system shall cache JWKS responses for 1 hour by default, or for the duration specified by the `Cache-Control: max-age` response header. |
| APAY-DSC-013 | When `clearDiscoveryCache` is called with no arguments, the system shall clear all cached discovery metadata. When called with a network identifier, it shall clear only that entry. |
| APAY-DSC-014 | When `clearJWKSCache` is called with no arguments, the system shall clear all cached JWK Sets. When called with a JWKS URI, it shall clear only that entry. |

### 3.15 Pre-configured Networks

| ID | Requirement |
|----|-------------|
| APAY-NET-001 | The system shall provide `AgentPayAWSClientScheme`, `AgentPayAWSServerScheme`, and `AgentPayAWSFacilitatorScheme` as pre-configured scheme implementations for the `aws:base` network. |
| APAY-NET-002 | The AWS pre-configured schemes shall use `https://pay.aws.amazon.com` as the default Agent Pay base URL. |
| APAY-NET-003 | `AgentPayAWSClientScheme` shall accept a `{ agentPayId: string }` configuration and delegate to the base `AgentPayClientScheme` with the AWS Agent Pay URL. |
| APAY-NET-004 | `AgentPayAWSServerScheme` shall accept a `{ signingKeys: SigningKeysConfig; serviceUrl: string }` configuration and delegate to the base `AgentPayServerScheme` with the AWS Agent Pay URL. |
| APAY-NET-005 | `AgentPayAWSFacilitatorScheme` shall accept an optional `agentPayId` (defaulting to `"aws-agent-pay"`) and delegate to the base `AgentPayFacilitatorScheme` with the AWS Agent Pay URL. |

---

### 3.15a Express Middleware

| ID | Requirement |
|----|-------------|
| APAY-MWR-001 | The system shall provide a `agentPayMiddleware` factory function that accepts a `FABMiddlewareConfig` and returns an Express middleware function `(req, res, next) => void`. |
| APAY-MWR-002 | The middleware shall match incoming requests against a route map keyed by `"METHOD /path"` patterns, supporting exact paths, wildcard (`*`) segments, and method-agnostic patterns (path only, matching any HTTP method). |
| APAY-MWR-003 | When a request matches a protected route and no payment header is present, the middleware shall return an HTTP 402 response with a `WWW-Authenticate` header containing the base64-encoded `PaymentRequired` payload and a `PAYMENT-REQUIRED` header containing the same base64-encoded payload (x402 V2 protocol compliance). |
| APAY-MWR-004 | When a request matches a protected route and a valid payment is present in the `Authorization: x402 <base64>`, `X-Payment`, or `payment-signature` header, the middleware shall verify the payment via `x402ResourceServer.verifyPayment`. |
| APAY-MWR-005 | When payment verification succeeds, the middleware shall attach a `PaymentInfo` object to `req.fabPayment` containing `payer`, `transactionId`, `network`, `amount`, and `asset`, then call `next()`. |
| APAY-MWR-006 | When payment verification fails, the middleware shall return an HTTP 402 response with a JSON body containing `error` and `details` fields. |
| APAY-MWR-007 | The middleware shall NOT call `settlePayment` regardless of capture mode — Agent Pay auto-captures during `CreateAgentPayment`. The `capture` field is a seller-side semantic: when `"auto"`, the middleware calls `next()` immediately after verification; when `"manual"`, the middleware still calls `next()` but the `onPaymentSettled` hook is not fired (the seller handles delivery logic in the route handler). |
| APAY-MWR-009 | When a request does not match any protected route, the middleware shall call `next()` without processing payment logic. |
| APAY-MWR-010 | The middleware shall lazily initialize the `x402ResourceServer` (via `createAgentPayResourceServer`) on the first request to a protected route, not at middleware creation time. |
| APAY-MWR-011 | If `agentPayMiddleware` is called with an empty `networks` array or an empty `routes` object, then it shall throw a `ValidationError`. |
| APAY-MWR-012 | Where an `onPaymentVerified` hook is configured, the middleware shall call it after successful verification and before calling `next()`. |
| APAY-MWR-013 | Where an `onPaymentSettled` hook is configured, the middleware shall call it after successful auto-capture settlement. |
| APAY-MWR-014 | Where an `onError` hook is configured, the middleware shall call it instead of returning a default 500 JSON error response when an unhandled exception occurs. |
| APAY-MWR-015 | When payment verification and settlement succeed, the middleware shall set a `PAYMENT-RESPONSE` header on the response containing a base64-encoded JSON object with `success`, `network`, and `transaction` fields before calling `next()` (x402 V2 protocol compliance). |

### 3.16 Agent Pay Provider Compatibility Contract

Any Agent Pay provider that integrates with the Agent Pay x402 extension shall expose the following HTTP endpoints:

| ID | Requirement |
|----|-------------|
| APAY-WCOMPAT-001 | A compatible Agent Pay provider shall expose `POST /CreateAgentPayment` accepting a JSON body with `quoteToken` (required), `clientToken` (optional, idempotency key), and `dpopJwk` (optional, EC public key for DPoP binding), and returning a JSON response with `paymentId`, `paymentToken` (signed JWT), and `createdAt`. |
| APAY-WCOMPAT-002 | Agent Pay auto-captures on creation. No separate `/capture` endpoint is required. |
| APAY-WCOMPAT-003 | A compatible Agent Pay provider shall expose `GET /.well-known/jwks.json` returning a JSON Web Key Set containing the public keys used to sign payment tokens. |
| APAY-WCOMPAT-004 | A compatible Agent Pay provider shall expose `GET /.well-known/x402-supported` returning a `SupportedResponse` with `x402Version` and a `kinds` array listing supported payment schemes and networks. |
| APAY-WCOMPAT-005 | Where OIDC discovery is supported, a compatible Agent Pay provider shall expose `GET /.well-known/openid-configuration` returning a `AgentPayDiscoveryMetadata` document with at minimum `issuer`, `jwks_uri`, and `payment_endpoint`. |
| APAY-WCOMPAT-006 | Payment tokens issued by a compatible Agent Pay provider shall be JWTs signed with ES384, containing `iss`, `sub`, `aud`, `iat`, `exp`, and `payment_context` (with `transaction_id` and `quote_token`) claims. |
| APAY-WCOMPAT-007 | A compatible Agent Pay provider shall verify that the `quoteToken` in a transaction request is a valid, unexpired JWT before authorizing the transaction. |

### 3.17 Exported Stubs

| ID | Requirement |
|----|-------------|
| APAY-STUB-001 | The system shall export a deprecated `fetchServicePublicKey(serviceUrl)` function that throws an `Error` directing callers to use `fetchServiceJWKS()` instead. The system shall export `fetchServiceJWKS(serviceUrl)` which returns a `jose.createRemoteJWKSet` function compatible with `jose.jwtVerify`, with results cached for 1 hour. The system shall export `clearServiceJWKSCache(serviceUrl?)` to invalidate cached entries. |

### 3.18 Agent Pay API Types

| ID | Requirement |
|----|-------------|
| APAY-APAY-001 | The system shall define a `CreateAgentPaymentRequest` interface with `quoteToken` (required string), `clientToken` (optional string, 1-128 chars), and `dpopJwk` (optional `DpopJwk` object). |
| APAY-APAY-002 | The system shall define a `CreateAgentPaymentResponse` interface with `paymentId` (string, format `awsmp-{UUIDv7}`), `paymentToken` (string, ES384-signed JWT), and `createdAt` (ISO 8601 string). |
| APAY-APAY-003 | The system shall define a `DpopJwk` interface with `kty: 'EC'`, `crv: 'P-256' | 'P-384' | 'P-521'`, `x: string`, `y: string`. |
| APAY-APAY-004 | The system shall define an `IdempotencyConflictError` class extending `AgentPayError` with code `'IDEMPOTENCY_CONFLICT'` and a `clientToken` property. |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement |
|----|-------------|
| APAY-PRF-001 | The system shall complete schema validation in less than 1 millisecond per requirement object. |
| APAY-PRF-002 | The system shall complete quote token generation in less than 10 milliseconds. |
| APAY-PRF-003 | The system shall complete JWT signature verification in less than 20 milliseconds. |
| APAY-PRF-004 | The system shall produce a minified and gzipped bundle smaller than 50 KB. |

### 4.2 Security

| ID | Requirement |
|----|-------------|
| APAY-SEC-001 | The system shall validate all external inputs before processing. |
| APAY-SEC-002 | The system shall use an algorithm allowlist restricting JWT signing to RS256, ES256, ES384, and ES512. |
| APAY-SEC-003 | The system shall check token expiry before performing any further processing. |
| APAY-SEC-004 | The system shall use `crypto.randomUUID()` for all nonce and JTI generation. |
| APAY-SEC-005 | The system shall not log private keys, payment tokens, or other sensitive credential material. |
| APAY-SEC-006 | The system shall use the Web Crypto API or Node.js `crypto` module for all cryptographic operations (no custom cryptographic implementations). |

### 4.3 Compatibility

| ID | Requirement |
|----|-------------|
| APAY-CMP-001 | The system shall be compatible with Node.js 18.0.0 and higher. |
| APAY-CMP-002 | The system shall declare `@x402/core@^2.0.0` as a peer dependency. |
| APAY-CMP-003 | The system shall produce both ESM (`dist/index.js`) and CommonJS (`dist/index.cjs`) build outputs. |
| APAY-CMP-004 | The system shall produce TypeScript declaration files (`dist/index.d.ts`). |
| APAY-CMP-005 | The system shall support tree-shaking by using named exports and ESM module format. |

### 4.4 Testability

| ID | Requirement |
|----|-------------|
| APAY-TST-001 | The system shall maintain a minimum of 90% line coverage across all source modules. |
| APAY-TST-002 | The system shall maintain a minimum of 90% function coverage across all source modules. |
| APAY-TST-003 | The system shall maintain a minimum of 90% branch coverage across all source modules. |
| APAY-TST-004 | The system shall use Vitest as the test framework. |
| APAY-TST-005 | The system shall provide mock helpers (`mock-service-signer.ts`, `mock-agent-pay-client.ts`) for testing integrations. |

---

## 5. Correctness Properties

These properties define invariants that shall hold across all valid executions. They bridge human-readable requirements to machine-verifiable guarantees and are suitable for property-based testing.

| ID | Property | Validates |
|----|----------|-----------|
| APAY-PROP-001 | For any valid Agent Pay payment requirements object, parsing with the schema and then serializing shall produce an equivalent object. | APAY-TYP-004, APAY-TYP-005 |
| APAY-PROP-002 | For any quote token generated with a private key, verification with the corresponding public key shall succeed and return the original payload. | APAY-SRV-001, APAY-UTL-003 |
| APAY-PROP-003 | For any payment token signed by an Agent Pay provider, verification with the Agent Pay's public key shall succeed and extract the embedded quote token. | APAY-FAC-001, APAY-UTL-004 |
| APAY-PROP-004 | For any network and ID components where the network starts with `"fab:"`, `formatTransactionId` followed by `parseTransactionId` shall return the original components. | APAY-UTL-010, APAY-UTL-012 |
| APAY-PROP-005 | For any valid amount string and asset string, `parseMoneyToDecimal` shall extract the numeric value and currency code correctly. | APAY-UTL-007, APAY-UTL-008 |
| APAY-PROP-006 | For any payment requirements with scheme `"fab"`, scheme detection shall return true; for any other scheme it shall return false. | APAY-REG-001 |
| APAY-PROP-007 | For any Agent Pay payment requirements, extracting the extra field shall return a non-null `AgentPayPaymentExtra` object. | APAY-TYP-004 |
| APAY-PROP-008 | For any invalid Agent Pay payment structure, validation shall fail with a descriptive error message. | APAY-ERR-002 |
| APAY-PROP-009 | For any expired token, verification shall fail with an `ExpiryError` containing the expiry timestamp. | APAY-ERR-004 |
| APAY-PROP-010 | For any valid payment payload, the quote token in `accepted.extra.quoteToken` shall equal the quote token in `payload.paymentToken.payment_context.quote_token`. | APAY-FAC-003 |
| APAY-PROP-011 | For any DPoP key pair and proof options, creating a proof then verifying it with the same options shall succeed. | APAY-DPOP-003, APAY-DPOP-006 |
| APAY-PROP-012 | For any DPoP nonce store, verifying the same proof twice shall fail on the second attempt with a replay error. | APAY-DPOP-013 |
| APAY-PROP-013 | For any DPoP proof with `iat` outside the `maxAge` window, verification shall fail with a freshness error. | APAY-DPOP-009 |
| APAY-PROP-014 | For any DPoP proof, verification with a different HTTP method or URL shall fail with a binding error. | APAY-DPOP-010, APAY-DPOP-011 |
| APAY-PROP-015 | For any DPoP proof, `extractDPoPThumbprint` shall return the same value as `computeJWKThumbprint` called with the proof's embedded JWK. | APAY-DPOP-005, APAY-DPOP-015 |

---

## 6. Architecture Decisions and Rationale

This section captures the key design decisions, trade-offs, and reasoning behind the current architecture. It serves as institutional memory so that future changes are informed by past context.

### 6.1 Role Mapping: Why the Agent Pay is Both Client and Facilitator

In crypto-based x402 schemes (EVM, SVM), the three roles map naturally to distinct parties: the user's Agent Pay (client), the API (server), and a blockchain or payment processor (facilitator). In Agent Pay, fiat payments don't have a decentralized settlement layer, so the Agent Pay provider fills both the client role (authorizing payments) and the facilitator role (verifying and settling them).

| x402 Role | Crypto Schemes | Agent Pay |
|-----------|---------------|-----|
| Client | User's crypto Agent Pay | Agent Pay provider (authorizes transactions) |
| Server | API/resource service | API/resource service (generates quote tokens) |
| Facilitator | Blockchain / payment processor | Agent Pay provider (verifies + settles) |

This means the `AgentPayFacilitatorClient` talks to the same Agent Pay provider that the `AgentPayClientScheme` authorizes payments through. No separate facilitator service is needed.

### 6.2 JWT Over Opaque Tokens

We chose JWTs for both quote tokens and payment tokens because:

- Signatures are verifiable without calling back to the issuer (offline verification)
- Standard tooling (`jose` library) handles signing, verification, and key management
- Claims are self-describing — the token carries its own metadata (amount, expiry, issuer)
- JWKS endpoints (`/.well-known/jwks.json`) provide a standard key distribution mechanism

The trade-off is token size (JWTs are larger than opaque references), but for machine-to-machine API payments this is negligible.

### 6.3 RS256 as Default Signing Algorithm

RS256 (RSA-SHA256) was chosen as the default for both `toServiceAgentPaySigner` and `toAgentPaySigner` because:

- Broad compatibility — RSA keys are universally supported across cloud KMS services
- Existing infrastructure — most services already have RSA key pairs for TLS/mTLS

ES256 (ECDSA P-256) is supported as an alternative and is recommended for DPoP key pairs due to faster key generation (~10-50ms vs ~100-500ms for RS256) and smaller signatures.

### 6.4 Client Delegates to Agent Pay Provider, Not Local Signing

The `AgentPayClientScheme.createPaymentPayload()` does not sign payment tokens locally. Instead, it calls the Agent Pay provider's `POST /transactions` endpoint, which returns an Agent Pay provider-signed payment token. This was a deliberate choice:

- The Agent Pay provider controls the private key — clients never hold signing keys
- Agent Pay can enforce spending limits, fraud checks, and authorization policies
- Transaction state (holds, captures) lives in the Agent Pay's backend
- This matches how real payment systems work (Stripe, PayPal, etc.)

The design.md originally showed a local-signing approach using `AgentPaySigner`. That was an early design iteration that was superseded.

### 6.5 Settlement (Auto-Capture by Agent Pay)

Agent Pay auto-captures during `CreateAgentPayment`. There is no separate `/capture` endpoint in the Agent Pay API. The `settle()` function in both the in-process facilitator and the `AgentPayFacilitatorClient` returns `{ success: true }` immediately without making any HTTP call.

The `capture` field in the quote token (`"auto"` or `"manual"`) is a **seller-side semantic** — it does not affect whether Agent Pay captures the payment (it always does). It controls the seller's delivery behavior:
- `"auto"`: The middleware delivers the resource immediately after payment verification.
- `"manual"`: The seller's route handler decides when/whether to deliver (e.g., after additional validation).

### 6.6 Service JWKS Fetching

The facilitator needs the service's public key to verify quote token signatures. The `fetchServiceJWKS(serviceUrl)` function fetches JWKS from `{serviceUrl}/.well-known/jwks.json` using `jose.createRemoteJWKSet` and caches results for 1 hour. The original `fetchServicePublicKey` is deprecated in favor of this function.

The `AgentPayFacilitatorClient` independently fetches service JWKS and verifies quote token signatures — that path is fully operational. The in-process facilitator (`src/agent-pay/facilitator/verify.ts`) now mandatorily verifies quote token signatures by fetching the service's JWKS and calling `jose.jwtVerify`. If the JWKS endpoint is unreachable or the signature is invalid, verification fails with `invalidReason: 'invalid_quote'`. An optional `serviceJWKSUrl` override is supported for proxied services.

### 6.7 Dependency Choices

| Dependency | Why | Alternative Considered |
|-----------|-----|----------------------|
| `jose` | Industry-standard JWT/JWK library, supports all needed algorithms, maintained by Panva | `jsonwebtoken` — older, less type-safe, no JWK support |
| `zod` | Runtime schema validation with TypeScript inference, composable | `joi` — heavier, no TS inference; `io-ts` — steeper learning curve |
| `@x402/core` (peer) | Base protocol types and interfaces; peer dep ensures single instance | Bundling it — would cause version conflicts |

### 6.8 Caching Strategy

| Cache | TTL | Rationale |
|-------|-----|-----------|
| JWKS (DefaultAgentPayClient) | 1 hour | Keys rotate infrequently; 1h balances freshness vs. network calls |
| JWKS (AgentPayFacilitatorClient) | 1 hour | Same reasoning; both clients cache independently |
| Discovery metadata | 24 hours | OIDC discovery docs change very rarely |
| JWKS via `fetchAgentPayPublicKeys` | 1 hour default, respects `Cache-Control: max-age` | Follows HTTP caching semantics |

### 6.9 Error Handling Strategy

| Error Category | Behavior | Rationale |
|---------------|----------|-----------|
| Validation errors | Thrown synchronously during parsing | Fail fast — bad input should never reach crypto operations |
| Signature errors | Thrown asynchronously during verification | JWT verification is inherently async |
| Verification failures in facilitator | Returned as `{ valid: false }`, not thrown | The facilitator is a service boundary — callers need structured responses, not exceptions |
| Settlement failures in facilitator | Returned as `{ settled: false }`, not thrown | Same reasoning as verification |
| Network errors | Wrapped in `ValidationError` with original message | Keeps error hierarchy simple; callers catch `AgentPayError` subtypes |
| Auth errors | Separate `AuthenticationError` hierarchy with `retryable` flag | Auth failures are distinct from payment failures; `retryable` lets callers implement retry logic |

### 6.10 Multi-Facilitator Routing and Network-Aware Registration

Agent Pay introduces builder functions (`buildAgentPayResourceServer`, `buildAgentPayClient`) that simplify registration by accepting a list of networks and wiring up all the necessary schemes and facilitator clients automatically.

The key design decisions:

1. **Agent Pay-first precedence**: The `x402ResourceServer` accepts `FacilitatorClient[]` and during `initialize()` maps `(version, network, scheme)` tuples to facilitator clients on a first-come-first-served basis. By placing the Agent Pay facilitator first in the array, it claims its registered networks before the default facilitator can.

2. **Network filter on AgentPayFacilitatorClient**: Without filtering, the Agent Pay's `/.well-known/x402-supported` response might declare support for networks the integrator didn't intend to handle via Agent Pay. This would shadow the default facilitator for those networks. The optional `networkFilter` parameter restricts `getSupported()` to only return kinds for explicitly chosen networks.

3. **Default facilitator fallback**: Unless `disableDefaultFallback` is set, `buildAgentPayResourceServer` includes an `HTTPFacilitatorClient` (pointing at `https://x402.org/facilitator`) as the second facilitator. This means networks like `solana:mainnet` or `eip155:1` that Agent Pay doesn't claim are automatically handled by the official x402 facilitator.

4. **Backward compatibility**: The builders are additive. All existing manual registration patterns (`server.register(network, scheme)`) continue to work unchanged.

### 6.11 DPoP: Why ES256 is Recommended

DPoP key pairs are ephemeral — generated per session, not stored long-term. Performance matters more than compatibility here:

| Algorithm | Key Generation | Proof Creation | Proof Verification |
|-----------|---------------|----------------|-------------------|
| ES256 | ~10-50ms | ~5-20ms | ~5-20ms |
| RS256 | ~100-500ms | ~5-20ms | ~5-20ms |

ES256 is 5-10x faster for key generation with no downside for ephemeral use. RS256 is only preferred when interoperating with systems that don't support EC keys.

---

## 7. Data Model Examples

Concrete examples of the JWT structures defined in §3.2.

### Quote Token (Service → Client)

```json
{
  "iss": "https://api.weather.com",
  "aud": "aws:base",
  "iat": 1735689600,
  "exp": 1735689900,
  "jti": "quote_a1b2c3d4",
  "price": {
    "amount": "0.15",
    "currency": "USD"
  },
  "payTo": "pay-weather-co-aws",
  "capture": "manual",
  "reference": "WEATHER_DATA_TIER1",
  "settlement": {
    "method": "CLRG",
    "cycle": "MNTH"
  }
}
```

### Payment Token (Agent Pay → Service)

```json
{
  "iss": "aws-marketplace",
  "sub": "buyer-account-id",
  "iat": 1735689600,
  "exp": 1735693200,
  "payment_id": "awsmp-01970f3e-4b2a-7dc0-8e1f-6a3b9c5d7e2f",
  "payment_context": {
    "transaction_id": "awsmp-01970f3e-4b2a-7dc0-8e1f-6a3b9c5d7e2f",
    "quote_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
  },
  "cnf": {
    "jkt": "sha256-thumbprint-of-dpop-key"
  }
}
```

### Payment ID Format

```
Payment ID Format:
awsmp-01970f3e-4b2a-7dc0-8e1f-6a3b9c5d7e2f
└─┬─┘ └──────────────┬──────────────────────┘
  │                   └── UUIDv7 (time-ordered)
  └── prefix (AWS Marketplace Payment)
```


