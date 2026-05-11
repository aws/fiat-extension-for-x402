# FAB x402 Extension — System Requirements Specification

**Document ID:** FAB-SRS-001  
**Version:** 0.1.0  
**Date:** 2026-03-05  
**Status:** Current State Capture  
**Methodology:** EARS (Easy Approach to Requirements Syntax) per INCOSE best practices  
**System:** @x402/fab — Federated Application Billing Extension for x402 Protocol

---

## 1. Introduction

### 1.1 Purpose

This document captures the current-state requirements of the FAB x402 TypeScript extension using EARS syntax, consistent with INCOSE systems engineering practices. It serves as a formal, testable specification derived from the implemented codebase, design documentation, and task tracking artifacts.

### 1.2 Scope

The system under specification is the `@x402/fab` npm package — a TypeScript library that extends the x402 HTTP payment protocol to support fiat currency payments through trusted Agentic Pay providers. The system operates within a three-party architecture: API consumers (clients), API providers (servers/resource services), and Agentic Pay providers (facilitators).

### 1.3 Definitions and Abbreviations

| Term | Definition |
|------|-----------|
| FAB | Federated Application Billing — fiat payment scheme for x402 |
| x402 | HTTP 402 Payment Required protocol for machine-to-machine payments |
| JWT | JSON Web Token (RFC 7519) |
| JWK | JSON Web Key (RFC 7517) |
| DPoP | Demonstrating Proof-of-Possession (RFC 9449) |
| Quote Token | Service-signed JWT describing price, terms, and payment recipient |
| Payment Token | Agentic Pay-signed JWT authorizing a specific payment transaction |
| Facilitator | Entity that verifies and settles payments (Agentic Pay provider in FAB) |
| CAIP | Chain Agnostic Improvement Proposal (network identifier format) |
| SigV4 | AWS Signature Version 4 authentication protocol |

### 1.4 Stakeholders

| Stakeholder | Role |
|-------------|------|
| API Provider (Service) | Protects resources behind payment requirements, generates quote tokens, verifies payments |
| API Consumer (Client) | Requests resources, obtains payment tokens from Agentic Pay, submits payments |
| Agentic Pay Provider | Authorizes transactions, signs payment tokens, settles funds |

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

