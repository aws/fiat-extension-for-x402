# Implementation Plan: Agent Pay x402 TypeScript Extension

**Last Updated:** March 3, 2026  
**Version:** 0.1.0  
**Status:** ✅ Core Implementation Complete + Authentication + DPoP

---

## Current Status

### Quick Summary

The Agent Pay x402 extension is fully implemented with authentication and DPoP support, tested, and building successfully. All core functionality is in place with working examples and unified logging for complete payment flow visibility.

### Build & Test Status

| Check | Status | Details |
|-------|--------|---------|
| TypeScript Compilation | ✅ Pass | No errors |
| Unit Tests | ✅ Pass | 306/306 passing |
| Build (ESM) | ✅ Pass | dist/index.js |
| Build (CJS) | ✅ Pass | dist/index.cjs |
| Build (Types) | ✅ Pass | dist/index.d.ts |
| Dependencies | ✅ OK | @x402/core@2.3.1 |
| Examples | ✅ Working | Complete demo with logging |

### Test Coverage Summary

```
Test Files:  29 passed (30)
Tests:       306 passed | 1 skipped | 1 todo (308)

Breakdown by Module:
- Core Types & Utils:     62 tests ✅
- Agent Pay Schemes:            23 tests ✅
- Authentication:         28 tests ✅
- DPoP:                   33 tests ✅
- Discovery:              22 tests ✅
- Signer:                  6 tests ✅
- Integration:             8 tests ✅ (1 skipped)
```

### Implementation Progress

#### ✅ Completed Features (100%)

**Core Implementation:**
- Project setup and configuration
- Type definitions (all Agent Pay types)
- Scheme implementations (Client, Server, Facilitator)
- InProcessFacilitatorClient for demos/testing
- AgentPayFacilitatorClient for production
- JWT utilities (decode, verify, extract)
- Transaction ID utilities
- Money parsing utilities
- Constants and enums
- Signer interfaces
- Error classes
- Build configuration
- Package exports

**Authentication System (Task 23):**
- API Key authentication
- AWS SigV4 authentication (@smithy/signature-v4)
- OAuth2 authentication with token refresh
- Custom authentication
- Authentication factory pattern
- Authentication error types
- Integration with AgentPayClient
- 28 unit tests

**DPoP Implementation (Task 15):**
- Key generation (ES256, RS256)
- Proof creation with JWK thumbprints
- Proof verification with security checks
- Replay protection via nonce store
- HTTP method/URL binding
- Access token hash verification
- 33 unit tests

**Documentation:**
- Core documentation (design, requirements, tasks)
- Authentication guide
- DPoP guide
- Agent Pay discovery guide
- SDK explanation
- Working examples with unified logging

**Examples:**
- Mock Agent Pay server
- Test service with Agent Pay protection
- Test client with payment flow
- Authentication examples
- DPoP examples

#### ⏳ In Progress (0%)

Currently no tasks in progress.

#### ✅ Recently Completed (Beta Integration)

**Task 28: KMS Signer (`createKmsSigner`)**
- Factory function for sellers to sign quote tokens with AWS KMS (ECDSA_SHA_384)
- Calls KMS `Sign` with digest mode, converts DER→JWS signature format
- Calls `GetPublicKey` for the `getPublicKey()` method
- File: `src/signers/kms-signer.ts`
- Tests: e2e validated against real KMS key in beta

**Task 29: Payment Token Contract Alignment**
- `AGENT_PAY_AUDIENCE` corrected to `'aws:marketplace'` (matches wallet service)
- `PAYMENT_JWT_ISSUER` set to `'awsmp-agentpay.amazonaws.com'`
- `PaymentTokenPayload` updated: `payment_id`, `quote_token` at top level, `payment_context` deprecated
- `AgentPayPayloadV2`: added `paymentId` field, `transactionId` kept as deprecated alias
- File: `src/constants.ts`, `src/types.ts`

**Task 30: SellerKeyResolver for Payment Verification**
- `AgentPayFacilitatorClient.verify()` now supports three seller key resolution strategies:
  - `{ type: 'kms' }`: calls `kms:GetPublicKey` with seller's credentials
  - `{ type: 'jwks' }`: fetches from explicit JWKS URL
  - Fallback: fetches from quote token's `iss` claim (original behavior)
- File: `src/agent-pay-facilitator-client.ts`
- Tests: `test/unit/seller-key-resolver.test.ts` (6 tests)

**Task 31: Agent Pay JWKS CDN URL**
- Hardcoded `AGENT_PAY_JWKS_BASE_URL` so sellers don't configure it
- `fetchJWKS()` passes `authConfig.getAuthHeaders()` (needed for WAF-gated endpoints)
- Optional `jwksBaseUrl` constructor param for beta/testing override
- File: `src/constants.ts`, `src/agent-pay-facilitator-client.ts`

#### 📋 Planned / TODO

**Short Term:**
- OIDC discovery implementation (stub exists)
- Actual settlement logic (placeholder exists)
- Comprehensive Zod validation schemas
- Additional integration tests
- E2E authentication tests (optional)

**Long Term:**
- Property-based testing with fast-check
- Performance optimization
- CI/CD pipeline setup
- npm package publishing
- Integration with x402 monorepo

### Known Limitations

1. **AWS SigV4**: Real implementation using @smithy/signature-v4
2. **Quote Token Verification (In-Process)**: The in-process facilitator's quote signature check is best-effort (silently swallows failures). `AgentPayFacilitatorClient` verifies fully. Task 27 tracks making it mandatory.
3. **Settlement (In-Process)**: The in-process facilitator returns a placeholder. `AgentPayFacilitatorClient` calls `POST /capture` correctly.
4. **Zod Schemas**: Types exist but Zod schemas not fully implemented

### Dependencies

**Production:**
- `jose@^5.2.0` - JWT operations
- `zod@^3.22.4` - Schema validation

**Development:**
- `@x402/core@2.3.1` - Core x402 types and interfaces
- `typescript@^5.3.3` - TypeScript compiler
- `vitest@^1.2.0` - Testing framework
- `tsup@^8.0.1` - Build tool

**Peer:**
- `@x402/core@^2.0.0` - Required at runtime

### Changelog

#### 0.1.0 (2026-03-03)
- ✅ Initial implementation complete
- ✅ All core features implemented
- ✅ Authentication system (API Key, AWS SigV4, OAuth2, Custom)
- ✅ DPoP implementation (key generation, proof creation/verification)
- ✅ 306 unit tests passing
- ✅ Build verified (ESM + CJS + Types)
- ✅ Documentation complete
- ✅ Working examples with unified logging

---

## Overview

This document outlines the implementation tasks for building the Agent Pay x402 TypeScript extension. The implementation follows Specification-Driven Development (SDD) with Test-Driven Development (TDD), meaning we write tests first based on the specification, then implement the code to make those tests pass.

## Task Completion Legend

- [x] Completed task
- [ ] Pending task
- [x]* Completed with optional subtasks remaining
- ⚠️  Completed with known limitations

---

## Tasks
- [x] 1. Project Setup and Infrastructure
  - Initialize npm package with TypeScript configuration
  - Set up build tooling (tsup for bundling)
  - Configure Vitest for testing
  - Set up fast-check for property-based testing
  - Configure ESLint and Prettier
  - Set up CI/CD pipeline (GitHub Actions)
  - _Requirements: 12.5, 12.6, 12.7, 12.8_

- [x] 2. Core Type Definitions
  - [ ] 2.1 Define settlement types (CaptureMode, SettlementMethod, SettlementCycle, FABSettlement)
    - Create TypeScript interfaces and type aliases
    - Export from types/settlement.ts
    - _Requirements: 1.7_

  - [ ] 2.2 Define support and terms types (FABSupport, FABTerms)
    - Create TypeScript interfaces
    - Export from types/settlement.ts
    - _Requirements: 1.8_

  - [ ] 2.3 Define AgentPayPaymentExtra interface
    - Include all required and optional fields
    - Export from types/payment.ts
    - _Requirements: 1.1_

  - [ ] 2.4 Define FABPaymentRequirements interface
    - Extend PaymentRequirementsV2 from @x402/core
    - Add typed extra field
    - Export from types/payment.ts
    - _Requirements: 1.2_

  - [ ] 2.5 Define FABPaymentRequired and FABPaymentPayload interfaces
    - Create complete payment flow types
    - Export from types/payment.ts
    - _Requirements: 1.3, 1.4, 1.5_

  - [ ] 2.6 Define quote token types (QuoteTokenPayload, QuoteTokenPrice)
    - Create JWT payload structure
    - Export from types/quote.ts
    - _Requirements: 4.1_

  - [ ] 2.7 Define payment token types (PaymentTokenPayload, PaymentContext)
    - Create JWT payload structure
    - Export from types/payment.ts
    - _Requirements: 5.1_

  - [ ] 2.8 Define transaction ID types (TransactionIdComponents)
    - Create component structure
    - Export from types/transaction-id.ts
    - _Requirements: 6.8_

  - [ ] 2.9 Define error types (AgentPayError, ValidationError, SignatureError, ExpiryError, MismatchError)
    - Create error class hierarchy
    - Include error codes and details
    - Export from types/errors.ts
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8_

- [x] 3. Validation Schemas
  - [ ] 3.1 Create settlement validation schemas
    - Implement FABSettlementSchema with method and cycle validation
    - Implement FABSupportSchema with URL and method validation
    - Implement FABTermsSchema with description and URL validation
    - Export from schemas/settlement.ts
    - _Requirements: 2.4, 2.5, 2.6_

  - [ ]* 3.2 Write property tests for settlement schemas
    - **Property 1: Schema Validation Round-Trip**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ] 3.3 Create AgentPayPaymentExtra validation schema
    - Require quoteToken as non-empty string
    - Validate optional fields (capture, reference, settlement, support, terms)
    - Export from schemas/payment.ts
    - _Requirements: 2.2, 2.3_

  - [ ]* 3.4 Write property tests for AgentPayPaymentExtra schema
    - **Property 1: Schema Validation Round-Trip**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ] 3.5 Create FABPaymentRequirements validation schema
    - Extend PaymentRequirementsV2Schema from @x402/core
    - Enforce scheme literal "fab" and network pattern "fab:*"
    - Export from schemas/payment.ts
    - _Requirements: 2.7, 2.8_

  - [ ]* 3.6 Write property tests for Agent PayPaymentRequirements schema
    - **Property 1: Schema Validation Round-Trip**
    - **Validates: Requirements 2.1, 2.2, 2.3**

  - [ ] 3.7 Create FABPaymentPayloadData validation schema
    - Validate paymentToken and transactionId as non-empty strings
    - Export from schemas/payment.ts
    - _Requirements: 2.1_

  - [ ]* 3.8 Write unit tests for schema error messages
    - **Property 8: Validation Error Messages**
    - **Validates: Requirements 7.1, 7.2**

- [x] 4. Helper Functions - Extraction
  - [ ] 4.1 Implement extractFABExtra function
    - Check scheme is "fab"
    - Return null for non-Agent-Pay schemes
    - Cast and return extra field
    - Export from utils/extraction.ts
    - _Requirements: 3.1, 3.2_

  - [ ]* 4.2 Write property tests for extractFABExtra
    - **Property 7: Extra Field Extraction**
    - **Validates: Requirements 3.1, 3.2**

  - [ ] 4.3 Implement isFABScheme function
    - Check if scheme equals "fab"
    - Export from utils/extraction.ts
    - _Requirements: 3.7_

  - [ ]* 4.4 Write property tests for isFABScheme
    - **Property 6: Agent Pay Scheme Detection**
    - **Validates: Requirements 3.7**

  - [ ] 4.5 Implement findFABRequirements function
    - Find first Agent Pay entry in accepts array
    - Return null if not found
    - Export from utils/extraction.ts
    - _Requirements: 3.8_

  - [ ]* 4.6 Write unit tests for findFABRequirements
    - Test with empty array
    - Test with no Agent Pay entries
    - Test with multiple Agent Pay entries (returns first)

- [x] 5. Helper Functions - Validation
  - [ ] 5.1 Implement validateFABRequirements function
    - Use FABPaymentRequirementsSchema.parse
    - Return boolean (no throwing)
    - Export from utils/validation.ts
    - _Requirements: 3.3, 3.4_

  - [ ]* 5.2 Write unit tests for validateFABRequirements
    - Test valid requirements return true
    - Test invalid requirements return false
    - Test various invalid scenarios

- [x] 6. Helper Functions - Amount Parsing
  - [ ] 6.1 Implement parseAmount function
    - Remove "iso4217:" prefix from asset
    - Parse amount string to number
    - Return ParsedAmount object
    - Export from utils/amount.ts
    - _Requirements: 3.5, 3.6_

  - [ ]* 6.2 Write property tests for parseAmount
    - **Property 5: Amount Parsing Consistency**
    - **Validates: Requirements 3.5, 3.6**

- [x] 7. Helper Functions - Transaction ID
  - [ ] 7.1 Implement parseTransactionId function
    - Split on colon delimiter
    - Validate format and network prefix
    - Throw ValidationError on invalid format
    - Export from utils/transaction-id.ts
    - _Requirements: 6.1, 6.2, 6.3_

  - [ ]* 7.2 Write property tests for parseTransactionId
    - **Property 4: Transaction ID Format Consistency**
    - **Validates: Requirements 6.1, 6.2, 6.4**

  - [ ] 7.3 Implement formatTransactionId function
    - Validate network prefix
    - Concatenate with colon delimiter
    - Export from utils/transaction-id.ts
    - _Requirements: 6.4, 6.5_

  - [ ]* 7.4 Write property tests for formatTransactionId
    - **Property 4: Transaction ID Format Consistency**
    - **Validates: Requirements 6.1, 6.2, 6.4**

  - [ ] 7.5 Implement isValidTransactionId function
    - Call parseTransactionId and catch errors
    - Return boolean
    - Export from utils/transaction-id.ts
    - _Requirements: 6.6_

  - [ ] 7.6 Implement extractNetworkFromTransactionId function
    - Call parseTransactionId and return network
    - Export from utils/transaction-id.ts
    - _Requirements: 6.7_

  - [ ]* 7.7 Write unit tests for transaction ID edge cases
    - Test various invalid formats
    - Test network extraction
    - Test validation function

- [x] 8. JWT Operations - Quote Token
  - [ ] 8.1 Implement generateQuoteToken function
    - Generate JTI using crypto.randomUUID()
    - Set iat to current timestamp
    - Sign with RS256 using jose library
    - Export from jwt/quote.ts
    - _Requirements: 4.2, 4.3, 4.4_

  - [ ]* 8.2 Write property tests for generateQuoteToken
    - **Property 2: Quote Token Signature Verification**
    - **Validates: Requirements 4.3, 4.6**

  - [ ] 8.3 Implement verifyQuoteToken function
    - Verify signature using jose.jwtVerify
    - Check expiry timestamp
    - Throw SignatureError or ExpiryError on failure
    - Export from jwt/quote.ts
    - _Requirements: 4.5, 4.6_

  - [ ]* 8.4 Write property tests for verifyQuoteToken
    - **Property 2: Quote Token Signature Verification**
    - **Validates: Requirements 4.3, 4.6**
    - **Property 9: Token Expiry Enforcement**
    - **Validates: Requirements 7.3, 5.6**

  - [ ] 8.5 Implement decodeQuoteToken function
    - Use jose.decodeJwt (no verification)
    - Return payload
    - Throw descriptive error on malformed JWT
    - Export from jwt/quote.ts
    - _Requirements: 4.7, 4.8_

  - [ ]* 8.6 Write unit tests for decodeQuoteToken
    - Test valid JWT decoding
    - Test malformed JWT error handling

- [x] 9. JWT Operations - Payment Token
  - [ ] 9.1 Implement verifyPaymentToken function
    - Verify signature using jose.jwtVerify
    - Check expiry timestamp
    - Throw SignatureError or ExpiryError on failure
    - Export from jwt/payment.ts
    - _Requirements: 5.2, 5.3_

  - [ ]* 9.2 Write property tests for verifyPaymentToken
    - **Property 3: Payment Token Signature Verification**
    - **Validates: Requirements 5.2, 5.3, 5.5**
    - **Property 9: Token Expiry Enforcement**
    - **Validates: Requirements 7.3, 5.6**

  - [ ] 9.3 Implement extractQuoteFromPayment function
    - Extract quote_token from payment_context
    - Export from jwt/payment.ts
    - _Requirements: 5.4, 5.5_

  - [ ]* 9.4 Write unit tests for extractQuoteFromPayment
    - Test extraction from valid payment token
    - Test missing payment_context handling

- [x] 10. JWT Operations - Combined Verification
  - [ ] 10.1 Implement verifyPaymentAndQuote function
    - Verify payment token with Agent Pay key
    - Extract and verify quote token with service key
    - Check quote token consistency between accepted and payment JWT
    - Throw MismatchError on inconsistency
    - Export from jwt/verification.ts
    - _Requirements: 5.6, 5.7, 5.8_

  - [ ]* 10.2 Write property tests for verifyPaymentAndQuote
    - **Property 10: Quote Token Consistency in Payment**
    - **Validates: Requirements 5.7, 7.5**

  - [ ]* 10.3 Write integration tests for complete verification flow
    - Test successful verification
    - Test quote mismatch detection
    - Test signature failures
    - Test expiry handling

- [x] 11. Agent Pay Client Implementation
  - [ ] 11.1 Implement AgentPayClient class constructor
    - Accept baseUrl and authentication configuration
    - Support multiple auth methods (API key, AWS SigV4, OAuth2, custom)
    - Store configuration
    - Export from client/agent-pay-client.ts
    - _Requirements: 8.2_

  - [ ] 11.2 Implement Agent Pay authentication mechanisms
    - [ ] 11.2.1 Implement API key authentication
      - Add API key to request headers
      - Support custom header names
    - [ ] 11.2.2 Implement AWS SigV4 authentication
      - Sign requests using AWS Signature Version 4
      - Support AWS credentials (access key, secret key, session token)
      - Support credential providers (environment, profile, IAM role)
      - Use @aws-sdk/signature-v4 or equivalent
    - [ ] 11.2.3 Implement OAuth2 bearer token authentication
      - Add bearer token to Authorization header
      - Support token refresh if needed
    - [ ] 11.2.4 Support custom authentication handlers
      - Allow users to provide custom auth function
      - Function receives request and returns signed/authenticated request
    - Export authentication utilities from client/auth.ts

  - [ ]* 11.3 Write unit tests for authentication mechanisms
    - Test API key authentication
    - Test AWS SigV4 signing (mocked credentials)
    - Test OAuth2 bearer token
    - Test custom auth handler

  - [ ] 11.4 Implement createTransaction method
    - Validate request structure
    - Apply authentication to request
    - Make HTTP POST to /transactions
    - Parse response
    - Handle errors and throw typed exceptions
    - _Requirements: 8.3, 8.4, 8.5_

  - [ ]* 11.5 Write unit tests for createTransaction (mocked HTTP)
    - Test successful transaction creation
    - Test validation errors
    - Test Agent Pay error responses
    - Test network errors
    - Test with different auth methods

  - [x] 11.6 ~~Implement getTransactionStatus method~~ (NOT NEEDED)
    - Payment token signature is sufficient proof
    - Services track processed transaction IDs for idempotency
    - Agent Pay state lookup is unnecessary

  - [x]* 11.7 ~~Write unit tests for getTransactionStatus~~ (NOT NEEDED)
    - Test not found errors
    - Test network errors
    - Test with different auth methods

  - [ ] 11.8 Define authentication and request/response interfaces
    - AuthConfig (union type for different auth methods)
    - ApiKeyAuth interface
    - AwsSigV4Auth interface (credentials, region, service)
    - OAuth2Auth interface (token, refreshToken)
    - CustomAuth interface (handler function)
    - TransactionRequest
    - TransactionResponse
    - TransactionStatus
    - Export from client/agent-pay-client.ts and client/auth.ts
    - _Requirements: 8.7, 8.8_

