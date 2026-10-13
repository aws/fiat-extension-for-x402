# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The public API is the set of
names exported from `@aws/fiat-extension-for-x402` and its `./agentic-commerce/exact` sub-path;
removing or renaming any of them, or narrowing a supported range, needs a new major version.

## [1.0.0] - Unreleased

The first stable release, and the first published to npm. Version 0.1.0 was never published. This
release keeps only the seller and facilitator roles of AWS Marketplace Agentic Commerce on x402,
built on the stock `@x402/core` server and facilitator.

### Added

- **`exact` server scheme.** `ExactAgenticCommerceServerScheme` implements `@x402/core`'s
  `SchemeNetworkServer` for the `exact` scheme with the `payment-token` asset transfer method.
  It signs a quote token for each route and verifies the buyer's DPoP proof when the payment
  token is DPoP-bound (`cnf.jkt`), before the facilitator is called. Options: `signer`,
  `dpopNonceStore` and `dpopMaxAgeSeconds` (default 60).
  `registerExactAgenticCommerceServer(server, { signer, networks })` registers one instance on
  each network (default `aws:base`).
- **`exact` facilitator scheme.** `ExactAgenticCommerceFacilitatorScheme` verifies and settles
  payments in process with an `AgenticCommerceVerifier`.
- **`AgenticCommerceVerifier`**, the single check behind every payment. It verifies the payment
  token against the payment service JWKS, then the issuer, expiry, the embedded quote (it must be
  the quote the buyer accepted, signed with the seller's key), the audience, the quote's expiry,
  the price and currency, and the product. It never throws for an invalid payment: it returns
  one of the `AgenticCommerceInvalidReason` values with a message.
- **Seller key resolvers** (`SellerKeyResolver`): a KMS key, a JWKS URL, or a static public key.
  One is required; the seller key is never taken from the quote itself.
- **`AgenticCommerceFacilitatorClient`**, an HTTP facilitator client configured with one object
  (`baseUrl`, `sellerKeyResolver`, `getAuthHeaders`, `networkFilter`, `paymentTokenJwksUrl`).
- **Bring your own key.** `LocalQuoteSigner` signs quotes with an EC (P-256, P-384, P-521) or
  RSA (2048 bits or more) private key; `LocalQuoteSigner.fromPem` loads PKCS #8, SEC 1 or
  PKCS #1 PEM, encrypted or not. `KmsQuoteSigner` signs with an AWS KMS key. `jwksDocument`
  builds the JWKS document a seller publishes for its quote-signing keys.
- **`SigningError`** for signer failures.
- The `./agentic-commerce/exact` sub-path, which exports the two `exact` schemes, the register
  helper and their option types.
- Both entry points ship ESM and CommonJS builds, each with its own type declarations, and the
  package declares `"sideEffects": false`.

### Changed

- **Breaking:** the package is named `@aws/fiat-extension-for-x402`.
- **Breaking:** Node.js 20.19 or later is required (was 18).
- **Breaking:** `@x402/core` is a peer dependency in the range `>=2.23.0 <3` (was `^2.0.0`).
- **Breaking:** every "Agent Pay" name is now an "Agentic Commerce" name, for example
  `AgentPayError` is `AgenticCommerceError`, `AgentPayFacilitatorClient` is
  `AgenticCommerceFacilitatorClient` and `AGENT_PAY_SENTINEL_PAY_TO` is `SENTINEL_PAY_TO`. Also
  renamed: `PAYMENT_JWT_ISSUER` is `PAYMENT_TOKEN_ISSUER`, `KmsSignerConfig` is
  `KmsQuoteSignerConfig`, and `ServiceAgentPaySigner` is `QuoteSigner`. The `payTo` sentinel
  value is `urn:x402:agentic-commerce:see-quote`.
- **Breaking:** the facilitator client and the verifier (which the facilitator scheme takes)
  require a seller key resolver, and no longer fetch `{iss}/.well-known/jwks.json` from the quote.
- **Breaking:** `AgenticCommerceFacilitatorClient` takes a single config object, requires a base
  URL (there is no default host), and its `verify` takes no third `requestContext` argument.
- **Breaking:** the verifier requires `quote_token` at the top level of the payment token and no
  longer falls back to `payment_context.quote_token`.
- **Breaking:** `settle` reports the payment token's `payment_id`.
- **Breaking:** `verifyQuoteToken` and `verifyPaymentToken` accept only the algorithms in
  `ALLOWED_ALGORITHMS`; they used to accept any algorithm the key allowed.
- **Breaking:** `verifyQuoteToken` and `verifyPaymentToken` report a correctly signed but expired
  token as `ExpiryError`, with `expiry` and `currentTime`; they used to report it as
  `SignatureError`, and `ExpiryError` is not a `SignatureError`.
- **Breaking:** `QuoteSigner` no longer has `getPublicKey()`. `KmsQuoteSigner` is a class; it
  requires `serviceUrl` and throws `SigningError`.
- **Breaking:** `verifyDPoPProof` compares `htm` exactly (pass the method upper-cased) and
  allows 5 seconds of clock skew on the maximum age.
- **Breaking:** `ALLOWED_ALGORITHMS` is a frozen `readonly string[]`, so no code in the process
  can widen the algorithms every verifier accepts.
- The facilitator client no longer sends a fixed access header with JWKS requests.

### Removed

- **Breaking:** the buyer side: the client scheme and the `./agent-pay/client` sub-path,
  `DefaultAgentPayClient`, the client builders, request signing, DPoP key generation and proof
  creation, endpoint discovery (`fetchAgentPayPublicKeys`, `clearJWKSCache`,
  `clearDiscoveryCache`), and their types and schemas.
- **Breaking:** the Express middleware (`./middleware/express`), the resource-server builders,
  `registerAgentPayNetworks` and the AWS network presets. Use x402's own middleware for your
  framework with an `x402ResourceServer` and the `exact` server scheme.
- **Breaking:** the `agent-pay` server and facilitator schemes and their sub-paths
  (`./agent-pay/server`, `./agent-pay/facilitator`), replaced by the `exact` schemes.
- **Breaking:** `AGENT_PAY_SCHEME` (use `SCHEME_EXACT`), `DEFAULT_AGENT_PAY_BASE_URL`,
  `WELL_KNOWN_OIDC_PATH`, `IdempotencyConflictError`, `SigningKeysConfig`,
  `VerifyRequestContext`, `DPoPKeyPair` and `DPoPProofOptions`.
- **Breaking:** the KMS signer factory `createKmsSigner` (use `new KmsQuoteSigner(config)`) and
  the loose signer interface `ServiceAgentPaySignerInterface` (use `QuoteSigner`).
- **Breaking:** the `jose` key-pair adapters `toServiceAgentPaySigner` and `toAgentPaySigner`,
  and the `AgentPaySigner` type. Sign quotes with `LocalQuoteSigner` (a key you hold) or
  `KmsQuoteSigner`; payment tokens are signed by the payment service, not by this package.
- **Breaking:** the quote-issuer JWKS helpers `fetchServiceJWKS` and `clearServiceJWKSCache`.
  Seller keys come from a configured `SellerKeyResolver`.
- **Breaking:** the transaction ID helpers `generateTransactionId`, `parseTransactionId`,
  `formatTransactionId`, `isValidTransactionId` and `extractNetworkFromTransactionId`, and
  `extractQuoteFromPayment`. Payments are identified by the payment token's `payment_id`.
- **Breaking:** the `transactionId` field of `AgenticCommercePayloadV2` (and of its schema; use
  `paymentId`), and the `payment_context` field of `PaymentTokenPayload` with its
  `PaymentContext` type (payment tokens carry their fields at the top level).
- **Breaking:** the constants `SETTLEMENT_METHODS`, `SETTLEMENT_CYCLES`,
  `DEFAULT_QUOTE_VALIDITY_SECONDS`, `DEFAULT_PAYMENT_VALIDITY_SECONDS`, `AGENT_PAY_AUDIENCE`,
  `AGENT_PAY_JWKS_BASE_URL`, `WELL_KNOWN_JWKS_PATH` and `WELL_KNOWN_X402_SUPPORTED_PATH`. The
  values the package needs are internal; the `SettlementMethod` and `SettlementCycle` types
  remain.

### Security

- A payment token is accepted only for the quote it was issued for, signed by the seller's own
  key, for the route's price, currency and product. Earlier versions accepted a genuine payment
  token issued for a different quote or product.
- DPoP-bound payment tokens are refused without a valid proof for the request.
- Payment-token and quote signatures are limited to RS256, ES256, ES384 and ES512.
- A DPoP proof's `jti` is added to the `DPoPNonceStore` with the expiry
  `iat + floor(maxAge + 5) + 1`, the second after the proof stops passing the freshness check.
  The expiry used to be `iat + maxAge`, which ignored the 5 seconds of clock skew, so a store
  that forgot ids on time let the same proof be replayed for up to 6 seconds.
- A JWK that cannot be imported is reported as `JWK <kid>: invalid key material` (`JWK: invalid
  key material` when its `kid` is not a string). Some of these errors used to contain the whole
  JWK, and the message reaches the facilitator's `invalidMessage`, so a JWKS published with
  private key members would have exposed them.

[1.0.0]: https://github.com/aws/fiat-extension-for-x402/releases/tag/v1.0.0