The FAB x402 extension operates as a library consumed by three categories of integrators within the x402 payment ecosystem:

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
│            Agentic Pay Provider                    │
│         (Facilitator in x402)                │
└──────────────────────────────────────────────┘
```

### 2.2 Payment Flow Summary

1. Client requests a protected resource from the service.
2. Service returns HTTP 402 with payment requirements containing a signed quote token.
3. Client sends the quote token to its Agentic Pay provider for authorization.
4. Agentic Pay provider returns a signed payment token with a transaction ID.
5. Client retries the resource request with the payment token.
6. Service verifies the payment token via the Agentic Pay provider (facilitator).
7. Service captures/settles the payment.
8. Service delivers the resource.

### 2.3 Architectural Constraints

- CON-1: The system shall be implemented as a TypeScript npm package.
- CON-2: The system shall depend on `@x402/core` as a peer dependency.
- CON-3: The system shall target Node.js 18.0.0 or higher.
- CON-4: The system shall produce ESM, CommonJS, and TypeScript declaration outputs.
- CON-5: The system shall use `jose` for all JWT/JWK operations and `zod` for schema validation.

### 2.4 Sentinel Value Convention for x402 Core Fields

The `@x402/core` `PaymentRequirements` type requires `payTo` (string) and `maxTimeoutSeconds` (number) as mandatory fields. In FAB, these fields are semantically redundant because the signed quote token is the authoritative source for payment recipient and validity:

- The quote token's `payTo` field (signed by the service) is the trusted recipient. The outer `PaymentRequirements.payTo` is unsigned and could be tampered with.
- The quote token's `exp - iat` window defines validity. The outer `maxTimeoutSeconds` is a leftover from the EVM/SVM `exact` scheme where it controls on-chain `validBefore`.

Rather than modifying the `@x402/core` type contract (which would be a breaking change across all x402 mechanisms), FAB uses sentinel values:

- `payTo` is set to `"urn:x402:fab:see-quote"` — a URN that is clearly not a real address and signals that the quote token should be consulted.
- `maxTimeoutSeconds` is set to the quote token's validity window (`exp - iat`), keeping the field numerically meaningful for any x402 middleware that inspects it.

Both sentinels are applied in `enhancePaymentRequirements` (the server scheme's last touch before the 402 response). The FAB client scheme and facilitator scheme already use the quote token rather than these outer fields, so this change formalizes existing behavior.

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
| FAB-REG-001 | The FAB extension shall identify itself with the scheme name `"fab"`. |
| FAB-REG-002 | The FAB extension shall use the CAIP family identifier `"fab:*"` for facilitator network matching. |
| FAB-REG-003 | The FAB extension shall support network identifiers in the format `fab:<provider>` (e.g., `fab:aws`). |
| FAB-REG-004 | The FAB extension shall implement the `SchemeNetworkClient`, `SchemeNetworkServer`, and `SchemeNetworkFacilitator` interfaces from `@x402/core`. |

### 3.2 Type System

| ID | Requirement |
|----|-------------|
| FAB-TYP-001 | The system shall define a `CaptureMode` type constrained to the values `"manual"` and `"auto"`. |
| FAB-TYP-002 | The system shall define a `SettlementMethod` type constrained to the values `"INST"` (instant), `"CLRG"` (clearing/batch), and `"CRDT"` (credit/invoice). |
| FAB-TYP-003 | The system shall define a `SettlementCycle` type constrained to the values `"MNTH"` (monthly), `"WEEK"` (weekly), and `"QRTR"` (quarterly). |
| FAB-TYP-004 | The system shall define a `FABPaymentExtra` interface containing a required `quoteToken` string field and optional `capture`, `reference`, `settlement`, `support`, and `terms` fields. |
| FAB-TYP-005 | The system shall define a `QuoteTokenPayload` interface containing the JWT claims `iss`, `aud`, `iat`, `exp`, `jti`, `price`, `payTo`, `capture`, `reference`, and optional `settlement`, `support`, `terms`. |
| FAB-TYP-006 | The system shall define a `PaymentTokenPayload` interface containing the JWT claims `iss`, `sub`, `aud`, `iat`, `exp`, `payment_context` (with `transaction_id` and `quote_token`), and optional `cnf.jkt` for DPoP binding. |
| FAB-TYP-007 | The system shall define a `FABPayloadV2` interface containing `paymentToken` and `transactionId` string fields for x402 payload transport. |

### 3.3 Error Handling

| ID | Requirement |
|----|-------------|
| FAB-ERR-001 | The system shall define a `FABError` base class extending `Error` with `code` (string) and `details` (optional record) properties. |
| FAB-ERR-002 | If schema or format validation fails, then the system shall throw a `ValidationError` with code `"VALIDATION_ERROR"` and a descriptive message indicating the violated constraint. |
| FAB-ERR-003 | If JWT signature verification fails, then the system shall throw a `SignatureError` with code `"SIGNATURE_ERROR"` and a `tokenType` property indicating `"quote"` or `"payment"`. |
| FAB-ERR-004 | If a token's `exp` claim is earlier than the current time, then the system shall throw an `ExpiryError` with code `"EXPIRY_ERROR"` containing the `expiry` and `currentTime` timestamps. |
| FAB-ERR-005 | If expected and actual data values do not match during verification, then the system shall throw a `MismatchError` with code `"MISMATCH_ERROR"` containing `expected` and `actual` values. |
| FAB-ERR-006 | If DPoP proof verification fails, then the system shall throw a `DPoPError` with code `"DPOP_ERROR"` and contextual details describing the failure reason. |

---

### 3.4 Server Scheme (Quote Token Generation)

| ID | Requirement |
|----|-------------|
| FAB-SRV-001 | When `enhancePaymentRequirements` is called, the server scheme shall generate a quote token JWT signed with the service's private key using the RS256 or ES256 algorithm. |
| FAB-SRV-002 | The server scheme shall set the quote token `iss` claim to the service URL. |
| FAB-SRV-003 | The server scheme shall set the quote token `aud` claim to the target network identifier. |
| FAB-SRV-004 | The server scheme shall set the quote token `iat` claim to the current Unix timestamp in seconds. |
| FAB-SRV-005 | The server scheme shall set the quote token `exp` claim to `iat` plus 300 seconds (5 minutes) by default. |
| FAB-SRV-006 | The server scheme shall set the quote token `jti` claim to a unique UUID generated via `crypto.randomUUID()`. |
| FAB-SRV-007 | The server scheme shall populate the quote token `price` field with the amount and currency extracted from the payment requirements. |
| FAB-SRV-008 | The server scheme shall set the quote token `payTo` field to the service's Agentic Pay identifier from the payment requirements. |
| FAB-SRV-009 | The server scheme shall set the quote token `capture` field to the value from `extra.capture`, defaulting to `"manual"`. |
| FAB-SRV-010 | The server scheme shall set the quote token `reference` field to the value from `extra.reference`, defaulting to `"RESOURCE"`. |
| FAB-SRV-011 | Where settlement, support, or terms are provided in the payment requirements extra data, the server scheme shall include them in the quote token payload. |
| FAB-SRV-012 | When `enhancePaymentRequirements` completes, the server scheme shall return the original payment requirements with the signed quote token added to the `extra.quoteToken` field. |
| FAB-SRV-013 | When `parsePrice` is called with a money string, the server scheme shall extract the numeric amount and currency code and return an `AssetAmount` with the asset formatted as `iso4217:<currency>`. |
| FAB-SRV-014 | The server scheme constructor shall accept either a `ServiceFABSigner` instance or a `SigningKeysConfig` with `serviceUrl` (from which a signer is created via `toServiceFABSigner`). |
| FAB-SRV-015 | If the server scheme constructor receives neither a `signer` nor `signingKeys` + `serviceUrl`, then it shall throw a `ValidationError`. |
| FAB-SRV-016 | When `enhancePaymentRequirements` completes, the server scheme shall set the returned `PaymentRequirements.payTo` field to the sentinel value `FAB_SENTINEL_PAY_TO` (`"urn:x402:fab:see-quote"`). |
| FAB-SRV-017 | When `enhancePaymentRequirements` completes, the server scheme shall set the returned `PaymentRequirements.maxTimeoutSeconds` field to the quote token's validity window (`exp` minus `iat`). |

### 3.5 Client Scheme (Payment Token Creation)

| ID | Requirement |
|----|-------------|
| FAB-CLI-001 | When `createPaymentPayload` is called, the client scheme shall extract the `quoteToken` from the payment requirements `extra` field. |
| FAB-CLI-002 | If the payment requirements `extra` field does not contain a `quoteToken`, then the client scheme shall throw a `ValidationError`. |
| FAB-CLI-003 | The client scheme shall decode the quote token to extract the service URL (issuer) and price information. |
| FAB-CLI-004 | If the decoded quote token does not contain a `price` field, then the client scheme shall throw a `ValidationError` with the message `"Missing price in quote token"`. |
| FAB-CLI-005 | The client scheme shall call the Agentic Pay provider's `authorize()` method with the network, amount, currency, service URL (as `payTo`), quote token, and Agentic Pay ID. |
| FAB-CLI-006 | When the Agentic Pay provider returns a `transactionId` and `paymentToken`, the client scheme shall wrap them in a `FABPayloadV2` and return a `PaymentPayloadResult`. |
| FAB-CLI-007 | The client scheme constructor shall accept either a `AgenticPayClientForClient` instance or a `AgenticPayConfig` (from which a `DefaultAgenticPayClient` is created). |
| FAB-CLI-008 | If the client scheme constructor receives neither a `agenticPayClient` nor a `Agentic Pay` configuration, then it shall throw a `ValidationError`. |

### 3.6 Facilitator Scheme (Verification and Settlement)

| ID | Requirement |
|----|-------------|
| FAB-FAC-001 | When `verify` is called, the facilitator scheme shall verify the payment token JWT signature using the Agentic Pay's public key via the `AgenticPayClientForFacilitator`. |
| FAB-FAC-002 | When `verify` is called, the facilitator scheme shall extract the quote token from the payment token's `payment_context.quote_token` field. |
| FAB-FAC-003 | When `verify` is called, the facilitator scheme shall verify that the quote token in the payment matches the quote token in the payment requirements `extra.quoteToken`. |
| FAB-FAC-003a | When `verify` is called, the facilitator scheme shall verify the quote token JWT signature by fetching the service's JWKS from `{quote.iss}/.well-known/jwks.json` via `fetchServiceJWKS` and calling `jose.jwtVerify`. If signature verification fails, the facilitator shall return `{ isValid: false, invalidReason: "invalid_quote" }`. |
| FAB-FAC-003b | When `verify` is called, the facilitator scheme shall check the quote token's `exp` claim against the current time. If the quote token has expired, the facilitator shall return `{ isValid: false, invalidReason: "quote_expired" }`. |
| FAB-FAC-004 | When `verify` is called, the facilitator scheme shall verify that the amount and currency in the quote token match the payment requirements. |
| FAB-FAC-005 | When verification succeeds, the facilitator scheme shall return `{ valid: true, transactionId }`. |
| FAB-FAC-006 | If any verification step fails, then the facilitator scheme shall return `{ valid: false, error: <message> }` without throwing an exception. |
| FAB-FAC-007 | When `settle` is called, the facilitator scheme shall call the Agentic Pay provider's `capturePayment()` method and return a `SettleResponse`. |
| FAB-FAC-008 | If settlement fails, then the facilitator scheme shall return `{ settled: false, error: <message> }` without throwing an exception. |
| FAB-FAC-009 | When `getSigners` is called, the facilitator scheme shall return an array containing the configured `agenticPayId`. |
| FAB-FAC-010 | When `getExtra` is called, the facilitator scheme shall return an object containing the `agenticPayId`. |
| FAB-FAC-011 | The facilitator scheme constructor shall accept either a `AgenticPayClientForFacilitator` instance or a `AgenticPayConfig` (from which a `DefaultAgenticPayClient` is created). |
| FAB-FAC-012 | If the facilitator scheme constructor receives neither a `agenticPayClient` nor a `Agentic Pay` configuration, then it shall throw a `ValidationError`. |

---

### 3.7 Signer Interfaces

| ID | Requirement |
|----|-------------|
| FAB-SGN-001 | The system shall define a `ServiceFABSigner` interface with methods `signQuote(payload): Promise<string>`, `getPublicKey(): JWK`, and `getServiceUrl(): string`. |
| FAB-SGN-002 | The system shall define a `AgenticPayFABSigner` interface with methods `signPayment(payload): Promise<string>`, `getPublicKey(): JWK`, and `getAddresses(): string[]`. |
| FAB-SGN-003 | When `toServiceFABSigner` is called with a private key, public JWK, and service URL, the system shall return a `ServiceFABSigner` that signs JWTs with the `RS256` algorithm and `typ: "JWT"` header. |
| FAB-SGN-004 | When `toAgenticPayFABSigner` is called with a private key, public JWK, and Agentic Pay ID, the system shall return a `AgenticPayFABSigner` that signs JWTs with the `RS256` algorithm and `typ: "JWT"` header. |

### 3.8 Utility Functions

| ID | Requirement |
|----|-------------|
| FAB-UTL-001 | When `decodeQuoteToken` is called with a valid JWT string, the system shall return the decoded `QuoteTokenPayload` without verifying the signature. |
| FAB-UTL-002 | If `decodeQuoteToken` is called with a malformed JWT string, then the system shall throw a `ValidationError` with the message `"Invalid quote token format"`. |
| FAB-UTL-003 | When `verifyQuoteToken` is called with a token and public key, the system shall verify the JWT signature and check the `exp` claim against the current time. |
| FAB-UTL-004 | When `verifyPaymentToken` is called with a token and public key, the system shall verify the JWT signature and check the `exp` claim against the current time. |
| FAB-UTL-005 | When `extractQuoteFromPayment` is called with a `PaymentTokenPayload`, the system shall return the `payment_context.quote_token` value. |
| FAB-UTL-006 | When `generateTransactionId` is called with a network and Agentic Pay ID, the system shall return a string in the format `{network}:{16-char-hex-id}`. |
| FAB-UTL-007 | When `parseMoneyToDecimal` is called with a numeric value, the system shall return `{ amount: <number>, currency: "USD" }`. |
| FAB-UTL-008 | When `parseMoneyToDecimal` is called with a string matching `$?(\d+\.?\d*)\s*([A-Z]{3})?`, the system shall extract the amount and currency (defaulting to `"USD"`). |
| FAB-UTL-009 | If `parseMoneyToDecimal` is called with a string that does not match the expected format, then the system shall throw a `ValidationError`. |
| FAB-UTL-010 | When `parseTransactionId` is called with a valid transaction ID, the system shall return `{ network, id }` components. |
| FAB-UTL-011 | If `parseTransactionId` is called with a string that does not contain a colon delimiter or whose network does not start with `"fab:"`, then the system shall throw a `ValidationError`. |
| FAB-UTL-012 | When `formatTransactionId` is called with a network starting with `"fab:"` and an ID, the system shall return `{network}:{id}`. |
| FAB-UTL-013 | If `formatTransactionId` is called with a network that does not start with `"fab:"`, then the system shall throw a `ValidationError`. |
| FAB-UTL-014 | When `isValidTransactionId` is called, the system shall return `true` if `parseTransactionId` succeeds and `false` otherwise, without throwing exceptions. |
| FAB-UTL-015 | When `extractNetworkFromTransactionId` is called, the system shall return the network component of the transaction ID. |

### 3.9 Constants

| ID | Requirement |
|----|-------------|
| FAB-CON-001 | The system shall define `FAB_SCHEME` as the string `"fab"`. |
| FAB-CON-002 | The system shall define `DEFAULT_QUOTE_VALIDITY_SECONDS` as `300` (5 minutes). |
| FAB-CON-003 | The system shall define `DEFAULT_PAYMENT_VALIDITY_SECONDS` as `3600` (1 hour). |
| FAB-CON-004 | The system shall define `SETTLEMENT_METHODS` containing `INST`, `CLRG`, and `CRDT`. |
| FAB-CON-005 | The system shall define `SETTLEMENT_CYCLES` containing `MNTH`, `WEEK`, and `QRTR`. |
| FAB-CON-006 | The system shall define `FAB_CAIP_FAMILY` as the string `"fab:*"`. |
| FAB-CON-007 | The system shall define a sentinel constant `FAB_SENTINEL_PAY_TO` with value `"urn:x402:fab:see-quote"` to indicate that the `payTo` field in `PaymentRequirements` is not authoritative and the quote token shall be consulted instead. |

---

### 3.10 Authentication

| ID | Requirement |
|----|-------------|
| FAB-AUTH-001 | The system shall support API Key authentication by adding a configurable header (default `"X-API-Key"`) with the key value to outgoing Agentic Pay requests. |
| FAB-AUTH-002 | Where an optional `prefix` is configured for API Key authentication, the system shall prepend the prefix to the API key value in the header. |
| FAB-AUTH-003 | The system shall support OAuth2 Bearer token authentication by adding an `Authorization: Bearer <token>` header to outgoing Agentic Pay requests. |
| FAB-AUTH-004 | Where a `refreshToken` and `tokenEndpoint` are configured for OAuth2 authentication, the system shall refresh the access token when it expires and invoke the `onTokenRefresh` callback with the new token. |
| FAB-AUTH-005 | The system shall support AWS SigV4 authentication by signing outgoing Agentic Pay requests with the provided credentials and region. |
| FAB-AUTH-006 | The system shall support custom authentication by delegating to a user-provided `authenticate(request): Promise<AuthenticatedRequest>` function. |
| FAB-AUTH-007 | When `createAuthenticator` is called with an `AuthConfig`, the system shall return the appropriate authenticator instance based on the `type` discriminant (`"apiKey"`, `"awsSigV4"`, `"oauth2"`, or `"custom"`). |
| FAB-AUTH-008 | The system shall define authentication error types: `AuthenticationError` (base, with `authMethod`, `originalError`, and `retryable` properties), `InvalidCredentialsError`, `ExpiredCredentialsError` (retryable), `MissingCredentialsError`, and `AuthenticationTimeoutError` (retryable). |

### 3.11 DPoP (Demonstrating Proof-of-Possession)

| ID | Requirement |
|----|-------------|
| FAB-DPOP-001 | When `generateDPoPKeyPair` is called with algorithm `"ES256"`, the system shall generate an EC P-256 key pair and return the public key in JWK format with `alg: "ES256"` and `use: "sig"`. |
| FAB-DPOP-002 | When `generateDPoPKeyPair` is called with algorithm `"RS256"`, the system shall generate an RSA 2048-bit key pair and return the public key in JWK format with `alg: "RS256"` and `use: "sig"`. |
| FAB-DPOP-003 | When `createDPoPProof` is called, the system shall create a JWT with `typ: "dpop+jwt"` in the protected header, the public key embedded as `jwk`, and a payload containing `jti`, `htm` (HTTP method, uppercased), `htu` (HTTP URL), and `iat` (current timestamp). |
| FAB-DPOP-004 | Where an `accessToken` is provided in the DPoP proof options, the system shall compute a SHA-256 hash of the access token, base64url-encode it, and include it as the `ath` claim. |
| FAB-DPOP-005 | When `computeJWKThumbprint` is called with a JWK, the system shall return the SHA-256 thumbprint using `jose.calculateJwkThumbprint`. |
| FAB-DPOP-006 | When `verifyDPoPProof` is called, the system shall extract the public key from the proof's `jwk` header, verify the JWT signature, and validate the payload claims. |
| FAB-DPOP-007 | If the DPoP proof `typ` header is not `"dpop+jwt"`, then the system shall throw a `DPoPError`. |
| FAB-DPOP-008 | If the DPoP proof `jwk` header is missing, then the system shall throw a `DPoPError`. |
| FAB-DPOP-009 | If the DPoP proof `iat` is older than `maxAge` seconds (default 60), then the system shall throw a `DPoPError` indicating the proof is stale. If the `iat` is more than 5 seconds in the future, the system shall throw a `DPoPError` indicating the proof is from the future. |
| FAB-DPOP-010 | If the DPoP proof `htm` does not match the expected HTTP method (case-insensitive comparison after uppercasing), then the system shall throw a `DPoPError`. |
| FAB-DPOP-011 | If the DPoP proof `htu` does not match the expected HTTP URL, then the system shall throw a `DPoPError`. |
| FAB-DPOP-012 | Where an `accessToken` is provided for verification, if the DPoP proof `ath` claim does not match the SHA-256 hash of the access token, then the system shall throw a `DPoPError`. |
| FAB-DPOP-013 | Where a `nonceStore` is configured, if the DPoP proof `jti` has already been seen, then the system shall throw a `DPoPError` indicating a replay attack. |
| FAB-DPOP-014 | Where a `nonceStore` is configured and the `jti` is new, the system shall store the `jti` with an expiry of `iat + maxAge`. |
| FAB-DPOP-015 | When `extractDPoPThumbprint` is called with a DPoP proof JWT, the system shall extract the `jwk` from the protected header and return its SHA-256 thumbprint. |
| FAB-DPOP-016 | If `extractDPoPThumbprint` is called with a proof that has no `jwk` header, then the system shall throw a `DPoPError`. |
| FAB-DPOP-017 | The system shall define a `DPoPAlgorithm` type constrained to the values `"ES256"` and `"RS256"`. |

---

### 3.12 Agentic Pay Client

| ID | Requirement |
|----|-------------|
| FAB-WCL-001 | The system shall define a `DefaultAgenticPayClient` class that implements both `AgenticPayClientForClient` and `AgenticPayClientForFacilitator` interfaces. |
| FAB-WCL-002 | When `authorize` is called on Agentic Pay client, the system shall send an HTTP POST to `{baseUrl}/transactions` with the payment authorization payload as JSON. |
| FAB-WCL-003 | When `verifyPaymentToken` is called on Agentic Pay client, the system shall fetch the Agentic Pay's public keys from `{baseUrl}/.well-known/jwks.json` using `jose.createRemoteJWKSet` and verify the JWT signature. |
| FAB-WCL-004 | When `capturePayment` is called on Agentic Pay client, the system shall send an HTTP POST to `{baseUrl}/capture` with the transaction ID, amount, and currency as JSON. |
| FAB-WCL-005 | Where authentication is configured on Agentic Pay client, the system shall apply the configured authenticator to all outgoing HTTP requests before sending. |
| FAB-WCL-006 | Agentic Pay client shall cache JWKS remote sets with a TTL of 1 hour to avoid redundant network requests. |
| FAB-WCL-007 | If Agentic Pay returns a non-OK HTTP response to `authorize`, then Agentic Pay client shall throw a `ValidationError` containing the HTTP status code and response body. |
| FAB-WCL-008 | If Agentic Pay response to `authorize` is missing `transactionId` or `paymentToken`, then Agentic Pay client shall throw a `ValidationError`. |
| FAB-WCL-009 | If Agentic Pay response to `capturePayment` is missing `success` or `captureId`, then Agentic Pay client shall throw a `ValidationError`. |
| FAB-WCL-010 | The `DefaultAgenticPayClient` constructor shall strip trailing slashes from the `baseUrl`. |

### 3.13 Facilitator Client

| ID | Requirement |
|----|-------------|
| FAB-FCL-001 | The system shall provide an `InProcessFacilitatorClient` that implements the `FacilitatorClient` interface from `@x402/core/http` by wrapping an in-process `x402Facilitator` instance. |
| FAB-FCL-002 | The `InProcessFacilitatorClient` shall delegate `verify`, `settle`, and `getSupported` calls directly to the wrapped `x402Facilitator`. |
| FAB-FCL-003 | The system shall provide a `AgenticPayFacilitatorClient` that implements the `FacilitatorClient` interface from `@x402/core/http` by communicating with the Agentic Pay provider's HTTP API. |
| FAB-FCL-004 | The `AgenticPayFacilitatorClient` constructor shall accept a `agenticPayBaseUrl` string and an optional `AgenticPayFacilitatorAuthConfig` object. |
| FAB-FCL-005 | The system shall define a `AgenticPayFacilitatorAuthConfig` interface with an optional `getAuthHeaders(): Promise<Record<string, string>>` method. |
| FAB-FCL-006 | When `getSupported` is called on the `AgenticPayFacilitatorClient`, the system shall fetch from `{agenticPayBaseUrl}/.well-known/x402-supported` and return the supported payment kinds. |
| FAB-FCL-007 | When `verify` is called on the `AgenticPayFacilitatorClient`, the system shall: (a) fetch the Agentic Pay's JWKS from `{agenticPayBaseUrl}/.well-known/jwks.json`, (b) verify the payment token signature, (c) check payment token expiry, (d) extract and match the quote token against requirements, (e) fetch the service's JWKS from `{quote.iss}/.well-known/jwks.json`, (f) verify the quote token signature, and (g) verify amounts match. |
| FAB-FCL-008 | When `settle` is called on the `AgenticPayFacilitatorClient`, the system shall first verify the payment, then send an HTTP POST to `{agenticPayBaseUrl}/capture` with the transaction ID, amount, and currency. |
| FAB-FCL-009 | The `AgenticPayFacilitatorClient` shall cache JWKS responses with a TTL of 1 hour. |
| FAB-FCL-010 | Where `AgenticPayFacilitatorAuthConfig` is provided, the `AgenticPayFacilitatorClient` shall include the auth headers in capture requests. |

### 3.13a Builders (Network-Aware Facilitator Routing)

| ID | Requirement |
|----|-------------|
| FAB-BLD-001 | The system shall provide a `createFABResourceServer` factory function that accepts base configuration (Agentic Pay URL, signing keys, service URL) and returns a `FABResourceServer` object with a `registerNetwork` method for adding networks individually. |
| FAB-BLD-001a | The system shall provide a `buildFABResourceServer` convenience function that accepts a list of networks and returns a fully configured `x402ResourceServer` with FAB facilitator precedence over the default facilitator. This delegates to `createFABResourceServer` internally. |
| FAB-BLD-002 | The system shall provide a `createFABClient` factory function that accepts base configuration (Agentic Pay URL, Agentic Pay ID, auth) and returns a `FABClient` object with a `registerNetwork` method for adding networks individually. |
| FAB-BLD-002a | The system shall provide a `buildFABClient` convenience function that accepts a list of networks and returns a fully configured `x402Client` with FAB client schemes registered for each network. This delegates to `createFABClient` internally. |
| FAB-BLD-003 | When `initialize()` is called without `disableDefaultFallback`, the system shall include an `HTTPFacilitatorClient` as a fallback facilitator for networks not handled by FAB. Routing options (`disableDefaultFallback`, `defaultFacilitatorUrl`) are passed to `initialize()`, not to `createFABResourceServer`. |
| FAB-BLD-004 | The `AgenticPayFacilitatorClient` shall support an optional `networkFilter` parameter that restricts `getSupported()` to only return kinds for networks in the filter set. |
| FAB-BLD-005 | When multiple facilitator clients are provided to `x402ResourceServer`, the FAB facilitator client shall be positioned first in the array to ensure precedence during `initialize()`. |
| FAB-BLD-006 | The system shall provide a `registerFABNetworks` helper that registers a `FABServerScheme` for each specified network on an existing `x402ResourceServer` without modifying facilitator client configuration. |
| FAB-BLD-007 | The `registerNetwork` method on `FABResourceServer` and `FABClient` shall be idempotent — calling it with the same network twice shall have no additional effect. |
| FAB-BLD-008 | The `registerNetwork` method shall return `this` to support method chaining (e.g., `server.registerNetwork('fab:aws').registerNetwork('eip155:8453')`). |
| FAB-BLD-009 | If `initialize()` is called on a `FABResourceServer` with no networks registered, the system shall throw a `ValidationError`. |

### 3.14 Agentic Pay Discovery

| ID | Requirement |
|----|-------------|
| FAB-DSC-001 | The system shall define a `AgenticPayDiscoveryMetadata` interface containing `issuer`, `jwks_uri`, `payment_endpoint`, `capture_endpoint` (required), and optional `supported_settlement_methods`, `signing_alg_values_supported`, `dpop_signing_alg_values_supported`, `token_endpoint_auth_methods_supported`, and `grant_types_supported`. |
| FAB-DSC-002 | When `registerNetwork` is called with a valid `fab:<provider>` network identifier and a valid URL, the system shall store the mapping in an internal registry. |
| FAB-DSC-003 | If `registerNetwork` is called with a network identifier that does not match the `fab:<provider>` format, then the system shall throw an `Error`. |
| FAB-DSC-004 | When `unregisterNetwork` is called, the system shall remove the network from the registry and return `true` if it existed, `false` otherwise. |
| FAB-DSC-005 | When `getRegisteredNetworks` is called, the system shall return a copy of the network-to-URL registry as a `Map<string, string>`. |
| FAB-DSC-006 | When `clearNetworkRegistry` is called, the system shall remove all registered networks. |
| FAB-DSC-007 | When `getAgenticPayBaseUrl` is called with a registered network identifier, the system shall return the corresponding base URL. |
| FAB-DSC-008 | If `getAgenticPayBaseUrl` is called with an unregistered network, then the system shall throw an `Error` instructing the caller to use `registerNetwork()`. |
| FAB-DSC-009 | When `discoverAgenticPayEndpoints` is called, the system shall fetch the OIDC discovery document from `{baseUrl}/.well-known/openid-configuration` and return the parsed `AgenticPayDiscoveryMetadata`. |
| FAB-DSC-010 | The system shall cache discovery metadata for 24 hours. Where `skipCache: true` is passed, the system shall bypass the cache. |
| FAB-DSC-011 | When `fetchAgenticPayPublicKeys` is called, the system shall first discover the `jwks_uri` via `discoverAgenticPayEndpoints`, then fetch and return the JWK Set from that URI. |
| FAB-DSC-012 | The system shall cache JWKS responses for 1 hour by default, or for the duration specified by the `Cache-Control: max-age` response header. |
| FAB-DSC-013 | When `clearDiscoveryCache` is called with no arguments, the system shall clear all cached discovery metadata. When called with a network identifier, it shall clear only that entry. |
| FAB-DSC-014 | When `clearJWKSCache` is called with no arguments, the system shall clear all cached JWK Sets. When called with a JWKS URI, it shall clear only that entry. |

### 3.15 Pre-configured Networks

| ID | Requirement |
|----|-------------|
| FAB-NET-001 | The system shall provide `FABAWSClientScheme`, `FABAWSServerScheme`, and `FABAWSFacilitatorScheme` as pre-configured scheme implementations for the `fab:aws` network. |
| FAB-NET-002 | The AWS pre-configured schemes shall use `https://pay.aws.amazon.com` as the default Agentic Pay base URL. |
| FAB-NET-003 | `FABAWSClientScheme` shall accept a `{ agenticPayId: string }` configuration and delegate to the base `FABClientScheme` with the AWS Agentic Pay URL. |
| FAB-NET-004 | `FABAWSServerScheme` shall accept a `{ signingKeys: SigningKeysConfig; serviceUrl: string }` configuration and delegate to the base `FABServerScheme` with the AWS Agentic Pay URL. |
| FAB-NET-005 | `FABAWSFacilitatorScheme` shall accept an optional `agenticPayId` (defaulting to `"aws-agentic-pay"`) and delegate to the base `FABFacilitatorScheme` with the AWS Agentic Pay URL. |