- [x] 12. Service Implementation
  - [ ] 12.1 Implement FABService class constructor
    - Accept ServiceConfig (serviceUrl, signingKey, acceptedProviders)
    - Store configuration
    - Export from service/fab-service.ts
    - _Requirements: 9.2_

  - [ ] 12.2 Implement generate402Response method
    - Generate quote token for each accepted Agent Pay
    - Build FABPaymentRequired structure
    - Include all FAB-specific fields in extra
    - Return complete 402 response
    - _Requirements: 9.3, 9.4, 9.5_

  - [ ]* 12.3 Write unit tests for generate402Response
    - Test single Agent Pay scenario
    - Test multiple Agent Pay scenario
    - Test with all optional fields
    - Test with minimal fields

  - [ ] 12.4 Implement verifyPayment method
    - Call verifyPaymentAndQuote
    - Check content consistency (amount, currency)
    - Return verified data
    - _Requirements: 9.6, 9.7, 9.8_

  - [ ]* 12.5 Write integration tests for verifyPayment
    - Test successful verification
    - Test amount mismatch detection
    - Test signature failures

  - [ ] 12.6 Define service interfaces
    - ServiceConfig
    - Generate402Options
    - Export from service/fab-service.ts
    - _Requirements: 9.1_

- [x] 13. Type Guards Implementation
  - [ ] 13.1 Implement isFABPaymentRequirements type guard
    - Use schema validation
    - Return boolean with type predicate
    - Export from types/index.ts
    - _Requirements: 1.6_

  - [ ] 13.2 Implement isFABPaymentRequired type guard
    - Check x402Version and accepts array
    - Return boolean with type predicate
    - Export from types/index.ts
    - _Requirements: 1.6_

  - [ ]* 13.3 Write unit tests for type guards
    - Test positive cases
    - Test negative cases
    - Test edge cases

- [x] 14. Main Entry Point and Exports
  - [ ] 14.1 Create main index.ts
    - Export all types
    - Export all schemas
    - Export all utilities
    - Export all classes
    - Export DPoP utilities
    - Organize exports by category
    - _Requirements: 1.1-1.8, 2.1-2.8, 3.1-3.8, 4.1-4.8, 5.1-5.8, 6.1-6.8, 15.1-15.15_

  - [ ] 14.2 Verify tree-shaking works
    - Test that unused exports are eliminated
    - Check bundle size
    - _Requirements: 13.8_

- [x] 15. DPoP Implementation
  - [ ] 15.1 Implement generateDPoPKeyPair function
    - Support ES256 (EC P-256) and RS256 (RSA 2048)
    - Return DPoPKeyPair with privateKey and publicKey (JWK)
    - Export from dpop/key-generation.ts
    - _Requirements: 15.1, 15.2_

  - [ ]* 15.2 Write unit tests for generateDPoPKeyPair
    - Test ES256 key generation
    - Test RS256 key generation
    - Verify key format and properties

  - [ ] 15.3 Implement createDPoPProof function
    - Generate jti (nonce) using crypto.randomUUID()
    - Include htm, htu, iat in payload
    - Compute ath (access token hash) if accessToken provided
    - Sign with private key, include public key in header
    - Set typ: "dpop+jwt" in header
    - Export from dpop/proof-creation.ts
    - _Requirements: 15.3, 15.4, 15.5_

  - [ ]* 15.4 Write property tests for createDPoPProof
    - **Property 11: DPoP Proof Verification Round-Trip**
    - **Validates: Requirements 15.3, 15.4, 15.6**

  - [ ] 15.5 Implement computeJWKThumbprint function
    - Use jose.calculateJwkThumbprint with SHA-256
    - Export from dpop/proof-creation.ts
    - _Requirements: 15.9_

  - [ ]* 15.6 Write unit tests for computeJWKThumbprint
    - Test with EC keys
    - Test with RSA keys
    - Verify thumbprint format

  - [ ] 15.7 Implement verifyDPoPProof function
    - Extract and import public key from proof header
    - Verify signature
    - Check typ header is "dpop+jwt"
    - Check freshness (iat within maxAge, default 60 seconds)
    - Check htm matches request method
    - Check htu matches request URL
    - Check ath matches access token hash if provided
    - Check jti uniqueness if nonce store provided
    - Throw DPoPError on any failure
    - Export from dpop/proof-verification.ts
    - _Requirements: 15.6, 15.7, 15.8_

  - [ ]* 15.8 Write property tests for verifyDPoPProof
    - **Property 11: DPoP Proof Verification Round-Trip**
    - **Property 12: DPoP JTI Uniqueness**
    - **Property 13: DPoP Freshness Enforcement**
    - **Property 14: DPoP HTTP Binding**
    - **Validates: Requirements 15.6, 15.7, 15.8**

  - [ ]* 15.9 Write unit tests for DPoP error scenarios
    - Test invalid typ header
    - Test missing jwk in header
    - Test signature verification failure
    - Test stale proof (iat too old)
    - Test future proof (iat too new)
    - Test htm mismatch
    - Test htu mismatch
    - Test ath mismatch
    - Test jti replay

  - [ ] 15.10 Define DPoP types
    - DPoPKeyPair interface
    - DPoPProofPayload interface
    - DPoPProofOptions interface
    - DPoPVerificationOptions interface
    - DPoPNonceStore interface
    - DPoPError class
    - Export from types/dpop.ts
    - _Requirements: 15.10, 15.11, 15.12_

  - [ ] 15.11 Update AgentPayClient to support DPoP
    - Add optional dpop_jwk parameter to createTransaction
    - Document DPoP usage in JSDoc
    - _Requirements: 15.13_

  - [ ] 15.12 Update FABService to support DPoP verification
    - Add optional dpopProof and request parameters to verifyPayment
    - Verify DPoP proof if provided
    - Check cnf claim in payment token matches DPoP key
    - Document when to require DPoP in JSDoc
    - _Requirements: 15.6, 15.7, 15.8_

  - [ ]* 15.13 Write integration tests for DPoP flow
    - Test complete flow: key generation → proof creation → verification
    - Test with access token binding
    - Test with nonce store
    - Test error scenarios

- [x] 16. Documentation
  - [ ] 16.1 Write README.md
    - Overview and introduction
    - Installation instructions
    - Quick start guide
    - DPoP usage section
    - Link to full documentation
    - _Requirements: 10.2, 15.14_

  - [ ] 16.2 Add JSDoc comments to all public APIs
    - Include parameter descriptions
    - Include return type descriptions
    - Include usage examples
    - Include @throws tags for errors
    - Document DPoP functions
    - _Requirements: 10.1, 15.14_

  - [ ] 16.3 Create service-side example
    - Show 402 generation
    - Show payment verification
    - Show DPoP verification
    - Include error handling
    - _Requirements: 10.3, 10.5, 15.14_

  - [ ] 16.4 Create client-side example
    - Show 402 parsing
    - Show Agent Pay interaction
    - Show DPoP key generation and proof creation
    - Show payment submission with DPoP
    - Include error handling
    - _Requirements: 10.4, 15.14_

  - [ ] 16.5 Document error types and scenarios
    - List all error classes including DPoPError
    - Describe when each occurs
    - Show error handling patterns
    - _Requirements: 10.6_

  - [ ] 16.6 Add TypeScript usage examples
    - Show type inference
    - Show type guards
    - Show generic usage
    - Show DPoP types
    - _Requirements: 10.7_

  - [ ] 16.7 Add reference to Agent Pay protocol spec
    - Link to fab-x402-payment-structure-proposal.md
    - Link to Agent Pay-spec.md (Appendix A.3 for DPoP)
    - Link to fab.md
    - _Requirements: 10.8_

  - [ ] 16.8 Document DPoP security benefits
    - Explain token theft prevention
    - Explain replay attack prevention
    - Explain when to use DPoP
    - Provide security recommendations
    - _Requirements: 15.15_

- [ ] 17. Performance Optimization
  - [ ] 17.1 Implement schema caching
    - Cache compiled Zod schemas
    - Measure validation performance
    - _Requirements: 13.1, 13.5_

  - [ ] 17.2 Implement key caching
    - Cache parsed public keys with TTL
    - Measure verification performance
    - _Requirements: 13.3, 13.5_

  - [ ] 17.3 Add batch validation support
    - Support validating multiple requirements at once
    - Optimize for common case
    - _Requirements: 13.6_

  - [ ]* 17.4 Run performance benchmarks
    - Measure validation time (target: < 1ms)
    - Measure quote generation time (target: < 10ms)
    - Measure signature verification time (target: < 20ms)
    - Measure DPoP proof creation/verification time
    - Measure bundle size (target: < 50KB gzipped)
    - _Requirements: 13.1, 13.2, 13.3, 13.8_

- [x] 18. Security Hardening
  - [ ] 18.1 Implement input validation for all external inputs
    - Validate URLs to prevent injection
    - Validate JWT algorithms (allowlist RS256, ES256, ES384, ES512)
    - Validate token expiry before processing
    - _Requirements: 14.1, 14.3, 14.4_

  - [ ] 18.2 Implement constant-time comparison for signatures
    - Use crypto.timingSafeEqual where applicable
    - _Requirements: 14.2_

  - [ ] 18.3 Implement secure random for JTI
    - Use crypto.randomUUID()
    - _Requirements: 14.6_

  - [ ] 18.4 Add security documentation
    - Document security considerations
    - Provide secure usage examples
    - Warn about common pitfalls
    - _Requirements: 14.8_

  - [ ]* 18.5 Run security audit
    - Check for sensitive data logging
    - Verify no private keys in errors
    - Test URL validation
    - Test JWT algorithm validation

- [x] 18b. Build and Distribution
  - [ ] 18.1 Configure tsup for dual builds
    - ESM output
    - CommonJS output
    - TypeScript declarations
    - Source maps
    - _Requirements: 12.8_

  - [ ] 18.2 Set up package.json exports
    - Main entry point
    - Module entry point
    - Types entry point
    - _Requirements: 12.8_

  - [ ] 18.3 Configure peer dependencies
    - @x402/core as peer dependency
    - Specify version range
    - _Requirements: 12.1_

  - [ ] 18.4 Set up npm publishing workflow
    - Automated releases
    - Version bumping
    - Changelog generation
    - _Requirements: 15.1, 15.5_

- [ ] 19. CI/CD Pipeline
  - [ ] 19.1 Set up GitHub Actions for testing
    - Run tests on push
    - Run tests on pull request
    - Test on multiple Node versions
    - _Requirements: 11.1-11.8_

  - [ ] 19.2 Set up code coverage reporting
    - Generate coverage reports
    - Enforce 90% minimum coverage
    - Upload to coverage service
    - _Requirements: 11.1_

  - [ ] 19.3 Set up automated dependency updates
    - Dependabot configuration
    - Automated security updates
    - _Requirements: 12.6, 12.7_

  - [ ] 19.4 Set up automated releases
    - Semantic release configuration
    - Automated changelog
    - npm publishing
    - _Requirements: 15.1, 15.2, 15.3, 15.4_

- [ ] 20. Final Integration Testing
  - [ ]* 20.1 Write end-to-end integration tests
    - Complete service-to-client flow
    - Multiple Agent Pay providers
    - Error scenarios
    - Recovery scenarios

  - [ ]* 20.2 Test compatibility with @x402/core
    - Verify types extend correctly
    - Verify schemas compose correctly
    - Test with real x402 SDK

  - [ ] 20.3 Manual testing checklist
    - Test in Node.js environment
    - Test in browser environment
    - Test with real JWT libraries
    - Test error messages are clear

- [ ] 21. Release Preparation
  - [ ] 21.1 Write CHANGELOG.md
    - Document all features
    - Document breaking changes
    - Document migration guide
    - _Requirements: 15.5, 15.6_

  - [ ] 21.2 Update version to 1.0.0
    - Follow semantic versioning
    - _Requirements: 15.1_

  - [ ] 21.3 Create GitHub release
    - Tag version
    - Include changelog
    - Include migration guide
    - _Requirements: 15.5_

  - [ ] 21.4 Publish to npm
    - Verify package contents
    - Publish with public access
    - Verify installation works
    - _Requirements: 12.8_

- [x]* 22. Implement AgentPayFacilitatorClient (Replaces InProcessFacilitatorClient)

  **Status (implemented):** Core `AgentPayFacilitatorClient` class implemented in `src/agent-pay-facilitator-client.ts`. Implements `FacilitatorClient` interface with full `verify()` (JWT signature verification against Agent Pay JWKS + service JWKS, amount matching), `settle()` (calls `POST /capture`), and `getSupported()` (fetches `/.well-known/x402-supported` with optional network filter). JWKS caching with 1-hour TTL. Remaining subtasks (22.5 unit tests, 22.7 integration tests, 22.8 example updates, 22.9 deprecation, 22.10 docs) are deferred.

  - [x] 22.1 Create AgentPayFacilitatorClient class
    - Implement FacilitatorClient interface from @x402/core/http
    - Accept agentPayBaseUrl in constructor
    - Store base URL for API calls
    - Export from src/agent-pay-facilitator-client.ts
    - _Purpose: Adapter that translates x402 FacilitatorClient interface to Agent Pay provider's API_

  - [x] 22.2 Implement getSupported() method
    - Fetch from `${agentPayBaseUrl}/.well-known/x402-supported`
    - Parse and return SupportedResponse
    - Handle network errors gracefully
    - Cache response with TTL (optional optimization)
    - _Returns: List of supported payment kinds (schemes/networks) that Agent Pay can facilitate_

  - [x] 22.3 Implement verify() method
    - Extract payment token from PaymentPayload
    - Fetch Agent Pay's JWKS from `${agentPayBaseUrl}/.well-known/jwks.json`
    - Verify payment token JWT signature using Agent Pay's public key
    - Extract quote token from payment token's payment_context
    - Fetch service's JWKS (from quote token's iss field + /.well-known/jwks.json)
    - Verify quote token JWT signature using service's public key
    - Validate quote token matches requirements.extra.quoteToken
    - Check transaction exists via `GET ${agentPayBaseUrl}/transactions/${transactionId}`
    - Validate amounts and currencies match between quote, requirements, and transaction
    - Return VerifyResponse with valid: true/false and details
    - _Purpose: Verifies payment token and quote token signatures, checks transaction validity_

  - [x] 22.4 Implement settle() method
    - Call this.verify() first to ensure payment is valid
    - If verification fails, return SettleResponse with settled: false
    - Extract transactionId and amount/currency from payload
    - Call `POST ${agentPayBaseUrl}/capture` with transaction details
    - Parse capture response
    - Return SettleResponse with settled: true/false and settlement details
    - _Purpose: Captures/settles the payment by calling Agent Pay's capture endpoint_

  - [ ]* 22.5 Write unit tests for AgentPayFacilitatorClient
    - Mock fetch calls to Agent Pay endpoints
    - Test getSupported() with valid response
    - Test getSupported() with network error
    - Test verify() with valid payment
    - Test verify() with invalid signature
    - Test verify() with expired token
    - Test verify() with amount mismatch
    - Test verify() with missing transaction
    - Test settle() with successful capture
    - Test settle() with failed verification
    - Test settle() with capture failure

  - [ ] 22.6 Add Agent Pay endpoint: GET /.well-known/x402-supported
    - Add to mock-agent-pay-server.ts
    - Return SupportedResponse with x402Version: 2
    - Include supported kinds array with fab:test entry
    - Include agentPayId in extra field
    - _Example response:_
      ```json
      {
        "x402Version": 2,
        "kinds": [{
          "x402Version": 2,
          "scheme": "fab",
          "network": "fab:test",
          "extra": { "agentPayId": "test-agent-pay-provider" }
        }]
      }
      ```

  - [ ]* 22.7 Write integration tests for complete flow
    - Start mock Agent Pay server
    - Create AgentPayFacilitatorClient pointing to mock Agent Pay
    - Test getSupported() returns fab:test
    - Create valid payment payload
    - Test verify() succeeds
    - Test settle() succeeds
    - Test end-to-end flow with x402ResourceServer

  - [ ] 22.8 Update examples to use AgentPayFacilitatorClient
    - Replace InProcessFacilitatorClient usage in test-service.ts
    - Update to: `const facilitatorClient = new AgentPayFacilitatorClient('http://localhost:3001')`
    - Remove x402Facilitator and AgentPayFacilitatorScheme imports
    - Simplify example code significantly
    - Update comments to explain agent-pay-as-facilitator pattern

  - [ ] 22.9 Deprecate InProcessFacilitatorClient
    - Add @deprecated JSDoc comment
    - Update documentation to recommend AgentPayFacilitatorClient
    - Keep for backward compatibility but mark as legacy
    - Add deprecation notice in README

  - [ ] 22.10 Update architecture documentation
    - Update design.md to explain agent-pay-as-facilitator pattern
    - Remove separate facilitator service from architecture diagrams
    - Update flow diagrams to show direct Agent Pay communication
    - Explain why Agent Pay doesn't need separate facilitator (unlike crypto schemes)
    - Document that Agent Pay provider IS the facilitator in FAB