---

### 3.15a Express Middleware

| ID | Requirement |
|----|-------------|
| FAB-MWR-001 | The system shall provide a `fabPaymentMiddleware` factory function that accepts a `FABMiddlewareConfig` and returns an Express middleware function `(req, res, next) => void`. |
| FAB-MWR-002 | The middleware shall match incoming requests against a route map keyed by `"METHOD /path"` patterns, supporting exact paths, wildcard (`*`) segments, and method-agnostic patterns (path only, matching any HTTP method). |
| FAB-MWR-003 | When a request matches a protected route and no payment header is present, the middleware shall return an HTTP 402 response with a `WWW-Authenticate` header containing the base64-encoded `PaymentRequired` payload. |
| FAB-MWR-004 | When a request matches a protected route and a valid payment is present in the `Authorization: x402 <base64>`, `X-Payment`, or `payment-signature` header, the middleware shall verify the payment via `x402ResourceServer.verifyPayment`. |
| FAB-MWR-005 | When payment verification succeeds, the middleware shall attach a `PaymentInfo` object to `req.fabPayment` containing `payer`, `transactionId`, `network`, `amount`, and `asset`, then call `next()`. |
| FAB-MWR-006 | When payment verification fails, the middleware shall return an HTTP 402 response with a JSON body containing `error` and `details` fields. |
| FAB-MWR-007 | When the accepted payment requirements specify `capture: "auto"`, the middleware shall call `x402ResourceServer.settlePayment` after successful verification and before calling `next()`. |
| FAB-MWR-008 | If auto-capture settlement fails, the middleware shall return an HTTP 500 response with a JSON body describing the settlement failure. |
| FAB-MWR-009 | When a request does not match any protected route, the middleware shall call `next()` without processing payment logic. |
| FAB-MWR-010 | The middleware shall lazily initialize the `x402ResourceServer` (via `createFABResourceServer`) on the first request to a protected route, not at middleware creation time. |
| FAB-MWR-011 | If `fabPaymentMiddleware` is called with an empty `networks` array or an empty `routes` object, then it shall throw a `ValidationError`. |
| FAB-MWR-012 | Where an `onPaymentVerified` hook is configured, the middleware shall call it after successful verification and before calling `next()`. |
| FAB-MWR-013 | Where an `onPaymentSettled` hook is configured, the middleware shall call it after successful auto-capture settlement. |
| FAB-MWR-014 | Where an `onError` hook is configured, the middleware shall call it instead of returning a default 500 JSON error response when an unhandled exception occurs. |

### 3.16 Agentic Pay Provider Compatibility Contract

Any Agentic Pay provider that integrates with the FAB x402 extension shall expose the following HTTP endpoints:

| ID | Requirement |
|----|-------------|
| FAB-WCOMPAT-001 | A compatible Agentic Pay provider shall expose `POST /transactions` accepting a JSON body with `network`, `amount`, `currency`, `payTo`, `quoteToken`, and `agenticPayId` fields, and returning a JSON response with `transactionId` and `paymentToken` (a signed JWT). |
| FAB-WCOMPAT-002 | A compatible Agentic Pay provider shall expose `POST /capture` accepting a JSON body with `transactionId`, `amount`, and `currency` fields, and returning a JSON response with `success` (boolean), `captureId`, and `timestamp`. |
| FAB-WCOMPAT-003 | A compatible Agentic Pay provider shall expose `GET /.well-known/jwks.json` returning a JSON Web Key Set containing the public keys used to sign payment tokens. |
| FAB-WCOMPAT-004 | A compatible Agentic Pay provider shall expose `GET /.well-known/x402-supported` returning a `SupportedResponse` with `x402Version` and a `kinds` array listing supported payment schemes and networks. |
| FAB-WCOMPAT-005 | Where OIDC discovery is supported, a compatible Agentic Pay provider shall expose `GET /.well-known/openid-configuration` returning a `AgenticPayDiscoveryMetadata` document with at minimum `issuer`, `jwks_uri`, and `payment_endpoint`. |
| FAB-WCOMPAT-006 | Payment tokens issued by a compatible Agentic Pay provider shall be JWTs signed with RS256 or ES256, containing `iss`, `sub`, `aud`, `iat`, `exp`, and `payment_context` (with `transaction_id` and `quote_token`) claims. |
| FAB-WCOMPAT-007 | A compatible Agentic Pay provider shall verify that the `quoteToken` in a transaction request is a valid, unexpired JWT before authorizing the transaction. |