- [x] 23. Client to Agent Pay Authentication
  - [x] 23.1 Design authentication architecture
    - Define authentication flow between client application and Agent Pay provider
    - Support multiple authentication methods (API key, AWS SigV4, OAuth2, custom)
    - Design credential management and storage patterns
    - Document security considerations for each auth method
    - _Purpose: Enable secure client-to-Agent Pay communication for payment authorization_

  - [x] 23.2 Define authentication interfaces and types
    - [ ] 23.2.1 Create base AuthConfig type (union of all auth methods)
      ```typescript
      type AuthConfig = 
        | ApiKeyAuthConfig 
        | AwsSigV4AuthConfig 
        | OAuth2AuthConfig 
        | CustomAuthConfig;
      ```
    - [ ] 23.2.2 Define ApiKeyAuthConfig interface
      - apiKey: string (the API key value)
      - headerName?: string (default: 'X-API-Key')
      - prefix?: string (optional prefix like 'Bearer ')
    - [ ] 23.2.3 Define AwsSigV4AuthConfig interface
      - credentials: AwsCredentials (accessKeyId, secretAccessKey, sessionToken?)
      - region: string (AWS region, e.g., 'us-east-1')
      - service: string (AWS service name, default: 'execute-api')
      - credentialProvider?: () => Promise<AwsCredentials> (for dynamic credentials)
    - [ ] 23.2.4 Define OAuth2AuthConfig interface
      - accessToken: string (current access token)
      - refreshToken?: string (for token refresh)
      - tokenEndpoint?: string (OAuth2 token endpoint URL)
      - clientId?: string (OAuth2 client ID)
      - clientSecret?: string (OAuth2 client secret)
      - onTokenRefresh?: (newToken: string) => void (callback for token updates)
    - [ ] 23.2.5 Define CustomAuthConfig interface
      - authenticate: (request: AuthenticatedRequest) => Promise<AuthenticatedRequest>
      - Custom function that receives request and returns authenticated request
    - [ ] 23.2.6 Define AuthenticatedRequest interface
      - url: string
      - method: string
      - headers: Record<string, string>
      - body?: string
    - Export all types from src/auth/types.ts

  - [ ] 23.3 Implement API Key authentication
    - [ ] 23.3.1 Create ApiKeyAuthenticator class
      - Constructor accepts ApiKeyAuthConfig
      - Implement authenticate(request) method
      - Add API key to request headers
      - Support custom header names
      - Support optional prefix (e.g., 'Bearer ')
    - [ ] 23.3.2 Handle edge cases
      - Validate API key is non-empty
      - Sanitize header name
      - Preserve existing headers
    - [ ]* 23.3.3 Write unit tests
      - Test with default header name
      - Test with custom header name
      - Test with prefix
      - Test header preservation
      - Test empty API key error
    - Export from src/auth/api-key.ts

  - [ ] 23.4 Implement AWS SigV4 authentication
    - [ ] 23.4.1 Create AwsSigV4Authenticator class
      - Constructor accepts AwsSigV4AuthConfig
      - Implement authenticate(request) method
      - Sign requests using AWS Signature Version 4
      - Support static credentials
      - Support credential providers (for IAM roles, environment variables)
      - Use @aws-sdk/signature-v4 or equivalent library
    - [ ] 23.4.2 Implement credential resolution
      - Support explicit credentials (accessKeyId, secretAccessKey, sessionToken)
      - Support credential provider functions
      - Support AWS SDK default credential chain (environment, profile, IAM role)
      - Cache credentials with expiration handling
    - [ ] 23.4.3 Handle edge cases
      - Validate region format
      - Validate service name
      - Handle credential expiration
      - Handle signing errors
    - [ ]* 23.4.4 Write unit tests (with mocked AWS SDK)
      - Test with static credentials
      - Test with credential provider
      - Test signature generation
      - Test credential caching
      - Test credential expiration
      - Test error handling
    - Export from src/auth/aws-sigv4.ts

  - [ ] 23.5 Implement OAuth2 authentication
    - [ ] 23.5.1 Create OAuth2Authenticator class
      - Constructor accepts OAuth2AuthConfig
      - Implement authenticate(request) method
      - Add bearer token to Authorization header
      - Support token refresh flow
      - Handle token expiration
    - [ ] 23.5.2 Implement token refresh logic
      - Detect token expiration (401 responses)
      - Call token endpoint with refresh token
      - Update access token
      - Trigger onTokenRefresh callback
      - Retry original request with new token
    - [ ] 23.5.3 Handle edge cases
      - Validate token format
      - Handle missing refresh token
      - Handle refresh failures
      - Prevent infinite refresh loops
    - [ ]* 23.5.4 Write unit tests (with mocked token endpoint)
      - Test bearer token addition
      - Test token refresh flow
      - Test refresh callback
      - Test refresh failure handling
      - Test missing refresh token
    - Export from src/auth/oauth2.ts

  - [ ] 23.6 Implement custom authentication
    - [ ] 23.6.1 Create CustomAuthenticator class
      - Constructor accepts CustomAuthConfig
      - Implement authenticate(request) method
      - Delegate to user-provided authenticate function
      - Handle async authentication
    - [ ] 23.6.2 Handle edge cases
      - Validate custom function is provided
      - Catch and wrap authentication errors
      - Preserve request immutability
    - [ ]* 23.6.3 Write unit tests
      - Test with sync custom function
      - Test with async custom function
      - Test error handling
      - Test request preservation
    - Export from src/auth/custom.ts

  - [ ] 23.7 Create authentication factory
    - [ ] 23.7.1 Implement createAuthenticator function
      - Accept AuthConfig union type
      - Return appropriate authenticator instance
      - Use discriminated union pattern
      ```typescript
      function createAuthenticator(config: AuthConfig): Authenticator {
        switch (config.type) {
          case 'apiKey': return new ApiKeyAuthenticator(config);
          case 'awsSigV4': return new AwsSigV4Authenticator(config);
          case 'oauth2': return new OAuth2Authenticator(config);
          case 'custom': return new CustomAuthenticator(config);
        }
      }
      ```
    - [ ] 23.7.2 Define Authenticator interface
      - authenticate(request: AuthenticatedRequest): Promise<AuthenticatedRequest>
    - [ ]* 23.7.3 Write unit tests
      - Test factory returns correct authenticator type
      - Test with each auth config type
    - Export from src/auth/factory.ts

  - [ ] 23.8 Update AgentPayClient to use authentication
    - [ ] 23.8.1 Add auth parameter to constructor
      - Accept optional AuthConfig
      - Create authenticator using factory
      - Store authenticator instance
    - [ ] 23.8.2 Apply authentication to all requests
      - Update createTransaction to authenticate requests
      - Update getTransactionStatus to authenticate requests
      - Update any other Agent Pay API calls
    - [ ] 23.8.3 Handle authentication errors
      - Catch authentication failures
      - Throw typed AuthenticationError
      - Include original error details
    - [ ]* 23.8.4 Write integration tests
      - Test createTransaction with API key auth
      - Test createTransaction with AWS SigV4 auth
      - Test createTransaction with OAuth2 auth
      - Test createTransaction with custom auth
      - Test authentication error handling

  - [ ] 23.9 Update AgentPayClientScheme to support authentication
    - [ ] 23.9.1 Add auth parameter to constructor
      - Accept optional AuthConfig
      - Pass to AgentPayClient constructor
    - [ ] 23.9.2 Update createPaymentPayload method
      - Ensure Agent Pay client uses authentication
      - Handle authentication errors gracefully
    - [ ]* 23.9.3 Write integration tests
      - Test payment creation with authenticated Agent Pay client
      - Test with different auth methods

  - [ ] 23.10 Add authentication examples
    - [ ] 23.10.1 Create API key example
      ```typescript
      const client = new AgentPayClientScheme({
        agentPayId: 'my-agent-pay',
        auth: {
          type: 'apiKey',
          apiKey: process.env.AGENT_PAY_API_KEY,
          headerName: 'X-AgentPay-API-Key'
        }
      });
      ```
    - [ ] 23.10.2 Create AWS SigV4 example
      ```typescript
      const client = new AgentPayClientScheme({
        agentPayId: 'aws-agent-pay',
        auth: {
          type: 'awsSigV4',
          credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
          },
          region: 'us-east-1',
          service: 'execute-api'
        }
      });
      ```
    - [ ] 23.10.3 Create OAuth2 example
      ```typescript
      const client = new AgentPayClientScheme({
        agentPayId: 'oauth-agent-pay',
        auth: {
          type: 'oauth2',
          accessToken: 'current-access-token',
          refreshToken: 'refresh-token',
          tokenEndpoint: 'https://pay.example.com/oauth/token',
          onTokenRefresh: (newToken) => {
            // Save new token
            saveToken(newToken);
          }
        }
      });
      ```
    - [ ] 23.10.4 Create custom auth example
      ```typescript
      const client = new AgentPayClientScheme({
        agentPayId: 'custom-agent-pay',
        auth: {
          type: 'custom',
          authenticate: async (request) => {
            // Custom authentication logic
            const signature = await signRequest(request);
            return {
              ...request,
              headers: {
                ...request.headers,
                'X-Custom-Signature': signature
              }
            };
          }
        }
      });
      ```
    - Add to examples/authentication.ts

  - [ ] 23.11 Document authentication security best practices
    - [ ] 23.11.1 Create authentication security guide
      - Never hardcode credentials in source code
      - Use environment variables or secure credential stores
      - Rotate API keys regularly
      - Use IAM roles when running on AWS
      - Implement token refresh for OAuth2
      - Use HTTPS for all Agent Pay communication
      - Validate Agent Pay certificates
      - Handle credential expiration gracefully
    - [ ] 23.11.2 Document credential storage patterns
      - Environment variables
      - AWS Secrets Manager
      - HashiCorp Vault
      - Kubernetes secrets
      - Secure credential providers
    - [ ] 23.11.3 Document error handling
      - Authentication failures (401)
      - Authorization failures (403)
      - Credential expiration
      - Network errors
      - Retry strategies
    - Add to docs/design.md authentication section

  - [ ] 23.12 Add authentication to README
    - [ ] 23.12.1 Add authentication section
      - Overview of supported methods
      - Quick start for each method
      - Link to detailed authentication guide
    - [ ] 23.12.2 Update quick start example
      - Show authentication configuration
      - Use environment variables for credentials

  - [ ] 23.13 Update mock Agent Pay server for testing
    - [ ] 23.13.1 Add authentication middleware
      - Support API key validation
      - Support mock AWS SigV4 validation
      - Support mock OAuth2 validation
      - Return 401 for missing/invalid auth
    - [ ] 23.13.2 Add authentication configuration
      - Allow enabling/disabling auth
      - Configure accepted credentials
      - Support multiple auth methods simultaneously
    - [ ]* 23.13.3 Write tests for mock auth
      - Test API key validation
      - Test AWS SigV4 validation
      - Test OAuth2 validation
      - Test 401 responses

  - [ ] 23.14 Add authentication error types
    - [ ] 23.14.1 Create AuthenticationError class
      - Extend AgentPayError
      - Include auth method type
      - Include original error
      - Include retry information
    - [ ] 23.14.2 Create specific error subclasses
      - InvalidCredentialsError
      - ExpiredCredentialsError
      - MissingCredentialsError
      - AuthenticationTimeoutError
    - Export from src/auth/errors.ts

  - [ ]* 23.15 Write end-to-end authentication tests
    - Test complete payment flow with API key auth
    - Test complete payment flow with AWS SigV4 auth
    - Test complete payment flow with OAuth2 auth
    - Test authentication failure scenarios
    - Test credential refresh scenarios
    - Test with real mock Agent Pay server

## Notes

- All tasks marked with `*` are optional test tasks that can be skipped for faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- Integration tests validate end-to-end flows
- The implementation follows TDD: write tests first, then implement to make them pass


- [x] 24. Express Middleware for Agent Pay Server

  Implement a plug-and-play Express middleware that simplifies Agent Pay server-side integration for service providers.
  _Requirements: APAY-MWR-001 through APAY-MWR-014_

  **Status (2026-04-14):** Initial implementation complete. Core middleware (`agentPayMiddleware`) implemented in `src/middleware/express.ts` with 15 unit tests. Covers route matching, 402 generation, payment verification, auto-capture settlement, lifecycle hooks, and error handling. Remaining subtasks (storage abstraction, logging/observability, advanced examples) are deferred.

  **Files created:**
  - `src/middleware/express.ts` — middleware factory and route matching
  - `src/middleware/index.ts` — barrel export
  - `test/unit/middleware/express.test.ts` — 15 unit tests

  - [ ] 24.1 Design middleware architecture
    - [ ] 24.1.1 Define middleware configuration interface
      - signingKey: CryptoKey (for JWT verification)
      - acceptedProviders: AgentPayConfig[] (list of trusted Agent Pays)
      - quoteTokenTTL?: number (default: 300 seconds)
      - paymentTokenTTL?: number (default: 3600 seconds)
      - onAuthorize?: (req, payment) => Promise<void> (custom authorization logic)
      - onCapture?: (req, payment) => Promise<void> (custom capture logic)
      - errorHandler?: (err, req, res, next) => void (custom error handling)
    - [ ] 24.1.2 Define middleware endpoints
      - POST /fab/authorize - Handle payment authorization requests
      - POST /fab/capture - Handle payment capture requests
      - GET /fab/status/:transactionId - Get payment status
      - GET /fab/.well-known/payment-method-manifest.json - Serve payment method manifest
    - [ ] 24.1.3 Design request/response flow
      - Parse X402 payment requests from request body
      - Extract Agent Pay payment requirements
      - Validate Agent Pay credentials
      - Generate quote tokens
      - Verify payment tokens
      - Execute capture logic
      - Return standardized responses

  - [ ] 24.2 Implement core middleware
    - [ ] 24.2.1 Create fabMiddleware factory function
      ```typescript
      export function fabMiddleware(config: FABMiddlewareConfig): Router {
        const router = express.Router();
        // Configure routes
        return router;
      }
      ```
    - [ ] 24.2.2 Implement authorization endpoint
      - Parse X402PaymentRequest from req.body
      - Validate Agent Pay payment requirements
      - Call onAuthorize hook if provided
      - Generate quote token
      - Return X402PaymentResponse with quote token
    - [ ] 24.2.3 Implement capture endpoint
      - Parse payment token from request
      - Verify payment token with Agent Pay public key
      - Verify quote token
      - Call onCapture hook if provided
      - Return capture confirmation
    - [ ] 24.2.4 Implement status endpoint
      - Parse transaction ID from URL params
      - Look up payment status (requires storage integration)
      - Return payment status response
    - [ ] 24.2.5 Implement manifest endpoint
      - Serve static payment method manifest
      - Include supported payment methods
      - Include Agent Pay discovery information

  - [ ] 24.3 Add request validation
    - [ ] 24.3.1 Validate content-type headers
      - Require application/json for POST requests
      - Return 415 Unsupported Media Type for invalid content types
    - [ ] 24.3.2 Validate request body schemas
      - Use Zod schemas for validation
      - Return 400 Bad Request with validation errors
    - [ ] 24.3.3 Validate authentication headers
      - Check for required authentication (if configured)
      - Return 401 Unauthorized for missing/invalid auth

  - [ ] 24.4 Add error handling
    - [ ] 24.4.1 Create middleware error handler
      - Catch all errors from route handlers
      - Map AgentPayError types to HTTP status codes
      - Return standardized error responses
      - Log errors for debugging
    - [ ] 24.4.2 Handle specific error types
      - ValidationError → 400 Bad Request
      - AuthenticationError → 401 Unauthorized
      - PaymentError → 402 Payment Required
      - NotFoundError → 404 Not Found
      - InternalError → 500 Internal Server Error

  - [ ] 24.5 Add storage abstraction
    - [ ] 24.5.1 Define PaymentStorage interface
      - savePayment(payment: Payment): Promise<void>
      - getPayment(transactionId: string): Promise<Payment | null>
      - updatePaymentStatus(transactionId: string, status: PaymentStatus): Promise<void>
    - [ ] 24.5.2 Implement in-memory storage (for testing)
      - Use Map for simple key-value storage
      - No persistence
    - [ ] 24.5.3 Document storage integration patterns
      - Redis integration example
      - Database integration example
      - Custom storage adapter example

  - [ ] 24.6 Add logging and observability
    - [ ] 24.6.1 Add structured logging
      - Log all incoming requests
      - Log payment authorizations
      - Log payment captures
      - Log errors with stack traces
    - [ ] 24.6.2 Add metrics hooks
      - onRequestStart, onRequestEnd
      - onAuthorizationSuccess, onAuthorizationFailure
      - onCaptureSuccess, onCaptureFailure
      - Allow custom metrics integration

  - [ ] 24.7 Create usage examples
    - [ ] 24.7.1 Basic Express server example
      ```typescript
      import express from 'express';
      import { fabMiddleware } from 'aws-agent-pay-x402-extension';
      
      const app = express();
      app.use(express.json());
      
      app.use('/payments', fabMiddleware({
        signingKey: await loadSigningKey(),
        acceptedProviders: [
          { id: 'aws-agent-pay', publicKey: await loadAgentPayKey() }
        ],
        onAuthorize: async (req, payment) => {
          // Custom authorization logic
          console.log('Authorizing payment:', payment);
        },
        onCapture: async (req, payment) => {
          // Custom capture logic
          console.log('Capturing payment:', payment);
        }
      }));
      
      app.listen(3000);
      ```
    - [ ] 24.7.2 Advanced example with custom storage
      - Show Redis integration
      - Show database integration
      - Show custom error handling
    - [ ] 24.7.3 Example with authentication
      - Show API key authentication
      - Show AWS SigV4 authentication
      - Show OAuth2 authentication

  - [ ] 24.8 Write comprehensive tests
    - [ ]* 24.8.1 Unit tests for middleware factory
      - Test configuration validation
      - Test route registration
      - Test error handler registration
    - [ ]* 24.8.2 Integration tests for endpoints
      - Test POST /fab/authorize flow
      - Test POST /fab/capture flow
      - Test GET /fab/status/:transactionId
      - Test GET /fab/.well-known/payment-method-manifest.json
    - [ ]* 24.8.3 Error handling tests
      - Test validation errors
      - Test authentication errors
      - Test payment errors
      - Test internal errors
    - [ ]* 24.8.4 End-to-end tests
      - Test complete payment flow with Express server
      - Test with real HTTP requests
      - Test error scenarios

  - [ ] 24.9 Document middleware
    - [ ] 24.9.1 Create middleware guide (docs/EXPRESS_MIDDLEWARE.md)
      - Installation instructions
      - Quick start guide
      - Configuration reference
      - API endpoint documentation
      - Storage integration guide
      - Error handling guide
      - Security best practices
    - [ ] 24.9.2 Add to main README
      - Add Express middleware section
      - Link to detailed guide
      - Show quick example

  - _Requirements: Simplify Agent Pay server-side integration, provide production-ready middleware_

- [ ] 25. MCP Server Tool for Agent Pay Client

  Implement a Model Context Protocol (MCP) server that exposes Agent Pay client functionality as tools for AI agents and automation.

  - [ ] 25.1 Design MCP server architecture
    - [ ] 25.1.1 Define MCP tools
      - fab_create_payment: Create a new Agent Pay payment request
      - fab_verify_payment: Verify a payment token
      - fab_capture_payment: Capture an authorized payment
      - fab_get_payment_status: Get payment status
      - fab_discover_Agent Pay: Discover Agent Pay endpoints
    - [ ] 25.1.2 Define tool input schemas
      - Use JSON Schema for tool parameters
      - Validate all inputs
      - Provide clear descriptions and examples
    - [ ] 25.1.3 Define tool output schemas
      - Standardized success responses
      - Standardized error responses
      - Include relevant payment details

  - [ ] 25.2 Implement MCP server
    - [ ] 25.2.1 Set up MCP server framework
      - Use @modelcontextprotocol/sdk
      - Configure server metadata
      - Register tool handlers
    - [ ] 25.2.2 Implement fab_create_payment tool
      - Accept payment parameters (amount, currency, agentPayId, etc.)
      - Create AgentPayClientScheme instance
      - Generate payment request
      - Return payment request and quote token
    - [ ] 25.2.3 Implement fab_verify_payment tool
      - Accept payment token and Agent Pay public key
      - Verify token signature
      - Verify token expiration
      - Return verification result and payment details
    - [ ] 25.2.4 Implement fab_capture_payment tool
      - Accept payment token and quote token
      - Verify both tokens
      - Call Agent Pay capture endpoint
      - Return capture confirmation
    - [ ] 25.2.5 Implement fab_get_payment_status tool
      - Accept transaction ID and Agent Pay URL
      - Query Agent Pay status endpoint
      - Return payment status
    - [ ] 25.2.6 Implement fab_discover_Agent Pay tool
      - Accept Agent Pay identifier or URL
      - Perform Agent Pay discovery
      - Return Agent Pay endpoints and capabilities

  - [ ] 25.3 Add configuration management
    - [ ] 25.3.1 Support environment-based configuration
      - Read Agent Pay configurations from environment variables
      - Read signing keys from secure storage
      - Support multiple Agent Pay profiles
    - [ ] 25.3.2 Support configuration file
      - JSON or YAML configuration file
      - Define Agent Pay profiles
      - Define default settings
    - [ ] 25.3.3 Support runtime configuration
      - Allow tools to accept configuration overrides
      - Validate configuration at runtime

  - [ ] 25.4 Add authentication support
    - [ ] 25.4.1 Support Agent Pay authentication in tools
      - Accept auth config in tool parameters
      - Use authentication system from Task 23
      - Support all auth methods (API key, AWS SigV4, OAuth2, custom)
    - [ ] 25.4.2 Secure credential handling
      - Never log credentials
      - Use secure credential providers
      - Support credential rotation

  - [ ] 25.5 Add error handling and logging
    - [ ] 25.5.1 Implement comprehensive error handling
      - Catch all errors from Agent Pay operations
      - Return structured error responses
      - Include error codes and messages
    - [ ] 25.5.2 Add structured logging
      - Log all tool invocations
      - Log payment operations
      - Log errors with context
      - Support log level configuration

  - [ ] 25.6 Create usage examples
    - [ ] 25.6.1 Basic MCP server setup
      ```typescript
      import { MCPServer } from '@modelcontextprotocol/sdk';
      import { createFABMCPServer } from 'aws-agent-pay-x402-extension/mcp';
      
      const server = createFABMCPServer({
        Agent Pays: [
          {
            id: 'aws-agent-pay',
            url: 'https://pay.aws.example.com',
            publicKey: await loadAgentPayKey()
          }
        ],
        signingKey: await loadSigningKey()
      });
      
      server.listen();
      ```
    - [ ] 25.6.2 Example tool invocations
      - Show fab_create_payment example
      - Show fab_verify_payment example
      - Show fab_capture_payment example
      - Show complete payment flow
    - [ ] 25.6.3 Integration with AI agents
      - Show Claude Desktop integration
      - Show custom agent integration
      - Show automation workflow examples

  - [ ] 25.7 Write comprehensive tests
    - [ ]* 25.7.1 Unit tests for tool handlers
      - Test each tool in isolation
      - Test input validation
      - Test error handling
    - [ ]* 25.7.2 Integration tests with MCP protocol
      - Test tool registration
      - Test tool invocation via MCP
      - Test error responses
    - [ ]* 25.7.3 End-to-end tests
      - Test complete payment flow via MCP tools
      - Test with mock Agent Pay server
      - Test error scenarios

  - [ ] 25.8 Document MCP server
    - [ ] 25.8.1 Create MCP server guide (docs/MCP_SERVER.md)
      - Installation instructions
      - Quick start guide
      - Tool reference documentation
      - Configuration guide
      - Authentication guide
      - Integration examples
      - Security best practices
    - [ ] 25.8.2 Add to main README
      - Add MCP server section
      - Link to detailed guide
      - Show quick example
    - [ ] 25.8.3 Create Claude Desktop integration guide
      - Show how to configure Claude Desktop
      - Show example conversations
      - Show automation examples

  - _Requirements: Enable AI agents and automation to use Agent Pay payments, provide MCP-compliant interface_

- [ ] 26. Facilitator Extensibility Analysis

  Explore and justify the facilitator as a translation layer between X402 and Agent Pay from an extensibility and scalability perspective.

  - [ ] 26.1 Document current facilitator architecture
    - [ ] 26.1.1 Analyze AgentPayFacilitatorClient implementation
      - Review current responsibilities
      - Identify coupling points with X402
      - Identify coupling points with Agent Pay
      - Document data flow
    - [ ] 26.1.2 Document facilitator interface
      - FacilitatorClient interface from @x402/core/http
      - Methods: authorize, capture, getStatus
      - Input/output types
      - Error handling
    - [ ] 26.1.3 Identify translation responsibilities
      - X402 PaymentRequest → Agent Pay authorization request
      - Agent Pay authorization response → X402 PaymentResponse
      - X402 capture request → Agent Pay capture request
      - Agent Pay capture response → X402 capture response
      - Error mapping between X402 and Agent Pay

  - [ ] 26.2 Analyze extensibility requirements
    - [ ] 26.2.1 Identify extension points
      - Supporting new Agent Pay types (beyond AWS Agent Pay)
      - Supporting new payment methods (beyond FAB)
      - Supporting new authentication methods
      - Supporting new settlement methods
      - Supporting custom payment flows
    - [ ] 26.2.2 Analyze current extensibility limitations
      - Hard-coded Agent Pay API assumptions
      - Limited error mapping
      - Fixed data transformation logic
      - Lack of plugin architecture
    - [ ] 26.2.3 Define extensibility goals
      - Support multiple Agent Pay implementations without code changes
      - Support custom payment flows via configuration
      - Support Agent Pay-specific features
      - Support versioning and backward compatibility

  - [ ] 26.3 Analyze scalability requirements
    - [ ] 26.3.1 Identify scalability concerns
      - Request volume handling
      - Concurrent payment processing
      - Agent Pay API rate limiting
      - Token caching and validation
      - State management
    - [ ] 26.3.2 Analyze current scalability limitations
      - Synchronous request processing
      - No request batching
      - No caching layer
      - No retry logic
      - No circuit breaker pattern
    - [ ] 26.3.3 Define scalability goals
      - Support high request volumes
      - Minimize Agent Pay API calls
      - Handle Agent Pay API failures gracefully
      - Support horizontal scaling
      - Support distributed deployments

  - [ ] 26.4 Propose facilitator architecture improvements
    - [ ] 26.4.1 Design plugin architecture
      - Define Agent PayAdapter interface
        - authorize(request): Promise<response>
        - capture(request): Promise<response>
        - getStatus(transactionId): Promise<status>
        - supportsFeature(feature): boolean
      - Implement adapter registry
      - Support runtime adapter registration
      - Support adapter versioning
    - [ ] 26.4.2 Design middleware pipeline
      - Pre-processing middleware (validation, logging)
      - Translation middleware (X402 ↔ Agent Pay)
      - Post-processing middleware (error mapping, response formatting)
      - Support custom middleware injection
    - [ ] 26.4.3 Design caching layer
      - Cache Agent Pay public keys
      - Cache Agent Pay discovery results
      - Cache token validation results
      - Support cache invalidation
      - Support distributed caching (Redis)
    - [ ] 26.4.4 Design retry and circuit breaker
      - Implement exponential backoff retry
      - Implement circuit breaker for Agent Pay APIs
      - Support configurable retry policies
      - Support fallback strategies

  - [ ] 26.5 Create proof-of-concept implementations
    - [ ] 26.5.1 Implement Agent PayAdapter interface
      - Create base adapter class
      - Implement AWS Agent Pay adapter
      - Implement mock Agent Pay adapter for testing
    - [ ] 26.5.2 Implement adapter registry
      - Register adapters by Agent Pay type
      - Select adapter based on Agent Pay identifier
      - Support adapter fallback
    - [ ] 26.5.3 Implement middleware pipeline
      - Create middleware interface
      - Implement validation middleware
      - Implement logging middleware
      - Implement error mapping middleware
    - [ ] 26.5.4 Implement caching layer
      - Create cache interface
      - Implement in-memory cache
      - Implement Redis cache adapter
      - Add cache to facilitator

  - [ ] 26.6 Benchmark and validate improvements
    - [ ] 26.6.1 Create performance benchmarks
      - Measure request latency
      - Measure throughput
      - Measure cache hit rates
      - Compare with current implementation
    - [ ] 26.6.2 Create extensibility tests
      - Test adding new Agent Pay adapter
      - Test adding custom middleware
      - Test adapter versioning
      - Test backward compatibility
    - [ ] 26.6.3 Create scalability tests
      - Test with high request volumes
      - Test with concurrent requests
      - Test with Agent Pay API failures
      - Test horizontal scaling

  - [ ] 26.7 Document findings and recommendations
    - [ ] 26.7.1 Write extensibility analysis (docs/FACILITATOR_EXTENSIBILITY.md)
      - Current architecture overview
      - Extensibility limitations
      - Proposed improvements
      - Plugin architecture design
      - Middleware pipeline design
      - Migration path
    - [ ] 26.7.2 Write scalability analysis (docs/FACILITATOR_SCALABILITY.md)
      - Current architecture overview
      - Scalability limitations
      - Proposed improvements
      - Caching strategy
      - Retry and circuit breaker design
      - Performance benchmarks
      - Deployment recommendations
    - [ ] 26.7.3 Write implementation guide (docs/FACILITATOR_IMPLEMENTATION.md)
      - Step-by-step implementation plan
      - Code examples
      - Testing strategy
      - Migration guide
      - Best practices
    - [ ] 26.7.4 Create decision document
      - Justify facilitator as translation layer
      - Compare with alternative architectures
      - Analyze trade-offs
      - Provide recommendations
      - Include cost-benefit analysis

  - [ ] 26.8 Update main documentation
    - [ ] 26.8.1 Add facilitator architecture section to README
      - Overview of facilitator role
      - Link to detailed analysis
      - Show architecture diagram
    - [ ] 26.8.2 Update SDK explanation
      - Explain facilitator extensibility
      - Show adapter examples
      - Show middleware examples

  - _Requirements: Justify facilitator architecture, ensure extensibility for multiple Agent Pays, ensure scalability for production use_