### 3.17 Exported Stubs

| ID | Requirement |
|----|-------------|
| FAB-STUB-001 | The system shall export a deprecated `fetchServicePublicKey(serviceUrl)` function that throws an `Error` directing callers to use `fetchServiceJWKS()` instead. The system shall export `fetchServiceJWKS(serviceUrl)` which returns a `jose.createRemoteJWKSet` function compatible with `jose.jwtVerify`, with results cached for 1 hour. The system shall export `clearServiceJWKSCache(serviceUrl?)` to invalidate cached entries. |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement |
|----|-------------|
| FAB-PRF-001 | The system shall complete schema validation in less than 1 millisecond per requirement object. |
| FAB-PRF-002 | The system shall complete quote token generation in less than 10 milliseconds. |
| FAB-PRF-003 | The system shall complete JWT signature verification in less than 20 milliseconds. |
| FAB-PRF-004 | The system shall produce a minified and gzipped bundle smaller than 50 KB. |

### 4.2 Security

| ID | Requirement |
|----|-------------|
| FAB-SEC-001 | The system shall validate all external inputs before processing. |
| FAB-SEC-002 | The system shall whitelist JWT signing algorithms to RS256 and ES256 only. |
| FAB-SEC-003 | The system shall check token expiry before performing any further processing. |
| FAB-SEC-004 | The system shall use `crypto.randomUUID()` for all nonce and JTI generation. |
| FAB-SEC-005 | The system shall not log private keys, payment tokens, or other sensitive credential material. |
| FAB-SEC-006 | The system shall use the Web Crypto API or Node.js `crypto` module for all cryptographic operations (no custom cryptographic implementations). |

### 4.3 Compatibility

| ID | Requirement |
|----|-------------|
| FAB-CMP-001 | The system shall be compatible with Node.js 18.0.0 and higher. |
| FAB-CMP-002 | The system shall declare `@x402/core@^2.0.0` as a peer dependency. |
| FAB-CMP-003 | The system shall produce both ESM (`dist/index.js`) and CommonJS (`dist/index.cjs`) build outputs. |
| FAB-CMP-004 | The system shall produce TypeScript declaration files (`dist/index.d.ts`). |
| FAB-CMP-005 | The system shall support tree-shaking by using named exports and ESM module format. |

### 4.4 Testability

| ID | Requirement |
|----|-------------|
| FAB-TST-001 | The system shall maintain a minimum of 90% line coverage across all source modules. |
| FAB-TST-002 | The system shall maintain a minimum of 90% function coverage across all source modules. |
| FAB-TST-003 | The system shall maintain a minimum of 90% branch coverage across all source modules. |
| FAB-TST-004 | The system shall use Vitest as the test framework. |
| FAB-TST-005 | The system shall provide mock helpers (`mock-service-signer.ts`, `mock-agentic-pay-client.ts`) for testing integrations. |

---

## 5. Correctness Properties

These properties define invariants that shall hold across all valid executions. They bridge human-readable requirements to machine-verifiable guarantees and are suitable for property-based testing.