- [x] 27. OIDC Discovery and Quote Token Signature Verification

  Implement service public key fetching via OIDC discovery so that the facilitator can verify quote token signatures end-to-end. This closes the gap where the in-process facilitator trusts quote tokens without verifying the service's signature.

  **Status (implemented):** Quote token signature verification is now MANDATORY in the in-process facilitator. The verify logic fetches the service's JWKS from `{quote.iss}/.well-known/jwks.json`, verifies the signature (with `clockTolerance: Infinity` to separate signature from expiry checks), then explicitly checks `exp`. Returns `invalid_quote` on signature failure, `quote_expired` on expiry. Optional `serviceJWKSUrl` override supported. 7 unit tests in `test/unit/fab/quote-verification.test.ts`.

  _Spec references: APAY-DSC-009, APAY-DSC-011, APAY-STUB-001, APAY-FAC-002, APAY-FAC-003a, APAY-FAC-003b, APAY-FCL-007_

  **Context:**
  - `fetchServicePublicKey()` in `src/utils.ts` is deprecated — replaced by `fetchServiceJWKS()` which is fully implemented with 1-hour TTL caching and `clearServiceJWKSCache()` for invalidation.
  - The in-process facilitator (`src/fab/facilitator/verify.ts`) already calls `fetchServiceJWKS` and `jose.jwtVerify` on the quote token, but wraps it in a try/catch that silently swallows failures. This makes quote signature verification best-effort rather than mandatory.
  - The `AgentPayFacilitatorClient` (`src/agent-pay-facilitator-client.ts`) independently fetches service JWKS and verifies the quote token signature — that path is complete.
  - `test/unit/service-jwks.test.ts` has 7 tests covering `fetchServiceJWKS` and `clearServiceJWKSCache`.
  - `test/unit/fab/quote-verification.test.ts` exists as a placeholder with a single `.todo` test.

  **What's done (subtasks 27.1, 27.3):**
  - `fetchServiceJWKS()` is implemented with caching and cache clearing (subtask 27.1 ✅)
  - Decision documented: quote verification stays in facilitator verify logic, not in `AgentPayClientForFacilitator` (subtask 27.3 ✅)

  **What remains:**

  - [ ] 27.2 Make quote token signature verification mandatory in the in-process facilitator
    - In `src/fab/facilitator/verify.ts`, replace the silent try/catch around `fetchServiceJWKS` + `jose.jwtVerify` with proper error handling:
      - If `quotePayload.iss` is missing, return `{ isValid: false, invalidReason: 'invalid_quote', invalidMessage: 'Quote token missing issuer (iss) claim' }`
      - If JWKS fetch fails (network error, non-200), return `{ isValid: false, invalidReason: 'invalid_quote', invalidMessage: 'Failed to fetch service JWKS from {url}: {error}' }`
      - If `jose.jwtVerify` fails (bad signature, wrong key), return `{ isValid: false, invalidReason: 'invalid_quote', invalidMessage: 'Quote token signature verification failed' }`
    - After signature verification, check `exp` against current time:
      - If expired, return `{ isValid: false, invalidReason: 'quote_expired', invalidMessage: 'Quote token expired' }`
    - _Spec: APAY-FAC-003a, APAY-FAC-003b_

  - [ ] 27.4 Add optional `serviceJWKSUrl` override to `AgentPayFacilitatorSchemeConfig`
    - Allow callers to provide a custom JWKS URL for the service (useful when the service URL in the quote token doesn't match the JWKS endpoint, e.g., behind a proxy)
    - Default behavior: derive from `quote.iss` + `/.well-known/jwks.json`
    - _Spec: may need new requirement APAY-FAC-013_

  - [ ] 27.5 Write unit tests for quote token verification in facilitator
    - Populate `test/unit/fab/quote-verification.test.ts` with:
      - Test: verification succeeds when quote token is signed by service and service JWKS is reachable
      - Test: verification fails with `invalid_quote` when quote token signature doesn't match service's key
      - Test: verification fails with `invalid_quote` when service JWKS endpoint returns non-200
      - Test: verification fails with `invalid_quote` when quote token `iss` is missing
      - Test: verification fails with `quote_expired` when quote token `exp` is in the past
      - Test: verification succeeds when quote token `exp` is in the future
    - Target: 6 tests
    - _Validates: APAY-FAC-003a, APAY-FAC-003b_

  - [ ] 27.6 Update integration test
    - Update `test/integrations/fab-test.test.ts` to set up a service JWKS endpoint (the mock Agent Pay server already serves `/.well-known/jwks.json` for Agent Pay; the test service needs to serve its own JWKS)
    - Verify the full flow now includes quote token signature verification
    - Target: 1-2 additional assertions in existing test(s)

  - [ ] 27.7 Update spec.md
    - Update APAY-STUB-001 to note that `fetchServicePublicKey` is deprecated and replaced by `fetchServiceJWKS`
    - Update §6.6 (OIDC Discovery Stub rationale) to reflect that `fetchServiceJWKS` is implemented and the in-process facilitator now verifies quote signatures
    - Add `clearServiceJWKSCache` to the utility functions section if not already present

  - [ ] 27.8 Update docs and known limitations
    - Remove "OIDC discovery for service public keys is stubbed" from known limitations in README.md and sdk-guide.md
    - Update sdk-guide.md §3.5 verification step 4 to remove "(best-effort)" — it is now mandatory
    - No user-facing API changes (verification happens automatically)

  - [ ] 27.9 Update traceability matrix
    - Add APAY-FAC-003a → `src/fab/facilitator/verify.ts` → `test/unit/fab/quote-verification.test.ts`
    - Add APAY-FAC-003b → `src/fab/facilitator/verify.ts` → `test/unit/fab/quote-verification.test.ts`

  **Files modified:**
  - `src/fab/facilitator/verify.ts` (make quote verification mandatory)
  - `test/unit/fab/quote-verification.test.ts` (add 6 tests)
  - `test/integrations/fab-test.test.ts` (add assertions)
  - `docs/spec.md` (update APAY-STUB-001, §6.6)
  - `docs/sdk-guide.md` (update verification description)
  - `docs/tasks.md` (traceability matrix)
  - `README.md` (remove known limitation)

  **Estimated test count:** 6 new unit tests + 1-2 integration assertions
  **Dependencies:** None (fetchServiceJWKS is already implemented)
  **Risk:** Low-medium — making quote verification mandatory could break integration tests that don't serve a service JWKS endpoint. The mock Agent Pay server in examples already serves JWKS, but the test harness may need a mock service JWKS endpoint added.

  **Estimated test count:** 13-18 new tests
  **Files modified:** `src/utils.ts`, `src/fab/facilitator/verify.ts`, `src/config.ts` (optional), `test/unit/utils.test.ts`, `test/unit/fab/facilitator.test.ts`, `test/integrations/fab-test.test.ts`, `docs/spec.md`, `README.md`
  **Dependencies:** None (self-contained)


- [x] 28. Sentinel Values for x402 Core Protocol Fields (`payTo`, `maxTimeoutSeconds`)

  Replace the redundant `payTo` and `maxTimeoutSeconds` fields in the x402 `PaymentRequirements` with well-defined sentinel values. In Agent Pay, the signed quote token is the authoritative source for payment details (recipient, pricing, expiry). The outer `PaymentRequirements` fields `payTo` and `maxTimeoutSeconds` are required by the `@x402/core` type contract but are semantically redundant for Agent Pay — Agent Pay and facilitator already use the quote token. This task makes that explicit by using sentinel values and documenting the convention.

  **Status (implemented):** `AGENT_PAY_SENTINEL_PAY_TO` constant defined in `src/constants.ts`. `enhancePaymentRequirements` in `src/fab/server/scheme.ts` sets `payTo` to the sentinel and `maxTimeoutSeconds` to `exp - iat`. Spec updated with APAY-CON-007, APAY-SRV-016, APAY-SRV-017.

  **Motivation:**
  - `payTo` in `PaymentRequirements` duplicates `payTo` inside the signed quote token. The quote token is the source of truth because it's signed by the service; the outer field is unsigned and could be tampered with.
  - `maxTimeoutSeconds` has no direct Agent Pay equivalent — Agent Pay uses `exp - iat` in the quote token to express validity. The outer field is a leftover from the EVM/SVM `exact` scheme where it controls `validBefore` in on-chain authorization.
  - Clients and facilitators in Agent Pay already ignore these outer fields in favor of the quote token. Making them sentinels formalizes what's already true.

  **Design decisions:**
  - `payTo` sentinel: `"urn:x402:agent-pay:see-quote"` — a URN that is clearly not a real address, signals "look at the quote token", and won't collide with any Agent Pay ID or blockchain address.
  - `maxTimeoutSeconds` sentinel: derived from the quote token's `exp - iat` (i.e., the quote validity window). This keeps the field numerically meaningful for any x402 middleware that might inspect it, while still being derived from the quote rather than independently configured.
  - Both sentinels are set in `enhancePaymentRequirements` (server scheme), which is the last touch before the 402 response is sent. The base requirements from `x402ResourceServer.buildPaymentRequirements` still set `payTo` from `resourceConfig.payTo` and `maxTimeoutSeconds` from config, but the Agent Pay server scheme overrides them.

  **Scope:**

  - [ ] 28.1 Add sentinel constants to `src/constants.ts`
    - Add `AGENT_PAY_SENTINEL_PAY_TO = 'urn:x402:agent-pay:see-quote'`
    - Add JSDoc explaining the sentinel convention and why it exists
    - _New requirement: APAY-CON-007_

  - [ ] 28.2 Update `enhancePaymentRequirements` in `src/fab/server/scheme.ts`
    - After building the quote token and signing it, override the returned `PaymentRequirements`:
      - Set `payTo` to `AGENT_PAY_SENTINEL_PAY_TO`
      - Set `maxTimeoutSeconds` to `quotePayload.exp - quotePayload.iat` (the quote validity window, currently 300s by default)
    - The quote token itself still contains the real `payTo` from the original `paymentRequirements.payTo` — that doesn't change
    - _Updates: APAY-SRV-012 (enhance return value now also normalizes payTo and maxTimeoutSeconds)_
    - _New requirements: APAY-SRV-016, APAY-SRV-017_

  - [ ] 28.3 Update client scheme `createPaymentPayload` in `src/fab/client/scheme.ts`
    - Currently the client reads `payTo` from `quote.iss` (the service URL from the quote token), not from `paymentRequirements.payTo`. Verify this is still correct — it should be, since the client already ignores the outer `payTo`.
    - Add a defensive comment explaining that `paymentRequirements.payTo` is a sentinel in Agent Pay and the real recipient comes from the quote token.
    - No functional change expected; this subtask is verification + documentation.
    - _Validates: APAY-CLI-003 (client uses quote token, not outer fields)_

  - [ ] 28.4 Update facilitator verify logic in `src/fab/facilitator/verify.ts`
    - Currently the facilitator does not use `requirements.payTo` or `requirements.maxTimeoutSeconds` — it verifies the payment token and quote token directly. Verify this is still correct.
    - Add a defensive comment explaining the sentinel convention.
    - No functional change expected; this subtask is verification + documentation.
    - _Validates: APAY-FAC-001 through APAY-FAC-006 (facilitator uses tokens, not outer fields)_

  - [ ] 28.5 Update facilitator settle logic in `src/fab/facilitator/settle.ts`
    - Currently uses `requirements.amount` and `requirements.asset` (which are NOT sentinels — they remain real values). Verify `payTo` and `maxTimeoutSeconds` are not used in settle. They aren't.
    - Add a defensive comment.
    - No functional change expected.

  - [ ] 28.6 Export sentinel constant from `src/index.ts`
    - Add `AGENT_PAY_SENTINEL_PAY_TO` to the constants export block.

  - [ ] 28.7 Update `src/networks/aws.ts`
    - No changes needed — the AWS pre-configured schemes delegate to the base schemes, which will pick up the sentinel behavior from `enhancePaymentRequirements`. Verify and document.

  - [ ] 28.8 Write unit tests in `test/unit/fab/server.test.ts`
    - Test: `enhancePaymentRequirements` sets `payTo` to `AGENT_PAY_SENTINEL_PAY_TO`
    - Test: `enhancePaymentRequirements` sets `maxTimeoutSeconds` to `DEFAULT_QUOTE_VALIDITY_SECONDS` (300)
    - Test: the quote token inside `extra.quoteToken` still contains the original real `payTo` value (not the sentinel)
    - Test: when a custom quote validity is used (if/when supported), `maxTimeoutSeconds` matches `exp - iat`
    - Target: 4 new tests

  - [ ] 28.9 Write unit tests in `test/unit/fab/client.test.ts`
    - Test: `createPaymentPayload` works correctly when `paymentRequirements.payTo` is the sentinel value `'urn:x402:agent-pay:see-quote'` — it should still extract `payTo` from the quote token's `iss` field
    - Test: `createPaymentPayload` does not pass the sentinel value to `agentPayClient.authorize()` — it passes `quote.iss` instead
    - Target: 2 new tests

  - [ ] 28.10 Write unit tests in `test/unit/fab/facilitator.test.ts`
    - Test: `verifyPayment` succeeds when `requirements.payTo` is the sentinel value (proving the facilitator doesn't depend on it)
    - Test: `settlePayment` succeeds when `requirements.payTo` is the sentinel value
    - Target: 2 new tests

  - [ ] 28.11 Update integration test in `test/integrations/fab-test.test.ts`
    - Update the existing end-to-end flow test to assert that the `PaymentRequirements` returned by the server scheme contains the sentinel `payTo` and a numeric `maxTimeoutSeconds` matching the quote validity
    - Target: 2 new assertions in existing test(s)

  - [ ] 28.12 Update `docs/spec.md`
    - Add APAY-CON-007: `The system shall define a sentinel constant AGENT_PAY_SENTINEL_PAY_TO with value "urn:x402:agent-pay:see-quote" to indicate that the payTo field in PaymentRequirements is not authoritative and the quote token shall be consulted instead.`
    - Add APAY-SRV-016: `When enhancePaymentRequirements completes, the server scheme shall set the PaymentRequirements payTo field to AGENT_PAY_SENTINEL_PAY_TO.`
    - Add APAY-SRV-017: `When enhancePaymentRequirements completes, the server scheme shall set the PaymentRequirements maxTimeoutSeconds field to the quote token's validity window (exp minus iat).`
    - Update APAY-SRV-012 rationale to note that the returned requirements now also normalize payTo and maxTimeoutSeconds.
    - Add a rationale note in §2.3 (Architectural Constraints) or a new §2.4 explaining the sentinel convention and why Agent Pay treats the quote token as authoritative over the outer PaymentRequirements fields.

  - [ ] 28.13 Update `docs/tasks.md` traceability matrix
    - Add APAY-CON-007 → `src/constants.ts` → `test/unit/constants.test.ts`
    - Add APAY-SRV-016 → `src/fab/server/scheme.ts` → `test/unit/fab/server.test.ts`
    - Add APAY-SRV-017 → `src/fab/server/scheme.ts` → `test/unit/fab/server.test.ts`

  **Estimated test count:** 8 new unit tests + 2 new integration assertions
  **Files modified:** `src/constants.ts`, `src/fab/server/scheme.ts`, `src/fab/client/scheme.ts` (comments only), `src/fab/facilitator/verify.ts` (comments only), `src/fab/facilitator/settle.ts` (comments only), `src/index.ts`, `docs/spec.md`, `docs/tasks.md`
  **Files created:** none
  **Test files modified:** `test/unit/fab/server.test.ts`, `test/unit/fab/client.test.ts`, `test/unit/fab/facilitator.test.ts`, `test/integrations/fab-test.test.ts`
  **Dependencies:** None (self-contained, no core type changes)
  **Risk:** Low — sentinel values are backward-compatible. Any x402 middleware that inspects `payTo` will see a clearly non-real value. Any middleware that inspects `maxTimeoutSeconds` will see a valid number (300). No breaking changes to the `@x402/core` contract.

---

## Spec Requirements — Implementation Status

_Moved from `spec.md`. Tracks implementation state against the formal EARS requirements in that document._

### Implemented (Verified)

| Area | Status | Test Coverage |
|------|--------|---------------|
| Scheme Registration (APAY-REG-*) | ✅ Complete | Unit + Integration |
| Type System (APAY-TYP-*) | ✅ Complete | Unit |
| Error Handling (APAY-ERR-*) | ✅ Complete | Unit |
| Server Scheme (APAY-SRV-*) | ✅ Complete | Unit + Integration |
| Client Scheme (APAY-CLI-*) | ✅ Complete | Unit + Integration |
| Facilitator Scheme (APAY-FAC-*) | ✅ Complete | Unit + Integration |
| Signer Interfaces (APAY-SGN-*) | ✅ Complete | Unit |
| Utility Functions (APAY-UTL-*) | ✅ Complete | Unit |
| Constants (APAY-CON-*) | ✅ Complete | Unit |
| Authentication (APAY-AUTH-*) | ✅ Complete | 28 tests |
| DPoP (APAY-DPOP-*) | ✅ Complete | 33 tests |
| Agent Pay Client (APAY-WCL-*) | ✅ Complete | Unit |
| InProcess Facilitator (APAY-FCL-001) | ✅ Complete | Integration |
| AgentPayFacilitatorClient (APAY-FCL-002–010) | ✅ Complete | Unit + Integration |
| Builders / Network Routing (APAY-BLD-*) | ✅ Complete | Unit + Integration |
| Sentinel Values (APAY-CON-007, APAY-SRV-016–017) | ✅ Complete | Unit |
| Express Middleware (APAY-MWR-001–014) | ✅ Core Complete | 15 tests |

Total: 306 tests passing, 1 skipped, 1 todo. Build verified (ESM + CJS + Types).

### Partially Implemented (Known Limitations)

| ID | Area | Limitation |
|----|------|------------|
| APAY-AUTH-005 | AWS SigV4 | Real implementation using `@smithy/signature-v4`. |
| APAY-FAC-003a | Quote Token Verification (In-Process) | The in-process facilitator (`src/fab/facilitator/verify.ts`) wraps quote token signature verification in a try/catch that silently swallows failures, making it best-effort. The `AgentPayFacilitatorClient` verifies fully. Task 27 tracks making this mandatory. |
| APAY-FAC-007 | Settlement (In-Process) | The in-process facilitator returns a success placeholder; actual fund capture requires Agent Pay backend integration. The `AgentPayFacilitatorClient` calls `POST /capture` correctly. |

### Not Yet Implemented

| Area | Description |
|------|-------------|
| OIDC Discovery / Quote Verification (Task 27) | `fetchServiceJWKS` implemented with caching. Remaining: make quote signature verification mandatory in in-process facilitator (currently best-effort), add unit tests, update integration tests. |
| Zod Validation Schemas | Comprehensive runtime validation schemas (types exist, Zod schemas not fully wired). |
| Express Middleware (Task 24) | Core middleware implemented (`agentPayMiddleware`). Storage abstraction, logging/observability, and advanced examples deferred. |
| MCP Server Tool (Task 25) | Model Context Protocol server exposing Agent Pay tools for AI agents. |
| Facilitator Extensibility (Task 26) | Analysis and abstraction for multi-Agent Pay-provider extensibility. |
| Property-Based Tests | `fast-check` property tests for correctness properties APAY-PROP-001 through APAY-PROP-014. |
| CI/CD Pipeline | Automated testing, coverage enforcement, and npm publishing. |
| Performance Benchmarks | Formal measurement against APAY-PRF-001 through APAY-PRF-004. |

---

## Traceability Matrix

| Requirement | Source File(s) | Test File(s) |
|-------------|----------------|--------------|
| APAY-REG-001–004 | `src/fab/*/scheme.ts`, `src/constants.ts` | `test/unit/constants.test.ts`, `test/unit/fab/*.test.ts` |
| APAY-TYP-001–007 | `src/types.ts` | `test/unit/types.test.ts` |
| APAY-ERR-001–006 | `src/types.ts` (error classes) | `test/unit/errors.test.ts` |
| APAY-SRV-001–015 | `src/fab/server/scheme.ts`, `src/signer.ts` | `test/unit/fab/server.test.ts` |
| APAY-SRV-016–017 | `src/fab/server/scheme.ts` | `test/unit/fab/server.test.ts` |
| APAY-CLI-001–008 | `src/fab/client/scheme.ts`, `src/config.ts` | `test/unit/fab/client.test.ts` |
| APAY-FAC-001–012 | `src/fab/facilitator/scheme.ts`, `verify.ts`, `settle.ts` | `test/unit/fab/facilitator.test.ts` |
| APAY-SGN-001–004 | `src/signer.ts` | `test/unit/signer.test.ts` |
| APAY-UTL-001–015 | `src/utils.ts` | `test/unit/utils.test.ts` |
| APAY-CON-001–006 | `src/constants.ts` | `test/unit/constants.test.ts` |
| APAY-CON-007 | `src/constants.ts` | `test/unit/fab/server.test.ts` |
| APAY-AUTH-001–008 | `src/auth/*.ts` | `test/unit/auth/*.test.ts` |
| APAY-DPOP-001–017 | `src/dpop/*.ts` | `test/unit/dpop/*.test.ts` |
| APAY-WCL-001–010 | `src/agent-pay-client.ts`, `src/config.ts` | `test/unit/facilitator-client.test.ts` |
| APAY-FCL-001–010 | `src/facilitator-client.ts`, `src/agent-pay-facilitator-client.ts` | `test/integrations/fab-test.test.ts` |
| APAY-DSC-001–014 | `src/discovery.ts` | `test/unit/discovery.test.ts` |
| APAY-NET-001–005 | `src/networks/*.ts` | `test/unit/networks/*.test.ts` |
| APAY-WCOMPAT-001–007 | (external interface) | `test/integrations/fab-test.test.ts` |
| APAY-STUB-001 | `src/utils.ts` | — |
| APAY-PROP-001–015 | (cross-cutting) | planned: `fast-check` property tests |
| APAY-BLD-001–003, 005 | `src/builders/resource-server-builder.ts` | `test/unit/builders/resource-server-builder.test.ts`, `test/integrations/multi-facilitator.test.ts` |
| APAY-BLD-002 | `src/builders/client-builder.ts` | `test/unit/builders/client-builder.test.ts` |
| APAY-BLD-004 | `src/agent-pay-facilitator-client.ts` | `test/unit/builders/agent-pay-facilitator-network-filter.test.ts` |
| APAY-BLD-006 | `src/builders/register.ts` | `test/integrations/multi-facilitator.test.ts` |
| APAY-MWR-001–014 | `src/middleware/express.ts` | `test/unit/middleware/express.test.ts` |

---

## Requirement Count Summary

| Category | Count |
|----------|-------|
| Scheme Registration (APAY-REG) | 4 |
| Type System (APAY-TYP) | 7 |
| Error Handling (APAY-ERR) | 6 |
| Server Scheme (APAY-SRV) | 17 |
| Client Scheme (APAY-CLI) | 8 |
| Facilitator Scheme (APAY-FAC) | 14 |
| Signer Interfaces (APAY-SGN) | 4 |
| Utility Functions (APAY-UTL) | 15 |
| Constants (APAY-CON) | 7 |
| Authentication (APAY-AUTH) | 8 |
| DPoP (APAY-DPOP) | 17 |
| Agent Pay Client (APAY-WCL) | 10 |
| Facilitator Client (APAY-FCL) | 10 |
| Agent Pay Discovery (APAY-DSC) | 14 |
| Pre-configured Networks (APAY-NET) | 5 |
| Agent Pay Provider Contract (APAY-WCOMPAT) | 7 |
| Exported Stubs (APAY-STUB) | 1 |
| Performance (APAY-PRF) | 4 |
| Security (APAY-SEC) | 6 |
| Compatibility (APAY-CMP) | 5 |
| Testability (APAY-TST) | 5 |
| Correctness Properties (APAY-PROP) | 15 |
| Builders (APAY-BLD) | 6 |
| Express Middleware (APAY-MWR) | 14 |
| **Total** | **209** |

- [x] 29. Refactor Registration: Network-Aware Facilitator Routing with Default Fallback

  Refactor the registration model so that the Agent Pay facilitator only handles explicitly registered networks, while all other networks fall back to the official x402 facilitator (`https://x402.org/facilitator`). Today, both the buyer (client) and seller (server) sides require manual, per-network registration of Agent Pay schemes. This task introduces a single "register these networks for Agent Pay" entry point that wires up client, server, and facilitator schemes for the specified networks, and lets everything else pass through to the default `HTTPFacilitatorClient`.

  **Status (implemented):** `createAgentPayResourceServer` and `createAgentPayClient` builders implemented in `src/builders/resource-server-builder.ts` and `src/builders/client-builder.ts`. Two-phase API (`registerNetwork` → `initialize`) with network filter on `AgentPayFacilitatorClient`, default `HTTPFacilitatorClient` fallback, idempotent registration, and method chaining. Legacy `buildAgentPayResourceServer` / `buildAgentPayClient` convenience functions delegate to the two-phase API.

  **Motivation:**
  - Currently, every network that Agent Pay should handle must be individually registered on the client (`x402Client.register`), the server (`x402ResourceServer.register`), and the facilitator (`x402Facilitator.register`). This is repetitive and error-prone.
  - There is no built-in fallback: if a service accepts both `aws:base` (FAB) and `eip155:8453` (EVM on-chain), the integrator must either register Agent Pay schemes for both or manually set up two facilitator clients. If they forget to register a network, it silently fails.
  - The desired experience: "I want Agent Pay to handle `aws:base` and `eip155:8453`. Everything else (e.g., `solana:mainnet`) should fall back to the official x402 facilitator automatically."

  **Design:**

  The core idea is a two-phase API: create a server/client, then register networks individually via `registerNetwork()`. This separates construction from configuration and makes it easy to extend later (e.g., register different networks with different options).

  **Server side:**
  1. `createAgentPayResourceServer(config)` returns a `FABResourceServer` object with a `registerNetwork(network, options?)` method.
  2. Networks are added one at a time (or chained): `server.registerNetwork('aws:base').registerNetwork('eip155:8453')`.
  3. `server.initialize()` fetches supported kinds from facilitators and returns the underlying `x402ResourceServer`.
  4. The Agent Pay facilitator (Agent Pay-based) is registered for the specified networks. The default `HTTPFacilitatorClient` acts as catch-all for any network not claimed by FAB.

  **Client side:**
  1. `createAgentPayClient(config)` returns a `FABClient` object with a `registerNetwork(network)` method.
  2. Networks are added one at a time (or chained).
  3. The underlying `x402Client` is available via `.client` and `createPaymentPayload` is delegated.

  **Convenience builders** (`buildAgentPayResourceServer`, `buildAgentPayClient`) are kept for backward compatibility — they delegate to the two-phase API internally.

  **Scope:**

  - [ ] 29.1 Create `FABResourceServerBuilder` in `src/builders/resource-server-builder.ts`
    - [ ] 29.1.1 Define `FABResourceServerConfig` interface
      ```typescript
      interface FABResourceServerConfig {
        /** Networks that Agent Pay should handle (e.g., ['aws:base', 'eip155:8453']) */
        fabNetworks: Network[];
        /** Agent Pay base URL for the Agent Pay facilitator */
        agentPayBaseUrl: string;
        /** Agent Pay ID for the Agent Pay facilitator */
        agentPayId: string;
        /** Service signing keys for quote tokens */
        signingKeys: SigningKeysConfig;
        /** Service URL (used as issuer in quote tokens) */
        serviceUrl: string;
        /** Optional: Agent Pay auth config for facilitator API calls */
        agentPayAuth?: AgentPayFacilitatorAuthConfig;
        /** Optional: Agent Pay auth config for Agent Pay client (used by facilitator scheme) */
        agentPayClientAuth?: AuthConfig;
        /** Optional: custom default facilitator URL (defaults to https://x402.org/facilitator) */
        defaultFacilitatorUrl?: string;
        /** Optional: disable default facilitator fallback entirely */
        disableDefaultFallback?: boolean;
      }
      ```
    - [ ] 29.1.2 Implement `buildAgentPayResourceServer(config)` factory function
      - Create a `AgentPayFacilitatorClient` (or `InProcessFacilitatorClient`) for the Agent Pay networks
      - Create an `HTTPFacilitatorClient` for the default fallback (unless `disableDefaultFallback` is true)
      - Instantiate `x402ResourceServer` with `[fabFacilitatorClient, defaultFacilitatorClient]` (FAB first for precedence)
      - For each network in `fabNetworks`, call `server.register(network, new AgentPayServerScheme({...}))` with the provided signing keys and service URL
      - Call `server.initialize()` to fetch supported kinds from both facilitators
      - Return the configured `x402ResourceServer`
    - [ ] 29.1.3 Handle edge cases
      - Validate `fabNetworks` is non-empty
      - Validate Agent Pay URL is a valid URL
      - Validate signing keys are present
      - If `disableDefaultFallback` is true, only pass the Agent Pay facilitator client
      - If a network in `fabNetworks` is not supported by the Agent Pay's `/.well-known/x402-supported` response, log a warning (Agent Pay may not support it yet)

  - [ ] 29.2 Create `FABClientBuilder` in `src/builders/client-builder.ts`
    - [ ] 29.2.1 Define `FABClientConfig` interface
      ```typescript
      interface FABClientConfig {
        /** Networks to register Agent Pay client schemes for */
        fabNetworks: Network[];
        /** Agent Pay base URL */
        agentPayBaseUrl: string;
        /** Agent Pay ID */
        agentPayId: string;
        /** Optional: Agent Pay auth config */
        agentPayAuth?: AuthConfig;
        /** Optional: DPoP configuration */
        dpop?: { keyPair: DPoPKeyPair; enabled: boolean };
      }
      ```
    - [ ] 29.2.2 Implement `buildAgentPayClient(config)` factory function
      - Create a single `AgentPayClientScheme` instance configured with Agent Pay
      - For each network in `fabNetworks`, call `client.register(network, fabClientScheme)` — the same `AgentPayClientScheme` instance can be reused across networks because the scheme is stateless w.r.t. network (the network is passed through to Agent Pay)
      - Return the configured `x402Client`
    - [ ] 29.2.3 Handle edge cases
      - Validate `fabNetworks` is non-empty
      - Validate Agent Pay URL
      - Allow passing an existing `x402Client` instance to add Agent Pay networks to (for composability with non-Agent-Pay schemes the client may also support)

  - [ ] 29.3 Update `InProcessFacilitatorClient` to support multi-facilitator composition
    - [ ] 29.3.1 The `InProcessFacilitatorClient` wraps an `x402Facilitator` which already supports multiple scheme registrations. Verify that registering the Agent Pay facilitator scheme for specific networks and then passing this client as one of multiple facilitator clients to `x402ResourceServer` works correctly.
    - [ ] 29.3.2 The `x402ResourceServer` constructor accepts `FacilitatorClient | FacilitatorClient[]`. Verify that passing `[inProcessFabClient, httpDefaultClient]` gives Agent Pay precedence for registered networks and falls back to HTTP for others.
    - [ ] 29.3.3 No code changes expected — this subtask is verification of existing behavior. Document findings.

  - [ ] 29.4 Update `AgentPayFacilitatorClient.getSupported()` to scope to registered networks
    - [ ] 29.4.1 Currently `AgentPayFacilitatorClient.getSupported()` returns whatever the Agent Pay's `/.well-known/x402-supported` endpoint returns. This is correct — Agent Pay declares what it supports, and the `x402ResourceServer.initialize()` maps those to facilitator clients.
    - [ ] 29.4.2 However, if Agent Pay declares support for networks that the integrator did NOT include in `fabNetworks`, those networks would still be claimed by the Agent Pay facilitator (because `initialize()` maps by what `getSupported()` returns, not by what the integrator registered). This could shadow the default facilitator for networks the integrator didn't intend to handle via Agent Pay.
    - [ ] 29.4.3 Solution: Add an optional `networkFilter` to `AgentPayFacilitatorClient` constructor. When set, `getSupported()` filters the Agent Pay's response to only include kinds whose network is in the filter set. This ensures the Agent Pay facilitator only claims the networks the integrator explicitly chose.
      ```typescript
      constructor(
        agentPayBaseUrl: string,
        authConfig?: AgentPayFacilitatorAuthConfig,
        networkFilter?: Set<Network>  // NEW: only claim these networks
      )
      ```
    - [ ] 29.4.4 Update `getSupported()` implementation:
      ```typescript
      async getSupported(): Promise<SupportedResponse> {
        const response = await fetch(`${this.agentPayBaseUrl}/.well-known/x402-supported`);
        if (!response.ok) throw new Error(`Failed to fetch supported kinds: ${response.statusText}`);
        const supported = await response.json() as SupportedResponse;
        
        // If network filter is set, only include kinds for registered networks
        if (this.networkFilter) {
          supported.kinds = supported.kinds.filter(kind => this.networkFilter!.has(kind.network as Network));
        }
        
        return supported;
      }
      ```

  - [ ] 29.5 Create convenience `registerAgentPayNetworks` function in `src/builders/register.ts`
    - [ ] 29.5.1 Implement a single function that wires up both server and facilitator for the common case:
      ```typescript
      /**
       * Register Agent Pay networks on an existing x402ResourceServer.
       * For each network, registers a AgentPayServerScheme.
       * Does NOT handle facilitator client setup — use buildAgentPayResourceServer for that.
       */
      function registerAgentPayNetworks(
        server: x402ResourceServer,
        networks: Network[],
        config: { signingKeys: SigningKeysConfig; serviceUrl: string }
      ): x402ResourceServer {
        const fabServer = new AgentPayServerScheme({
          signingKeys: config.signingKeys,
          serviceUrl: config.serviceUrl,
        });
        for (const network of networks) {
          server.register(network, fabServer);
        }
        return server;
      }
      ```
    - [ ] 29.5.2 This is a lower-level helper for integrators who want to compose their own facilitator client setup but still want a one-liner for scheme registration.

  - [ ] 29.6 Update exports in `src/index.ts`
    - [ ] 29.6.1 Export the new builder functions and config types:
      ```typescript
      // Builders
      export { buildAgentPayResourceServer } from './builders/resource-server-builder';
      export { buildAgentPayClient } from './builders/client-builder';
      export { registerAgentPayNetworks } from './builders/register';
      export type { FABResourceServerConfig } from './builders/resource-server-builder';
      export type { FABClientConfig } from './builders/client-builder';
      ```
    - [ ] 29.6.2 Keep existing exports unchanged for backward compatibility. The new builders are additive.

  - [ ] 29.7 Update examples to use new builders
    - [ ] 29.7.1 Update `examples/test-service.ts` to use `buildAgentPayResourceServer`:
      ```typescript
      // BEFORE (manual registration):
      const facilitatorClient = new AgentPayFacilitatorClient(AGENT_PAY_BASE_URL, { ... });
      const server = new x402ResourceServer(facilitatorClient);
      server.register('fab:test', new AgentPayServerScheme({ ... }));
      server.register('eip155:8453', new AgentPayServerScheme({ ... }));
      await server.initialize();

      // AFTER (builder):
      const server = await buildAgentPayResourceServer({
        fabNetworks: ['fab:test', 'eip155:8453'],
        agentPayBaseUrl: AGENT_PAY_BASE_URL,
        agentPayId: 'mock-agent-pay-provider',
        signingKeys: { privateKey: serviceKeys.privateKey, publicKey: publicJWK, alg: 'RS256' },
        serviceUrl: SERVICE_URL,
        agentPayAuth: { getAuthHeaders: async () => ({ ... }) },
      });
      ```
    - [ ] 29.7.2 Update `examples/test-client.ts` to use `buildAgentPayClient`:
      ```typescript
      // BEFORE (manual registration):
      const paymentClient = new x402Client()
        .register('fab:test', new AgentPayClientScheme({ ... }))
        .register('eip155:8453', new AgentPayClientScheme({ ... }));

      // AFTER (builder):
      const paymentClient = buildAgentPayClient({
        fabNetworks: ['fab:test', 'eip155:8453'],
        agentPayBaseUrl: AGENT_PAY_BASE_URL,
        agentPayId: AGENT_PAY_ID,
        agentPayAuth: { type: 'apiKey', apiKey: API_KEY },
      });
      ```
    - [ ] 29.7.3 Add a new example `examples/multi-facilitator.ts` showing the fallback scenario:
      - Register `aws:base` and `eip155:8453` for Agent Pay
      - Show that `solana:mainnet` would fall back to the default x402 facilitator
      - Include comments explaining the precedence model

  - [ ] 29.8 Write unit tests for `buildAgentPayResourceServer` in `test/unit/builders/resource-server-builder.test.ts`
    - [ ] 29.8.1 Test: builds server with Agent Pay facilitator for specified networks
      - Mock `AgentPayFacilitatorClient.getSupported()` to return the specified networks
      - Verify `server.hasRegisteredScheme(network, 'fab')` is true for each specified network
      - Verify `server.getSupportedKind(2, network, 'fab')` returns a kind for each network
    - [ ] 29.8.2 Test: default facilitator is included when `disableDefaultFallback` is false (default)
      - Mock both facilitator clients
      - Verify that a network NOT in `fabNetworks` but supported by the default facilitator is available via `getSupportedKind`
    - [ ] 29.8.3 Test: default facilitator is excluded when `disableDefaultFallback` is true
      - Verify that only Agent Pay networks are available
    - [ ] 29.8.4 Test: Agent Pay facilitator takes precedence over default for overlapping networks
      - If both Agent Pay and default facilitator support `eip155:8453`, the Agent Pay facilitator should win (it's first in the array)
      - Verify by checking which facilitator client is used for verify/settle
    - [ ] 29.8.5 Test: validation errors for invalid config
      - Empty `fabNetworks` array throws
      - Invalid `agentPayBaseUrl` throws
      - Missing `signingKeys` throws
    - Target: 5-7 tests

  - [ ] 29.9 Write unit tests for `buildAgentPayClient` in `test/unit/builders/client-builder.test.ts`
    - [ ] 29.9.1 Test: registers Agent Pay client scheme for all specified networks
      - Build client with `fabNetworks: ['aws:base', 'eip155:8453']`
      - Create a mock `PaymentRequired` with `accepts` containing both networks
      - Verify `createPaymentPayload` works for both networks
    - [ ] 29.9.2 Test: client rejects payment requirements for unregistered networks
      - Build client with `fabNetworks: ['aws:base']`
      - Create `PaymentRequired` with only `solana:mainnet` in `accepts`
      - Verify `createPaymentPayload` throws (no registered scheme for solana)
    - [ ] 29.9.3 Test: client selects registered network when multiple options available
      - Build client with `fabNetworks: ['eip155:8453']`
      - Create `PaymentRequired` with `accepts` containing both `eip155:8453` and `solana:mainnet`
      - Verify client selects `eip155:8453` (the one it has a scheme for)
    - [ ] 29.9.4 Test: composability with existing x402Client
      - Build Agent Pay client, then add a non-Agent-Pay scheme manually
      - Verify both work
    - [ ] 29.9.5 Test: validation errors
      - Empty `fabNetworks` throws
      - Invalid `agentPayBaseUrl` throws
    - Target: 5-6 tests

  - [ ] 29.10 Write unit tests for `AgentPayFacilitatorClient` network filter in `test/unit/agent-pay-facilitator-client.test.ts`
    - [ ] 29.10.1 Test: without filter, `getSupported()` returns all Agent Pay-supported networks
      - Mock Agent Pay returning `['aws:base', 'fab:test', 'eip155:8453']`
      - Verify all three are in the response
    - [ ] 29.10.2 Test: with filter `['aws:base']`, `getSupported()` only returns `aws:base`
      - Same mock Agent Pay response
      - Verify only `aws:base` is in the filtered response
    - [ ] 29.10.3 Test: with filter for networks Agent Pay doesn't support, returns empty kinds
      - Filter for `['solana:mainnet']` but Agent Pay only supports Agent Pay networks
      - Verify `kinds` is empty
    - Target: 3-4 tests

  - [ ] 29.11 Write integration test for multi-facilitator fallback in `test/integrations/multi-facilitator.test.ts`
    - [ ] 29.11.1 Test: end-to-end Agent Pay payment on a FAB-registered network
      - Use `buildAgentPayResourceServer` with `fabNetworks: ['aws:base']`
      - Use `buildAgentPayClient` with `fabNetworks: ['aws:base']`
      - Run the full flow: buildPaymentRequirements → createPaymentPayload → verifyPayment → settlePayment
      - Verify success
    - [ ] 29.11.2 Test: server offers multiple networks, client only supports Agent Pay networks
      - Server registers `aws:base` (FAB) and `eip155:8453` (default facilitator)
      - Client registers only `aws:base`
      - Server builds requirements for `aws:base` — client pays successfully
      - Server builds requirements for `eip155:8453` — client correctly rejects (no scheme registered)
    - [ ] 29.11.3 Test: Agent Pay facilitator precedence over default
      - Both Agent Pay and default facilitator claim `eip155:8453`
      - Verify the Agent Pay facilitator handles verify/settle (not the default)
      - This validates the `x402ResourceServer` precedence model
    - Target: 3-4 tests

  - [ ] 29.12 Update `src/builders/index.ts` barrel export
    - Create `src/builders/index.ts` that re-exports from all builder modules
    - Keep the builder directory self-contained

  - [ ] 29.13 Update documentation
    - [ ] 29.13.1 Update `README.md`
      - Add "Quick Start" section showing `buildAgentPayResourceServer` and `buildAgentPayClient`
      - Add "Multi-Facilitator Fallback" section explaining the precedence model
      - Show the before/after comparison of manual vs builder registration
    - [ ] 29.13.2 Update `docs/design.md` (if exists) or add a section to `docs/spec.md`
      - Document the multi-facilitator architecture
      - Document the network filter on `AgentPayFacilitatorClient`
      - Document the precedence model: Agent Pay first, default second
    - [ ] 29.13.3 Add JSDoc to all new public APIs
      - `buildAgentPayResourceServer` — full parameter docs, usage example
      - `buildAgentPayClient` — full parameter docs, usage example
      - `registerAgentPayNetworks` — full parameter docs
      - `FABResourceServerConfig` — field-level docs
      - `FABClientConfig` — field-level docs

  - [ ] 29.14 Update spec.md with new requirements
    - Add APAY-BLD-001: `The system shall provide a buildAgentPayResourceServer factory function that accepts a list of networks and returns a fully configured x402ResourceServer with Agent Pay facilitator precedence over the default facilitator.`
    - Add APAY-BLD-002: `The system shall provide a buildAgentPayClient factory function that accepts a list of networks and returns a fully configured x402Client with Agent Pay client schemes registered for each network.`
    - Add APAY-BLD-003: `When buildAgentPayResourceServer is called without disableDefaultFallback, the system shall include an HTTPFacilitatorClient as a fallback facilitator for networks not handled by FAB.`
    - Add APAY-BLD-004: `The AgentPayFacilitatorClient shall support an optional networkFilter that restricts getSupported() to only return kinds for networks in the filter set.`
    - Add APAY-BLD-005: `When multiple facilitator clients are provided to x402ResourceServer, the Agent Pay facilitator client shall be positioned first in the array to ensure precedence during initialize().`
    - Add APAY-BLD-006: `The registerAgentPayNetworks helper shall register a AgentPayServerScheme for each specified network on an existing x402ResourceServer without modifying facilitator client configuration.`

  - [ ] 29.15 Update traceability matrix
    - Add APAY-BLD-001 → `src/builders/resource-server-builder.ts` → `test/unit/builders/resource-server-builder.test.ts`
    - Add APAY-BLD-002 → `src/builders/client-builder.ts` → `test/unit/builders/client-builder.test.ts`
    - Add APAY-BLD-003 → `src/builders/resource-server-builder.ts` → `test/unit/builders/resource-server-builder.test.ts`
    - Add APAY-BLD-004 → `src/agent-pay-facilitator-client.ts` → `test/unit/agent-pay-facilitator-client.test.ts`
    - Add APAY-BLD-005 → `src/builders/resource-server-builder.ts` → `test/integrations/multi-facilitator.test.ts`
    - Add APAY-BLD-006 → `src/builders/register.ts` → `test/unit/builders/resource-server-builder.test.ts`

  **How the precedence model works (for reference):**

  The `x402ResourceServer` constructor accepts `FacilitatorClient | FacilitatorClient[]`. During `initialize()`, it calls `getSupported()` on each client in order and builds a map of `(version, network, scheme) → facilitatorClient`. The key line in the core is:

  ```typescript
  // Only store if not already present (gives precedence to earlier facilitators)
  if (!responseNetworkMap.has(kind.scheme)) {
    responseNetworkMap.set(kind.scheme, supported);
    clientNetworkMap.set(kind.scheme, facilitatorClient);
  }
  ```

  So by passing `[fabFacilitatorClient, defaultFacilitatorClient]`, Agent Pay claims its networks first. The default facilitator only fills in networks that Agent Pay didn't claim. This is exactly the behavior we want.

  **Files created:**
  - `src/builders/resource-server-builder.ts`
  - `src/builders/client-builder.ts`
  - `src/builders/register.ts`
  - `src/builders/index.ts`
  - `test/unit/builders/resource-server-builder.test.ts`
  - `test/unit/builders/client-builder.test.ts`
  - `test/integrations/multi-facilitator.test.ts`
  - `examples/multi-facilitator.ts`

  **Files modified:**
  - `src/agent-pay-facilitator-client.ts` (add `networkFilter` parameter)
  - `src/index.ts` (add builder exports)
  - `examples/test-service.ts` (update to use builder)
  - `examples/test-client.ts` (update to use builder)
  - `docs/spec.md` (add APAY-BLD requirements)
  - `docs/tasks.md` (traceability matrix)
  - `README.md` (documentation)

  **Estimated test count:** 16-21 new tests
  **Dependencies:** None (uses existing `@x402/core` multi-facilitator support)
  **Risk:** Low — builders are additive, existing manual registration still works. The only behavioral change is the `networkFilter` on `AgentPayFacilitatorClient`, which is opt-in (default: no filter, same as today).
  **Backward compatibility:** Full. All existing code continues to work. Builders are a new, optional API surface.

- [x] 30. Create Brazil Package and Upload to code.amazon.com

  Create a Brazil package for `aws-agent-pay-x402` on code.amazon.com so the SDK can be consumed by internal teams via the Brazil dependency model. This involves creating the package using the NpmPrettyMuch build system, configuring it for the existing codebase, and uploading it to GitFarm.

  _Spec references: APAY-CMP-001 through APAY-CMP-005, APAY-BLD-001 through APAY-BLD-003_

  **Context:**
  - The `aws-agent-pay-x402` package is currently a local npm project built with `tsup` and tested with `vitest`.
  - Amazon's internal TypeScript build system is [NpmPrettyMuch](https://code.amazon.com/packages/NpmPrettyMuch), which wraps npm and integrates with Brazil's dependency model.
  - The package has two production dependencies (`jose`, `zod`) and one peer dependency (`@x402/core`).
  - The [BuilderHub Create CLI](https://docs.hub.amazon.dev/docs/create/cli-guide/howto-pkg.html) provides the `create package` command to scaffold and `create package upload` to promote packages to Brazil/GitFarm.
  - The recommended source package template for TypeScript libraries is `javascript-npm-pretty-much`.

  **Prerequisites:**
  - A Bindle ID for the package (ownership and permissions). Must be created or identified before starting.
  - A version set to build into (either existing or new).
  - A Brazil workspace associated with that version set.
  - The `create` CLI installed (`toolbox install create`).
  - `mwinit` session active for GitFarm push.

  **Plan:**

  - [ ] 30.1 Identify or create a Bindle for the package
    - Determine the owning team and Bindle for `aws-agent-pay-x402`.
    - If no Bindle exists, create one at [bindles.amazon.com](https://bindles.amazon.com) with appropriate team ownership.
    - Record the Bindle ID (`amzn1.bindle.resource.xxxxxxxxxxxxxxxxxxxx`).
    - Decide on package permissions: Public source + Public artifacts (recommended for an SDK consumed by other teams).

  - [ ] 30.2 Create a version set (if one doesn't exist)
    - Create a version set for the Agent Pay project:
      ```bash
      brazil vs create \
        --from Linux/central \
        --versionset <VSGroup>/mainline \
        --platforms AL2023_x86_64,AL2023_aarch64 \
        --mailinglist <team-mailing-list>@amazon.com \
        --bindleid <bindle-id>
      ```
    - Merge NpmPrettyMuch and NodeJS into the version set:
      ```bash
      brazil vs merge --package NpmPrettyMuch --destination <VSGroup>/mainline
      brazil vs merge --package NodeJS --destination <VSGroup>/mainline
      ```

  - [ ] 30.3 Create a Brazil workspace
    - Create a local workspace tracking the version set:
      ```bash
      brazil ws create \
        --name fab-x402-workspace \
        --versionSet <VSGroup>/mainline
      ```
    - Set platform:
      ```bash
      brazil ws use --platform AL2023_x86_64
      ```

  - [ ] 30.4 Generate the Brazil package from template
    - Use the BuilderHub Create CLI to scaffold the package:
      ```bash
      cd fab-x402-workspace
      create package --id javascript-npm-pretty-much --name X402Fab
      ```
    - This creates a `src/X402Fab/` directory with a `Config` file, `package.json`, and NpmPrettyMuch build configuration.

  - [ ] 30.5 Configure the Brazil `Config` file
    - Verify the generated `Config` file has the correct build system and tools:
      ```
      build-system = npm-pretty-much;
      build-tools = {
          1.0 = {
              NpmPrettyMuch = 1.10;
              NodeJS = default;
          };
      };
      ```
    - Add any required dependencies or test-dependencies blocks if needed for `@x402/core`.

  - [ ] 30.6 Copy the existing source code into the Brazil package
    - Copy the following from the current `fab-x402-extension/` into the Brazil package directory:
      - `src/` — all TypeScript source files
      - `test/` — all test files
      - `package.json` — the npm package manifest (will need adaptation)
      - `tsconfig.json` — TypeScript configuration
      - `tsup.config.ts` — build configuration
      - `vitest.config.ts` — test configuration (if present)
      - `README.md`, `docs/` — documentation
    - Do NOT copy: `node_modules/`, `dist/`, `coverage/`, `.git/`, `examples/` (examples can be added later).

  - [ ] 30.7 Adapt `package.json` for Brazil
    - Update the `name` field to use the `@amzn/` scope if required by internal conventions (e.g., `@amzn/x402-fab`), or keep `aws-agent-pay-x402` if the team prefers.
    - Ensure `repository` field points to the GitFarm repo:
      ```json
      "repository": {
        "type": "git",
        "url": "ssh://git.amazon.com/pkg/X402Fab"
      }
      ```
    - Update the `@x402/core` dev dependency from `file:../x402/typescript/packages/core` to a proper version reference. If `@x402/core` is available in the version set, use `"*"` and declare it in the Brazil `Config` dependencies. If not, it needs to be built into the version set first.
    - Verify `jose` and `zod` (third-party dependencies) are resolvable via NpmPrettyMuch's npm proxy.

  - [ ] 30.8 Verify local build
    - Run `brazil-build` to verify the package builds successfully:
      ```bash
      cd src/X402Fab
      brazil-build
      ```
    - This should invoke NpmPrettyMuch, which runs `npm install` and then `npm run build` (the `release` target).
    - Verify that `build/brazil-npm-registry/` is produced (this is the artifact NpmPrettyMuch publishes).

  - [ ] 30.9 Verify tests pass in Brazil build
    - Ensure `npm test` is wired into the NpmPrettyMuch build. By default, NpmPrettyMuch runs `npm test` as part of `release`.
    - Run `brazil-build release` and verify all 306 tests pass.

  - [ ] 30.10 Upload the package to Brazil/GitFarm
    - Commit all files to git locally.
    - Upload using the Create CLI:
      ```bash
      create package upload \
        --bindleId <bindle-id> \
        --primaryExportControlType none \
        --containsEncryption yes
      ```
      (The package uses `jose` for JWT/JWK cryptographic operations, so `containsEncryption` should be `yes`.)
    - This will:
      1. Create the GitFarm repository at `code.amazon.com/packages/X402Fab`
      2. Register the Brazil package
      3. Push the local git history to GitFarm

  - [ ] 30.11 Build the package into the version set
    - Submit a build request:
      ```bash
      brazil pb build \
        --versionSet <VSGroup>/mainline \
        --package X402Fab \
        --branch mainline \
        --useLatestChange \
        --waitForCompletion
      ```
    - Verify the build succeeds on [build.amazon.com](https://build.amazon.com).

  - [ ] 30.12 Verify the package is consumable
    - In a separate test package or workspace, add `X402Fab` as a dependency in the `Config` file and `@amzn/x402-fab` (or `aws-agent-pay-x402`) in `package.json`.
    - Run `brazil-build` and verify the dependency resolves and imports work.

  - [ ] 30.13 Update documentation
    - Update `README.md` installation instructions to include Brazil consumption:
      ```
      ## Installation (Brazil)
      Add to your Config file:
      dependencies = { 1.0 = { X402Fab = 1.0; }; };

      Add to your package.json:
      "dependencies": { "aws-agent-pay-x402": "*" }
      ```
    - Update `docs/sdk-guide.md` with a note about Brazil package availability.

  **Files created:**
  - `Config` (Brazil build configuration)
  - GitFarm repository at `code.amazon.com/packages/X402Fab`

  **Files modified:**
  - `package.json` (repository URL, dependency references)
  - `README.md` (installation instructions)
  - `docs/sdk-guide.md` (Brazil availability note)

  **Dependencies:**
  - Bindle ID (must exist before upload)
  - Version set (must exist before build)
  - `@x402/core` must be available in the version set or resolvable via npm proxy

  **Risk:** Medium — the main risk is `@x402/core` dependency resolution. If `@x402/core` is not in the version set or npm proxy, it needs to be built/published first. Third-party deps (`jose`, `zod`) should resolve via NpmPrettyMuch's npm proxy automatically.

  **Open questions:**
  1. What is the Bindle ID for this package? (Needs team input)
  2. What version set should this build into? (Needs team input)
  3. Should the npm scope be `@amzn/x402-fab` or `aws-agent-pay-x402`? (Naming convention decision)
  4. Is `@x402/core` already available as a Brazil package, or does it need to be onboarded first?

---

## Release-Readiness Tasks (Priority Order)

_Added: 2026-05-11. These tasks prepare the SDK for production release against the AWS Marketplace Agent Pay Service._

- [x] 31. Terminology Refactor: "Agent Pay" → "Agent Pay"

  **Priority: 1 (highest) — Business decision, affects all other tasks**

  Rename all references to "Agent Pay" throughout the codebase to "Agent Pay" (or `agentPay` / `AgentPay` in code identifiers). This is a branding decision — the AWS service is called "Agent Pay", not a "Agent Pay".

  **Scope:**
  - All source files (`src/**/*.ts`)
  - All test files (`test/**/*.ts`)
  - All example files (`examples/**/*.ts`)
  - All documentation (`docs/**/*.md`, `README.md`)
  - File names (e.g., `agent-pay-client.ts` → `agent-pay-client.ts`, `agent-pay-facilitator-client.ts` → `agent-pay-facilitator-client.ts`)
  - Type/interface names (e.g., `AgentPayFacilitatorClient` → `AgentPayFacilitatorClient`, `AgentPayClientForClient` → `AgentPayClientForClient`, `DefaultAgentPayClient` → `DefaultAgentPayClient`)
  - Config field names (e.g., `agentPayBaseUrl` → `agentPayBaseUrl`, `agentPayId` → removed or renamed, `agentPayAuth` → `agentPayAuth`)
  - Constants (e.g., `https://pay.aws.amazon.com` → the actual Agent Pay endpoint)
  - Mock server (`mock-agent-pay-server.ts` → `mock-agent-pay-server.ts`)
  - Package exports and barrel files

  **Naming convention:**
  - Class names: `AgentPay*` (PascalCase)
  - Variable/field names: `agentPay*` (camelCase)
  - File names: `agent-pay-*` (kebab-case)
  - Documentation prose: "Agent Pay" or "Agent Pay Service"
  - Never use "Agent Pay" in new code

  **Approach:**
  1. Create a mapping table of old → new names
  2. Rename files first (using IDE refactoring to update imports)
  3. Rename types/interfaces/classes
  4. Rename config fields and variables
  5. Update all documentation prose
  6. Update all test assertions and mock names
  7. Run full test suite to verify nothing broke

  **Risk:** Medium — large surface area but mechanically straightforward. Must be done first because all subsequent tasks build on the new naming.

---

- [x] 32. Integrate with AWS Marketplace Agent Pay API Signature

  **Priority: 2 — Core integration with the production service**

  Align the SDK's client-side payment creation with the actual AWS Marketplace Agent Pay API (OpenAPI spec version 2026-04-20). The API has a fundamentally simpler interface than our current `POST /transactions` abstraction.

  **AWS Marketplace Agent Pay API Summary:**

  | Operation | Method | Path | Auth |
  |-----------|--------|------|------|
  | CreateAgentPayment | POST | `/CreateAgentPayment` | AWS SigV4 |
  | GetAgentPayment | GET | `/GetAgentPayment/{paymentId}` | AWS SigV4 |
  | ListAgentPayments | POST | `/ListAgentPayments` | AWS SigV4 |

  **CreateAgentPayment Request:**
  ```json
  {
    "quoteToken": "<seller-signed JWT>",
    "clientToken": "<idempotency key, 1-128 chars>",
    "dpopJwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "..." }
  }
  ```

  **CreateAgentPayment Response (201):**
  ```json
  {
    "paymentId": "awsmp-01970f3e-4b2a-7dc0-8e1f-6a3b9c5d7e2f",
    "paymentToken": "<ES384-signed JWT by Agent Pay>",
    "createdAt": "2026-04-22T14:20:00Z"
  }
  ```

  **Key differences from current implementation:**
  1. No `network`, `amount`, `currency`, `payTo`, `agentPayId` in request — Agent Pay extracts everything from the quote token
  2. Response uses `paymentId` (not `transactionId`) with format `awsmp-{UUIDv7}`
  3. No separate `/capture` endpoint — payment is auto-captured on creation
  4. DPoP key is passed as `dpopJwk` in request body (not as a header proof)
  5. Auth is always AWS SigV4 (no API key, no OAuth2 for this endpoint)
  6. Signing algorithm is ES384 (not RS256)
  7. Quote token `aud` is `aws:base`
  8. Quote token `settlement.product_id` replaces `payTo` as the seller identifier

  **Payment Token Structure (from Agent Pay):**
  ```json
  {
    "iss": "aws-marketplace",
    "payment_id": "awsmp-...",
    "cnf": { "jkt": "<SHA-256 thumbprint of dpopJwk>" }
  }
  ```

  **Error Responses:**
  - 400: `InvalidQuoteTokenException`, `QuoteExpiredException`, `QuoteSignatureInvalidException`, `UnsupportedCurrencyException`, `ValidationException`
  - 403: `SpendingLimitExceededException`, `AccessDeniedException`
  - 404: `ProductNotFoundException`
  - 409: `ConflictException` (clientToken reuse with different params)
  - 429: `ThrottlingException`
  - 500: `InternalServerException`

  **Subtasks:**

  - [ ] 32.1 Add spec requirements for Agent Pay API integration
    - Add APAY-APAY-001 through APAY-APAY-015 to `docs/spec.md`
    - Define the `AgentPayClient` interface matching the API
    - Define request/response types
    - Define error types matching API error responses

  - [ ] 32.2 Implement `AgentPayClient` class
    - `createPayment(request: CreateAgentPaymentRequest): Promise<CreateAgentPaymentResponse>`
    - `getPayment(paymentId: string): Promise<GetAgentPaymentResponse>`
    - `listPayments(request?: ListAgentPaymentsRequest): Promise<ListAgentPaymentsResponse>`
    - Auth: AWS SigV4 only (use `@aws-sdk/signature-v4` or accept pre-signed requests)
    - Base URL configurable (for testing against mock server)

  - [ ] 32.3 Update `AgentPayClientScheme.createPaymentPayload` to use new API shape
    - Send only `{ quoteToken, clientToken?, dpopJwk? }` — no amount/currency/network/payTo
    - Map response `paymentId` to the payload's transaction identifier
    - Map response `paymentToken` to the Agent Pay payload

  - [ ] 32.4 Update mock server to match Agent Pay API signature
    - Rename `POST /transactions` → `POST /CreateAgentPayment`
    - Accept `{ quoteToken, clientToken?, dpopJwk? }`
    - Return `{ paymentId, paymentToken, createdAt }`
    - Add `GET /GetAgentPayment/{paymentId}`
    - Add `POST /ListAgentPayments`
    - Implement idempotency via `clientToken`
    - Validate quote token structure (parse JWT, check `aud`, check `exp`)
    - Return appropriate error codes (400, 403, 404, 409, 429, 500)

  - [ ] 32.5 Update `AgentPayFacilitatorClient` (formerly `AgentPayFacilitatorClient`)
    - Remove `POST /capture` call from `settle()` — Agent Pay auto-captures
    - `verify()` remains: fetch JWKS, verify payment token signature (ES384), verify quote token
    - `settle()` becomes a no-op that returns success (payment already captured)
    - Update JWKS endpoint expectation (Agent Pay publishes keys at `/.well-known/jwks.json`)

  - [ ] 32.6 Update types for new payment ID format
    - Payment ID format: `awsmp-{UUIDv7}` (42 chars, pattern: `^awsmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
    - Update `generateTransactionId` / `parseTransactionId` or replace with `paymentId` utilities
    - Update `AgentPayPayloadV2` to use `paymentId` instead of `transactionId`

  - [ ] 32.7 Update all tests to match new API shape
  - [ ] 32.8 Update all examples to match new API shape
  - [ ] 32.9 Update documentation (spec, sdk-guide, README)

  **Files modified:** `src/agent-pay-client.ts` (new), `src/fab/client/scheme.ts`, `src/agent-pay-facilitator-client.ts`, `src/types.ts`, `src/utils.ts`, `examples/mock-agent-pay-server.ts`, all test files
  **Risk:** High — this is a breaking change to the client-side API. Must be coordinated with Task 31 (terminology).

---

- [x] 33. DPoP and Public Key Verification Hardening

  **Priority: 3 — Security-critical for release**

  Ensure DPoP binding and payment token public key verification work correctly end-to-end with the Agent Pay API's specific requirements.

  **Agent Pay DPoP specifics:**
  - DPoP key is EC only (P-256, P-384, P-521) — no RSA for DPoP
  - Key is passed as `dpopJwk` in the `CreateAgentPayment` request body (not as a DPoP proof header)
  - Agent Pay binds the payment token to the key via `cnf.jkt` (SHA-256 thumbprint)
  - The seller verifies: payment token signature (Agent Pay's ES384 key) + `cnf.jkt` matches the buyer's DPoP key thumbprint

  **Subtasks:**

  - [ ] 33.1 Verify DPoP key generation produces valid EC keys for Agent Pay
    - P-256, P-384, P-521 must all work
    - Output format must match `DpopJwk` schema: `{ kty: "EC", crv, x, y }` (no `d`, no `alg`, no `use`)
    - Ensure `x` and `y` are base64url-encoded (43-128 chars)

  - [ ] 33.2 Implement seller-side payment token verification
    - Fetch Agent Pay's JWKS (ES384 public keys)
    - Verify payment token JWT signature (algorithm: ES384)
    - Extract `cnf.jkt` from payment token
    - Compute SHA-256 thumbprint of the buyer's DPoP key (from the original 402 flow or stored)
    - Compare `cnf.jkt` against computed thumbprint
    - Return verification result

  - [ ] 33.3 Update `AgentPayServerScheme` / facilitator verify to check `cnf.jkt`
    - If payment token contains `cnf.jkt`, verification MUST check it
    - The DPoP public key must be available to the verifier (passed in or stored)
    - If `cnf.jkt` is present but no DPoP key is available for comparison, fail verification

  - [ ] 33.4 Add integration tests for DPoP round-trip
    - Generate EC P-256 key pair
    - Create payment with `dpopJwk` in request
    - Verify returned payment token has `cnf.jkt` matching the key's thumbprint
    - Verify seller-side verification succeeds with correct key
    - Verify seller-side verification fails with wrong key

  - [ ] 33.5 Update mock server to bind `cnf.jkt` in payment tokens
    - When `dpopJwk` is provided in `CreateAgentPayment`, compute its thumbprint
    - Include `cnf: { jkt: thumbprint }` in the signed payment token

  **Risk:** Medium — DPoP is already implemented but needs alignment with Agent Pay's EC-only, body-based approach (vs. the current header-based DPoP proof approach from RFC 9449).

---

- [x] 34. Client Token (Idempotency Key) Support

  **Priority: 4 — Required by the AWS SDK contract**

  The Agent Pay API requires a `clientToken` for idempotency. Same token + same parameters returns the original response within 24 hours. Different parameters with the same token returns 409 Conflict.

  **Subtasks:**

  - [ ] 34.1 Add `clientToken` to the client scheme's payment creation
    - Auto-generate a UUID if not provided by the caller
    - Accept optional `clientToken` in the payment creation options
    - Pass through to `CreateAgentPayment` request body
    - Constraints: 1-128 characters

  - [ ] 34.2 Add `clientToken` to the client builder/config
    - Allow callers to provide a `clientTokenGenerator` function for custom strategies
    - Default: `crypto.randomUUID()`

  - [ ] 34.3 Handle 409 Conflict response
    - When Agent Pay returns 409, it means the same `clientToken` was used with different parameters
    - Surface this as a specific error type (`IdempotencyConflictError`)
    - Include the original `clientToken` in the error for debugging

  - [ ] 34.4 Update mock server to implement idempotency
    - Store `clientToken → response` mapping (in-memory, 24h TTL)
    - Return cached response for same token + same params
    - Return 409 for same token + different params

  - [ ] 34.5 Write tests for idempotency behavior
    - Test: same request with same clientToken returns same response
    - Test: same clientToken with different quoteToken returns 409
    - Test: auto-generated clientToken is unique per call
    - Test: custom clientToken generator is used when provided

  **Risk:** Low — straightforward addition. The main consideration is ensuring the auto-generated token doesn't accidentally cause retries to be treated as new requests (it shouldn't, since each call gets a fresh UUID by default).

---

- [x] 35. Network Identifier: `aws:base` → `aws:base` (Parameterized)

  **Priority: 5 — Release requirement, affects all code paths**

  Change the default network identifier from `aws:base` to `aws:base` and ensure it's never a magic literal anywhere in the codebase. The identifier must be a configurable constant so it can be changed again without a code sweep.

  **Subtasks:**

  - [ ] 35.1 Define the network identifier as a single constant
    - Add `DEFAULT_NETWORK = 'aws:base'` to `src/constants.ts`
    - Remove or deprecate any `aws:base` references
    - All code that currently uses `'aws:base'` must reference this constant

  - [ ] 35.2 Update the CAIP family pattern
    - Current: `AGENT_PAY_CAIP_FAMILY = 'fab:*'`
    - New: needs to match `aws:base` — update to `'aws:*'` or make it configurable
    - Evaluate impact on facilitator network matching logic

  - [ ] 35.3 Update all source files
    - `src/constants.ts` — define constant
    - `src/networks/aws.ts` — use constant
    - `src/builders/*.ts` — use constant in examples/defaults
    - `src/discovery.ts` — update network validation (currently requires `fab:` prefix)
    - `src/utils.ts` — update `parseTransactionId` / `formatTransactionId` if they validate `fab:` prefix

  - [ ] 35.4 Update all test files
    - Replace all `'aws:base'` and `'fab:test'` literals with the constant or a test-specific constant
    - Ensure tests still pass with `aws:base`

  - [ ] 35.5 Update all examples and documentation
    - README, sdk-guide, spec — replace `aws:base` with `aws:base`
    - Examples — use the constant, not a literal

  - [ ] 35.6 Update quote token `aud` claim
    - The quote token's `aud` field must be `aws:base` (confirmed by the Agent Pay API example)
    - Verify `AgentPayServerScheme.enhancePaymentRequirements` uses the network from the registered kind (not hardcoded)

  - [ ] 35.7 Update transaction/payment ID format
    - Current: `aws:base:7f8e9d0c1b2a3456`
    - New: Agent Pay uses `awsmp-{UUIDv7}` — this is handled in Task 32.6
    - Ensure no code assumes `fab:` prefix in payment IDs

  **Risk:** Medium — the `fab:` prefix is baked into validation logic (`parseTransactionId`, `formatTransactionId`, `registerNetwork`). Those validators need to be relaxed or parameterized.

---

- [x] 36. Fix Auto-Capture Settlement Logic (Service-Side)

  **Priority: 6 — Bug fix**

  **Reported issue:** When `capture: "auto"` is set in the payment requirements, the service-side middleware/facilitator still attempts a `POST /capture` call after verification. Since Agent Pay auto-captures on `CreateAgentPayment`, there is no `/capture` endpoint — this results in a 404 error.

  **Correct behavior:** In auto-capture mode, the service side should ONLY perform payment token signature verification (public key check). No settlement/capture call should be made.

  **Subtasks:**

  - [ ] 36.1 Investigate and confirm the bug
    - Trace the code path: `agentPayMiddleware` → `x402ResourceServer.settlePayment` → facilitator `settle()`
    - Confirm that `capture: "auto"` in `extra` triggers a settle call
    - Identify where the conditional should be

  - [ ] 36.2 Fix the middleware auto-capture logic
    - In `src/middleware/express.ts`: when `capture === 'auto'`, skip the `settlePayment` call
    - The payment was already captured by Agent Pay during `CreateAgentPayment`
    - Only perform `verifyPayment` (signature check)

  - [ ] 36.3 Fix the facilitator `settle()` for auto-capture
    - In `AgentPayFacilitatorClient.settle()`: if the payment was auto-captured, return `{ success: true }` immediately without making an HTTP call
    - This is also addressed in Task 32.5 (Agent Pay has no `/capture` endpoint)

  - [ ] 36.4 Update spec requirements
    - Add APAY-MWR-007a: "When `capture` is `'auto'`, the middleware shall NOT call `settlePayment` — the payment was already captured by the Agent Pay Service during creation."
    - Update APAY-FAC-007 to clarify that settlement is a no-op for auto-captured payments

  - [ ] 36.5 Write tests
    - Test: auto-capture mode does NOT trigger a settle/capture HTTP call
    - Test: manual-capture mode still triggers settle (for future use if Agent Pay adds deferred capture)
    - Test: middleware returns 200 (not 500) for auto-capture payments

  **Risk:** Low — straightforward conditional. The fix aligns with the Agent Pay API reality (no separate capture step).

---

- [x] 37. Extend Quote Token Format: Description and Dimensions

  **Priority: 7 — Feature enhancement for release**

  Add two new optional fields to the quote token payload for richer billing context:
  1. `description` — free-text human-readable description of what's being charged for
  2. `dimensions` — key-value object describing the units/dimensions consumed (e.g., `{ "tokens": 1500, "model": "claude-4" }`)

  **Subtasks:**

  - [ ] 37.1 Update `QuoteTokenPayload` type
    ```typescript
    interface QuoteTokenPayload {
      // ... existing fields ...
      description?: string;           // Free-text description of the charge
      dimensions?: Record<string, string | number>;  // Key-value consumption dimensions
    }
    ```

  - [ ] 37.2 Update `AgentPayPaymentExtra` type
    - Add `description?: string` and `dimensions?: Record<string, string | number>` to the extra fields
    - These flow from the service's payment requirements config into the quote token

  - [ ] 37.3 Update `AgentPayServerScheme.enhancePaymentRequirements`
    - Read `description` and `dimensions` from `paymentRequirements.extra`
    - Include them in the quote token payload when present
    - Omit when not provided (keep backward compatible)

  - [ ] 37.4 Update spec requirements
    - Add APAY-TYP-008: `The system shall define optional 'description' (string) and 'dimensions' (Record<string, string | number>) fields in QuoteTokenPayload.`
    - Add APAY-SRV-018: `Where description is provided in payment requirements extra, the server scheme shall include it in the quote token payload.`
    - Add APAY-SRV-019: `Where dimensions is provided in payment requirements extra, the server scheme shall include it in the quote token payload.`

  - [ ] 37.5 Update middleware route config
    - Allow `description` and `dimensions` in route definitions:
      ```typescript
      routes: {
        'GET /api/premium': {
          price: 0.15,
          network: 'aws:base',
          description: 'Premium API access - 1 request',
          dimensions: { requests: 1, tier: 'premium' }
        }
      }
      ```

  - [ ] 37.6 Update mock server to echo description/dimensions
    - Include in the stored payment record
    - Return in `GetAgentPayment` response

  - [ ] 37.7 Write tests
    - Test: quote token includes description when provided
    - Test: quote token includes dimensions when provided
    - Test: quote token omits both when not provided (backward compat)
    - Test: dimensions with mixed string/number values

  - [ ] 37.8 Update documentation and examples
    - Add description/dimensions to README examples
    - Update spec.md data model examples
    - Update sdk-guide quote token structure section

  **Risk:** Low — additive, backward-compatible change. No existing behavior is modified.

---

## Release Task Dependencies

```
Task 31 (Terminology) ──────────────────────────────────────────────┐
                                                                     │
Task 32 (Agent Pay API) ─── depends on 31 ──────────────────────────┤
                                                                     │
Task 33 (DPoP Hardening) ─── depends on 31, 32 ────────────────────┤
                                                                     │
Task 34 (Client Token) ─── depends on 31, 32 ──────────────────────┤
                                                                     │
Task 35 (Network Identifier) ─── depends on 31 ────────────────────┤
                                                                     │
Task 36 (Auto-Capture Fix) ─── depends on 31, 32 ──────────────────┤
                                                                     │
Task 37 (Quote Extensions) ─── depends on 31 ──────────────────────┘
```

All tasks depend on Task 31 (terminology refactor) being completed first. Tasks 32-37 can be parallelized after 31, with the caveat that 33, 34, and 36 depend on the API shape established in 32.

---

- [x] 38. Rename Agent Pay → Agent Pay (Codebase-Wide)

  **Priority: Next — Required before release**

  Remove all references to "FAB" (Agent Pay) and rename to "Agent Pay" throughout the codebase. This is a branding alignment — the product is "AWS Marketplace Agent Pay", not "FAB".

  **Scope of changes:**

  **Directory rename:**
  - `src/fab/` → `src/agent-pay/`

  **Class/type renames:**
  - `FABScheme` → `AgentPayScheme`
  - `AgentPayClientScheme` → `AgentPayClientScheme` (re-export alias)
  - `AgentPayServerScheme` → `AgentPayServerScheme` (re-export alias)
  - `AgentPayFacilitatorScheme` → `AgentPayFacilitatorScheme` (re-export alias)
  - `AgentPayAWSClientScheme` → `AgentPayAWSClientScheme`
  - `AgentPayAWSServerScheme` → `AgentPayAWSServerScheme`
  - `AgentPayAWSFacilitatorScheme` → `AgentPayAWSFacilitatorScheme`
  - `AgentPayClientSchemeConfig` → `AgentPayClientSchemeConfig`
  - `AgentPayServerSchemeConfig` → `AgentPayServerSchemeConfig`
  - `AgentPayFacilitatorSchemeConfig` → `AgentPayFacilitatorSchemeConfig`
  - `FABResourceServer` → `AgentPayResourceServer`
  - `FABResourceServerOptions` → `AgentPayResourceServerOptions`
  - `FABResourceServerConfig` → `AgentPayResourceServerConfig`
  - `FABClientOptions` → `AgentPayClientOptions`
  - `FABClientConfig` → `AgentPayClientConfig`
  - `FABClient` → `AgentPayClient` (builder return type)
  - `FABMiddlewareConfig` → `AgentPayMiddlewareConfig`
  - `FABRouteConfig` → `AgentPayRouteConfig`
  - `FABRoutesConfig` → `AgentPayRoutesConfig`
  - `AgentPayPaymentExtra` → `AgentPayPaymentExtra`
  - `AgentPayPayloadV2` → `AgentPayPayloadV2`
  - `FABSettlement` → `AgentPaySettlement`
  - `FABSupport` → `AgentPaySupport`
  - `FABTerms` → `AgentPayTerms`
  - `AgentPayError` → `AgentPayError`

  **Constant renames:**
  - `AGENT_PAY_SCHEME = 'fab'` → `AGENT_PAY_SCHEME = 'aws:base'`
  - `AGENT_PAY_CAIP_FAMILY = 'fab:*'` → `AGENT_PAY_CAIP_FAMILY = 'aws:*'`
  - `AGENT_PAY_SENTINEL_PAY_TO = 'urn:x402:agent-pay:see-quote'` → `AGENT_PAY_SENTINEL_PAY_TO = 'urn:x402:agent-pay:see-quote'`

  **Function renames:**
  - `createAgentPayResourceServer` → `createAgentPayResourceServer`
  - `createAgentPayClient` → `createAgentPayClient`
  - `buildAgentPayResourceServer` → `buildAgentPayResourceServer`
  - `buildAgentPayClient` → `buildAgentPayClient`
  - `registerAgentPayNetworks` → `registerAgentPayNetworks`
  - `agentPayMiddleware` → `agentPayMiddleware`

  **Variable renames (in code):**
  - `fabPayload` → `agentPayPayload`
  - `fabClient` → `agentPayClient`
  - `fabServer` → `agentPayServer`
  - `fabFacilitator` → `agentPayFacilitator`
  - `fabClientScheme` → `agentPayClientScheme`

  **Package:**
  - `aws-agent-pay-x402` → `aws-agent-pay-x402`
  - Package description updated

  **Wire-format changes:**
  - x402 scheme identifier: `"fab"` → `"aws:base"`
  - Sentinel payTo: `"urn:x402:agent-pay:see-quote"` → `"urn:x402:agent-pay:see-quote"`
  - CAIP family: `"fab:*"` → `"aws:*"`

  **Import path changes:**
  - All imports from `./fab/` → `./agent-pay/`
  - Package sub-path exports: `aws-agent-pay-x402/client`, `/server`, `/facilitator`

  **Documentation:**
  - All .md files: replace Agent Pay terminology with Agent Pay
  - Spec requirement IDs: `FAB-*` → `APAY-*`
  - Update all code examples in docs

  **Test files:**
  - Update all test descriptions and variable names
  - Update scheme identifier assertions from `'fab'` to `'aws:base'`

  **Execution steps:**
  1. Rename `src/fab/` directory → `src/agent-pay/`
  2. Sed replace all identifiers (classes, types, constants, functions, variables)
  3. Update import paths
  4. Update package.json (name, exports, description)
  5. Update tsup.config.ts entry points
  6. Update all documentation
  7. Run `npx tsc --noEmit` — fix any TypeScript errors
  8. Run `npx vitest run` — fix any test failures
  9. Run `npx tsup` — verify build
  10. Verify examples load

  **Risk:** High — 1100+ references across 80+ files. Mechanically straightforward but large surface area. Must be done in one pass to avoid partial states.

  **Breaking changes:** Yes — this changes the x402 scheme identifier from `"fab"` to `"aws:base"`, the package name, and all public API names. Any existing consumers would need to update imports.

---

- [ ] 39. Verify Naming Decisions with Business

  **Priority: Immediate (parallel with Task 38)**

  Confirm the following naming/branding decisions with the business team before or immediately after the rename ships:

  | Decision | Current Value | Question |
  |----------|---------------|----------|
  | x402 scheme identifier | `"aws:base"` | Is this the final wire-format string? Once shipped, changing it is a breaking protocol change. |
  | Package name | `aws-agent-pay-x402` | Confirmed? Alternatives: `@x402/agent-pay`, `@aws/agent-pay-x402` |
  | Network identifier | `"aws:base"` (same as scheme) | Is scheme = network intentional? In x402, these are typically different (e.g., scheme=`"exact"`, network=`"eip155:8453"`). |
  | Sentinel URN | `"urn:x402:agent-pay:see-quote"` | Any concerns with this format? |
  | CAIP family | `"aws:*"` | Does this conflict with any other AWS x402 schemes? |
  | Public class names | `AgentPayClientScheme`, `AgentPayServerScheme`, etc. | Any preference for shorter names? |
  | Service branding | "Agent Pay" vs "Agent Pay" vs "AWS Marketplace Agent Pay" | Which is the canonical short name for developer-facing docs? |

  **Action items:**
  - [ ] Schedule review with product/business owner
  - [ ] Document decisions in this task
  - [ ] If any values change, create a follow-up task for the rename

  **Risk:** Low — this is a documentation/confirmation task. If decisions change, the rename is mechanical (same process as Task 38).

---

- [ ] 40. Express Middleware Enhancement

  **Priority: Medium — Useful for release but core is already working**

  The core `agentPayMiddleware` is implemented (`src/middleware/express.ts`) with 15 unit tests. This task covers enhancements for production readiness.

  **What's already done:**
  - Route matching (exact, wildcard, method-agnostic)
  - 402 response generation with quote token
  - Payment verification via x402ResourceServer
  - `req.agentPayPayment` attachment after verification
  - Lazy server initialization
  - `onPaymentVerified` and `onPaymentSettled` hooks
  - `onError` custom error handler
  - Validation (empty networks/routes throws)
  - 15 unit tests passing

  **What remains:**

  - [ ] 40.1 Add request logging/observability
    - Log payment attempts (success/failure) with structured data
    - Support custom logger injection (e.g., pino, winston)
    - Include correlation IDs for tracing

  - [ ] 40.2 Add payment storage abstraction
    - Define `PaymentStore` interface (save, get, list)
    - In-memory implementation for development
    - Document Redis/DynamoDB integration patterns

  - [ ] 40.3 Add rate limiting support
    - Per-client rate limiting based on payer identity
    - Configurable limits per route
    - 429 response with Retry-After header

  - [ ] 40.4 Add idempotency tracking on the seller side
    - Track processed paymentIds to prevent double-delivery
    - Return cached response for duplicate payment presentations

  - [ ] 40.5 Add health check endpoint option
    - Optional `/health` or `/_agent-pay/health` endpoint
    - Reports middleware status, server initialization state

  - [ ] 40.6 Create production example
    - Full Express app with middleware, error handling, logging
    - Show integration with a real route handler
    - Demonstrate description/dimensions in route config

  **Risk:** Low — all additive, no breaking changes to existing middleware API.

---

- [x] 41. Implement Real AWS SigV4 Authentication

  **Priority: High — Required for production (current implementation is a placeholder)**

  The current `AwsSigV4Authenticator` in `src/auth/aws-sigv4.ts` generates a fake `Authorization` header with `Signature=placeholder`. It does NOT compute the actual SigV4 signature. This must be replaced with a real implementation before the SDK can talk to the production Agent Pay Service.

  **Dependencies to add:**
  - `@smithy/signature-v4` — AWS SigV4 signing logic (used by all AWS SDKs)
  - `@aws-crypto/sha256-js` — SHA-256 hash implementation required by `@smithy/signature-v4`

  **Current state (`src/auth/aws-sigv4.ts`):**
  - Constructor validates region, credentials/provider
  - `authenticate()` adds `Authorization`, `x-amz-date`, `host`, `x-amz-security-token` headers
  - BUT the `Authorization` header value is `AWS4-HMAC-SHA256 Credential=.../aws4_request, SignedHeaders=host;x-amz-date, Signature=placeholder`
  - The signature is NOT computed — it's a literal string "placeholder"

  **Implementation plan:**

  - [ ] 41.1 Add dependencies
    ```bash
    npm install @smithy/signature-v4 @aws-crypto/sha256-js @smithy/types
    ```
    These are lightweight (no full AWS SDK needed). `@smithy/signature-v4` is the same signing library used by `@aws-sdk/client-*` packages.

  - [ ] 41.2 Rewrite `signRequest()` in `src/auth/aws-sigv4.ts`
    Replace the placeholder with actual SigV4 signing:
    ```typescript
    import { SignatureV4 } from '@smithy/signature-v4';
    import { Sha256 } from '@aws-crypto/sha256-js';
    import { HttpRequest } from '@smithy/protocol-http';

    private signer: SignatureV4;

    constructor(config: AwsSigV4AuthConfig) {
      // ... existing validation ...
      this.signer = new SignatureV4({
        service: this.service,
        region: this.region,
        credentials: {
          accessKeyId: credentials.accessKeyId,
          secretAccessKey: credentials.secretAccessKey,
          sessionToken: credentials.sessionToken,
        },
        sha256: Sha256,
      });
    }

    private async signRequest(request: AuthenticatedRequest): Promise<Record<string, string>> {
      const url = new URL(request.url);
      const httpRequest = new HttpRequest({
        method: request.method,
        hostname: url.hostname,
        port: url.port ? parseInt(url.port) : undefined,
        path: url.pathname + url.search,
        headers: {
          host: url.host,
          'content-type': 'application/json',
          ...request.headers,
        },
        body: request.body,
      });

      const signed = await this.signer.sign(httpRequest);
      return signed.headers;
    }
    ```

  - [ ] 41.3 Support credential providers (async resolution)
    The `@smithy/signature-v4` `SignatureV4` constructor accepts a `credentials` field that can be a static object or a provider function. Wire up the existing `credentialProvider` option:
    ```typescript
    credentials: this.staticCredentials
      ? this.staticCredentials
      : async () => {
          const creds = await this.credentialProvider!();
          return {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
          };
        },
    ```

  - [ ] 41.4 Update tests in `test/unit/auth/aws-sigv4.test.ts`
    - Verify the `Authorization` header contains a real computed signature (not "placeholder")
    - Verify the signature changes when the request body changes
    - Verify the signature changes when the URL changes
    - Verify session token is included in signed headers
    - Keep existing tests for constructor validation, credential caching, etc.

  - [ ] 41.5 Integration test with mock Agent Pay server
    - Send a signed request to the mock server
    - Mock server validates the `Authorization` header format (AWS4-HMAC-SHA256 with real signature)
    - Verify the request is accepted

  - [ ] 41.6 Update documentation
    - Remove "simplified placeholder" warnings from README, sdk-guide, known limitations
    - Document that `@smithy/signature-v4` is used under the hood
    - Update security.md to note real SigV4 signing

  - [ ] 41.7 Update package.json dependencies
    - Add `@smithy/signature-v4`, `@aws-crypto/sha256-js`, `@smithy/protocol-http` to `dependencies`
    - Verify bundle size impact (these are lightweight — ~50KB total)

  **Files modified:**
  - `src/auth/aws-sigv4.ts` (rewrite signRequest)
  - `test/unit/auth/aws-sigv4.test.ts` (update assertions)
  - `package.json` (add dependencies)
  - `README.md`, `docs/sdk-guide.md`, `docs/security.md` (remove placeholder warnings)

  **Risk:** Low — the interface (`authenticate(request) → signedRequest`) stays the same. Only the internal signing logic changes. All existing tests for the public API continue to work.

  **Note:** Examples can skip authentication (the mock server accepts unauthenticated requests for local testing). The SDK must support real SigV4 for production use.

---

- [ ] 42. OIDC Discovery Implementation

  **Priority: Low — Not required for launch (Agent Pay doesn't use OIDC discovery)**

  The `discoverAgentPayEndpoints()` function in `src/discovery.ts` fetches `/.well-known/openid-configuration` but the Agent Pay Service does not expose this endpoint. Direct JWKS fetching (`/.well-known/jwks.json`) works fully and is what the SDK uses in practice.

  **Current state:**
  - `discoverAgentPayEndpoints()` — implemented, fetches OIDC doc, caches 24h. Works if the endpoint exists.
  - `fetchAgentPayPublicKeys()` — depends on `discoverAgentPayEndpoints()` to get `jwks_uri`. If OIDC isn't available, this fails.
  - `fetchServiceJWKS()` — independent, fetches JWKS directly from `{url}/.well-known/jwks.json`. This is what the facilitator verify logic uses.
  - The `AgentPayDiscoveryMetadata` interface defines the expected OIDC response shape.

  **What remains:**

  - [ ] 42.1 Decide: remove or keep OIDC discovery
    - Option A: Remove `discoverAgentPayEndpoints()` and `fetchAgentPayPublicKeys()` entirely (Agent Pay doesn't use OIDC)
    - Option B: Keep as optional — if the endpoint exists, use it; if not, fall back to direct JWKS
    - Option C: Keep as-is (stub that works if endpoint exists, errors if not)

  - [ ] 42.2 If keeping (Option B): Add fallback logic
    - `fetchAgentPayPublicKeys()` should try OIDC first, fall back to direct `/.well-known/jwks.json`
    - Add `skipOidc` option to bypass discovery entirely
    - Update caching to handle both paths

  - [ ] 42.3 If removing (Option A): Clean up exports
    - Remove `discoverAgentPayEndpoints`, `fetchAgentPayPublicKeys` from `src/index.ts`
    - Remove `AgentPayDiscoveryMetadata` type export
    - Keep `clearDiscoveryCache`, `clearJWKSCache` (still useful for direct JWKS cache)
    - Update docs and spec to remove OIDC references

  - [ ] 42.4 Update tests
    - Remove or update `test/unit/discovery.test.ts` OIDC-specific tests
    - Ensure direct JWKS fetching tests remain

  **Risk:** Low — OIDC discovery is not used by any code path in the current SDK. Removing it simplifies the API surface. Keeping it adds future flexibility if Agent Pay ever exposes OIDC.

---

- [ ] 43. Zod Runtime Validation Schemas

  **Priority: Low — TypeScript types provide compile-time safety; Zod adds runtime safety**

  TypeScript types (`QuoteTokenPayload`, `AgentPayPaymentExtra`, `AgentPayPayloadV2`, etc.) are fully defined and enforced at compile time. Zod schemas would add runtime validation for untrusted input (e.g., parsing 402 responses from unknown services, validating webhook payloads).

  **Current state:**
  - `zod@^3.22.4` is already a dependency (installed but barely used)
  - Types are defined in `src/types.ts`
  - No Zod schemas are wired into the request/response parsing paths
  - Input validation happens ad-hoc (manual checks in constructors, `if (!field) throw`)

  **What remains:**

  - [ ] 43.1 Define Zod schemas for core types
    ```typescript
    // src/schemas/quote-token.ts
    export const QuoteTokenPayloadSchema = z.object({
      iss: z.string().url(),
      aud: z.union([z.string(), z.array(z.string())]),
      iat: z.number().int().positive(),
      exp: z.number().int().positive(),
      jti: z.string().min(1),
      price: z.union([QuoteTokenPriceSchema, z.array(QuoteTokenPriceSchema)]),
      payTo: z.string().min(1),
      reference: z.string(),
      description: z.string().optional(),
      dimensions: z.record(z.union([z.string(), z.number()])).optional(),
      settlement: AgentPaySettlementSchema.optional(),
      support: AgentPaySupportSchema.optional(),
      terms: z.array(AgentPayTermsSchema).optional(),
    });
    ```

  - [ ] 43.2 Define Zod schemas for API request/response types
    - `CreateAgentPaymentRequestSchema`
    - `CreateAgentPaymentResponseSchema`
    - `DpopJwkSchema`

  - [ ] 43.3 Define Zod schemas for payment payload
    - `AgentPayPayloadV2Schema`
    - `AgentPayPaymentExtraSchema`

  - [ ] 43.4 Wire schemas into parsing paths
    - `decodeQuoteToken()` — validate decoded JWT payload against `QuoteTokenPayloadSchema`
    - `DefaultAgentPayClient.createPayment()` — validate response against `CreateAgentPaymentResponseSchema`
    - `agentPayMiddleware` — validate incoming payment payload structure

  - [ ] 43.5 Add `parse` and `safeParse` utility exports
    ```typescript
    export function parseQuoteToken(token: string): QuoteTokenPayload {
      const decoded = jose.decodeJwt(token);
      return QuoteTokenPayloadSchema.parse(decoded);
    }

    export function safeParseQuoteToken(token: string): z.SafeParseReturnType<...> {
      const decoded = jose.decodeJwt(token);
      return QuoteTokenPayloadSchema.safeParse(decoded);
    }
    ```

  - [ ] 43.6 Write tests for schema validation
    - Valid payloads pass
    - Missing required fields fail with descriptive errors
    - Invalid types fail (e.g., `iat` as string)
    - Extra fields are stripped or passed through (decide on strict vs. passthrough)

  - [ ] 43.7 Update documentation
    - Document schema exports in README
    - Add usage examples for runtime validation
    - Update spec with schema validation requirements

  **Risk:** Low — additive feature. Existing code continues to work without Zod validation. Schemas are opt-in for consumers who want runtime safety.

  **Decision needed:** Should Zod validation be enforced by default (breaking — rejects malformed input that currently passes) or opt-in (non-breaking — consumers call `parseQuoteToken` instead of `decodeQuoteToken` when they want validation)?