| ID | Property | Validates |
|----|----------|-----------|
| FAB-PROP-001 | For any valid FAB payment requirements object, parsing with the schema and then serializing shall produce an equivalent object. | FAB-TYP-004, FAB-TYP-005 |
| FAB-PROP-002 | For any quote token generated with a private key, verification with the corresponding public key shall succeed and return the original payload. | FAB-SRV-001, FAB-UTL-003 |
| FAB-PROP-003 | For any payment token signed by an Agentic Pay provider, verification with the Agentic Pay's public key shall succeed and extract the embedded quote token. | FAB-FAC-001, FAB-UTL-004 |
| FAB-PROP-004 | For any network and ID components where the network starts with `"fab:"`, `formatTransactionId` followed by `parseTransactionId` shall return the original components. | FAB-UTL-010, FAB-UTL-012 |
| FAB-PROP-005 | For any valid amount string and asset string, `parseMoneyToDecimal` shall extract the numeric value and currency code correctly. | FAB-UTL-007, FAB-UTL-008 |
| FAB-PROP-006 | For any payment requirements with scheme `"fab"`, scheme detection shall return true; for any other scheme it shall return false. | FAB-REG-001 |
| FAB-PROP-007 | For any FAB payment requirements, extracting the extra field shall return a non-null `FABPaymentExtra` object. | FAB-TYP-004 |
| FAB-PROP-008 | For any invalid FAB payment structure, validation shall fail with a descriptive error message. | FAB-ERR-002 |
| FAB-PROP-009 | For any expired token, verification shall fail with an `ExpiryError` containing the expiry timestamp. | FAB-ERR-004 |
| FAB-PROP-010 | For any valid payment payload, the quote token in `accepted.extra.quoteToken` shall equal the quote token in `payload.paymentToken.payment_context.quote_token`. | FAB-FAC-003 |
| FAB-PROP-011 | For any DPoP key pair and proof options, creating a proof then verifying it with the same options shall succeed. | FAB-DPOP-003, FAB-DPOP-006 |
| FAB-PROP-012 | For any DPoP nonce store, verifying the same proof twice shall fail on the second attempt with a replay error. | FAB-DPOP-013 |
| FAB-PROP-013 | For any DPoP proof with `iat` outside the `maxAge` window, verification shall fail with a freshness error. | FAB-DPOP-009 |
| FAB-PROP-014 | For any DPoP proof, verification with a different HTTP method or URL shall fail with a binding error. | FAB-DPOP-010, FAB-DPOP-011 |
| FAB-PROP-015 | For any DPoP proof, `extractDPoPThumbprint` shall return the same value as `computeJWKThumbprint` called with the proof's embedded JWK. | FAB-DPOP-005, FAB-DPOP-015 |

---

## 6. Architecture Decisions and Rationale

This section captures the key design decisions, trade-offs, and reasoning behind the current architecture. It serves as institutional memory so that future changes are informed by past context.

### 6.1 Role Mapping: Why the Agentic Pay is Both Client and Facilitator

In crypto-based x402 schemes (EVM, SVM), the three roles map naturally to distinct parties: the user's Agentic Pay (client), the API (server), and a blockchain or payment processor (facilitator). In FAB, fiat payments don't have a decentralized settlement layer, so the Agentic Pay provider fills both the client role (authorizing payments) and the facilitator role (verifying and settling them).

| x402 Role | Crypto Schemes | FAB |
|-----------|---------------|-----|
| Client | User's crypto Agentic Pay | Agentic Pay provider (authorizes transactions) |
| Server | API/resource service | API/resource service (generates quote tokens) |
| Facilitator | Blockchain / payment processor | Agentic Pay provider (verifies + settles) |

This means the `AgenticPayFacilitatorClient` talks to the same Agentic Pay provider that the `FABClientScheme` authorizes payments through. No separate facilitator service is needed.

### 6.2 JWT Over Opaque Tokens

We chose JWTs for both quote tokens and payment tokens because:

- Signatures are verifiable without calling back to the issuer (offline verification)
- Standard tooling (`jose` library) handles signing, verification, and key management
- Claims are self-describing — the token carries its own metadata (amount, expiry, issuer)
- JWKS endpoints (`/.well-known/jwks.json`) provide a standard key distribution mechanism

The trade-off is token size (JWTs are larger than opaque references), but for machine-to-machine API payments this is negligible.

### 6.3 RS256 as Default Signing Algorithm

RS256 (RSA-SHA256) was chosen as the default for both `toServiceFABSigner` and `toAgenticPayFABSigner` because:

- Broad compatibility — RSA keys are universally supported across cloud KMS services
- Existing infrastructure — most services already have RSA key pairs for TLS/mTLS

ES256 (ECDSA P-256) is supported as an alternative and is recommended for DPoP key pairs due to faster key generation (~10-50ms vs ~100-500ms for RS256) and smaller signatures.

### 6.4 Client Delegates to Agentic Pay Provider, Not Local Signing

The `FABClientScheme.createPaymentPayload()` does not sign payment tokens locally. Instead, it calls the Agentic Pay provider's `POST /transactions` endpoint, which returns an Agentic Pay provider-signed payment token. This was a deliberate choice:

- The Agentic Pay provider controls the private key — clients never hold signing keys
- Agentic Pay can enforce spending limits, fraud checks, and authorization policies
- Transaction state (holds, captures) lives in the Agentic Pay's backend
- This matches how real payment systems work (Stripe, PayPal, etc.)

The design.md originally showed a local-signing approach using `AgenticPayFABSigner`. That was an early design iteration that was superseded.

### 6.5 Settlement as a Placeholder

The facilitator scheme's `settle()` currently returns a success placeholder. Real settlement requires:

1. Calling the Agentic Pay's `POST /capture` endpoint to capture held funds
2. Agentic Pay transferring funds to the service's account
3. Recording the settlement for reconciliation

This is intentionally deferred because settlement behavior varies by Agentic Pay provider. The `AgenticPayFacilitatorClient.settle()` implements the real HTTP-based capture flow, while the in-process `FABFacilitatorScheme.settle()` remains a stub for testing.

### 6.6 Service JWKS Fetching

The facilitator needs the service's public key to verify quote token signatures. The `fetchServiceJWKS(serviceUrl)` function fetches JWKS from `{serviceUrl}/.well-known/jwks.json` using `jose.createRemoteJWKSet` and caches results for 1 hour. The original `fetchServicePublicKey` is deprecated in favor of this function.

The `AgenticPayFacilitatorClient` independently fetches service JWKS and verifies quote token signatures — that path is fully operational. The in-process facilitator (`src/fab/facilitator/verify.ts`) also calls `fetchServiceJWKS` and `jose.jwtVerify`, but currently wraps the call in a try/catch that silently swallows failures, making it best-effort. Task 27 tracks making this verification mandatory.

### 6.7 Dependency Choices

| Dependency | Why | Alternative Considered |
|-----------|-----|----------------------|
| `jose` | Industry-standard JWT/JWK library, supports all needed algorithms, maintained by Panva | `jsonwebtoken` — older, less type-safe, no JWK support |
| `zod` | Runtime schema validation with TypeScript inference, composable | `joi` — heavier, no TS inference; `io-ts` — steeper learning curve |
| `@x402/core` (peer) | Base protocol types and interfaces; peer dep ensures single instance | Bundling it — would cause version conflicts |

### 6.8 Caching Strategy

| Cache | TTL | Rationale |
|-------|-----|-----------|
| JWKS (DefaultAgenticPayClient) | 1 hour | Keys rotate infrequently; 1h balances freshness vs. network calls |
| JWKS (AgenticPayFacilitatorClient) | 1 hour | Same reasoning; both clients cache independently |
| Discovery metadata | 24 hours | OIDC discovery docs change very rarely |
| JWKS via `fetchAgenticPayPublicKeys` | 1 hour default, respects `Cache-Control: max-age` | Follows HTTP caching semantics |

### 6.9 Error Handling Strategy

| Error Category | Behavior | Rationale |
|---------------|----------|-----------|
| Validation errors | Thrown synchronously during parsing | Fail fast — bad input should never reach crypto operations |
| Signature errors | Thrown asynchronously during verification | JWT verification is inherently async |
| Verification failures in facilitator | Returned as `{ valid: false }`, not thrown | The facilitator is a service boundary — callers need structured responses, not exceptions |
| Settlement failures in facilitator | Returned as `{ settled: false }`, not thrown | Same reasoning as verification |
| Network errors | Wrapped in `ValidationError` with original message | Keeps error hierarchy simple; callers catch `FABError` subtypes |
| Auth errors | Separate `AuthenticationError` hierarchy with `retryable` flag | Auth failures are distinct from payment failures; `retryable` lets callers implement retry logic |

### 6.10 Multi-Facilitator Routing and Network-Aware Registration

FAB introduces builder functions (`buildFABResourceServer`, `buildFABClient`) that simplify registration by accepting a list of networks and wiring up all the necessary schemes and facilitator clients automatically.

The key design decisions:

1. **FAB-first precedence**: The `x402ResourceServer` accepts `FacilitatorClient[]` and during `initialize()` maps `(version, network, scheme)` tuples to facilitator clients on a first-come-first-served basis. By placing the FAB facilitator first in the array, it claims its registered networks before the default facilitator can.

2. **Network filter on AgenticPayFacilitatorClient**: Without filtering, the Agentic Pay's `/.well-known/x402-supported` response might declare support for networks the integrator didn't intend to handle via FAB. This would shadow the default facilitator for those networks. The optional `networkFilter` parameter restricts `getSupported()` to only return kinds for explicitly chosen networks.

3. **Default facilitator fallback**: Unless `disableDefaultFallback` is set, `buildFABResourceServer` includes an `HTTPFacilitatorClient` (pointing at `https://x402.org/facilitator`) as the second facilitator. This means networks like `solana:mainnet` or `eip155:1` that FAB doesn't claim are automatically handled by the official x402 facilitator.

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
  "aud": "fab:aws",
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

### Payment Token (Agentic Pay → Service)

```json
{
  "iss": "https://pay.aws.amazon.com",
  "sub": "client_uuid_555",
  "aud": "https://api.weather.com",
  "iat": 1735689600,
  "exp": 1735693200,
  "payment_context": {
    "transaction_id": "fab:aws:7f8e9d0c1b2a3456",
    "quote_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

### Transaction ID Format

```
fab:aws:7f8e9d0c1b2a3456
└─┬──┘ └──────┬─────────┘
  │           └── 16-char hex unique ID (from crypto.randomUUID)
  └── network identifier
```


