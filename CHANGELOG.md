# Changelog

All notable changes to this package are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this package
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The public API is the set of
names exported from `@aws/fiat-extension-for-x402` and its `./agentic-commerce/exact` sub-path;
removing or renaming any of them, or narrowing a supported range, needs a new major version.

## [Unreleased]

### Security

- **The verified payment id reaches `onAfterVerify`.** The facilitator scheme and
  `AgenticCommerceFacilitatorClient` return a valid payment's `payment_id` as `extra.paymentId` of
  the verify response, so a seller can record it before serving the request (see
  `docs/security.md`). The payment payload's own `paymentId` is set by the buyer and is not this id.
- **The quote must be for this route.** The facilitator scheme and
  `AgenticCommerceFacilitatorClient` now require the accepted quote's `iss`, `aud`, `payTo`,
  `settlement` and `reference` to equal those of the quote the server signed for the request, so a
  quote for another route, or from another service sharing the seller's key, is refused with
  `invalid_quote` (`Quote does not match this route`). `VerificationRequirements` gains the
  optional `routeQuote` for this check.
- **No key fetch for a malformed or misdirected token.** `AgenticCommerceVerifier` checks the
  payment token's shape, `alg`, `kid`, issuer, expiry, `payment_id` and quote before fetching any
  key, and again after verifying its signature.
- **The payment service JWKS is cached.** It is kept for a minute per verifier; a `kid` the cached
  set lacks refetches it at most every 30 seconds, and concurrent fetches share one request. A
  revoked service key is now refused within a minute rather than at once.
- **JWKS responses are capped at 64 KiB.**

### Changed

- A payment token must have a `kid` in its header and a `payment_id` claim; one without either is
  `invalid_payment`. Every token the payment service issues has both. `paymentId` is therefore
  always set on a valid `VerificationResult`.

### Documentation

- [Payment replay](docs/security.md#payment-replay): verification is stateless, so a seller must
  record each `paymentId` in a store shared by all its instances and accept each payment once.

### Removed

- The repository's `SECURITY.md` and Dependabot configuration, which the GitHub organization now
  provides. Report a vulnerability through
  [AWS vulnerability reporting](https://aws.amazon.com/security/vulnerability-reporting/).

## [1.0.0] - 2026-10-16

Initial release: the seller and facilitator roles of AWS Marketplace Agentic Commerce on x402, built
on the stock `@x402/core` resource server and facilitator. Requires Node.js 20.19 or later and
`@x402/core` `>=2.23.0 <3` (a peer dependency).

### Added

- **`exact` server scheme.** `ExactAgenticCommerceServerScheme` implements `@x402/core`'s
  `SchemeNetworkServer` for the `exact` scheme with the `payment-token` asset transfer method. It
  signs a quote token (including the AWS Marketplace product ID) for each route and verifies the
  buyer's DPoP proof when the payment token is DPoP-bound (`cnf.jkt`). Options: `signer`,
  `dpopNonceStore` and `dpopMaxAgeSeconds` (default 60).
  `registerExactAgenticCommerceServer(server, { signer, networks })` registers one instance on
  each network (default `aws:base`). Routes are protected with x402's own middleware, for example
  `paymentMiddleware` from `@x402/express`.
- **`exact` facilitator scheme.** `ExactAgenticCommerceFacilitatorScheme` verifies and settles
  payments in process with an `AgenticCommerceVerifier`.
- **`AgenticCommerceVerifier`**, the single check behind every payment. It verifies the payment
  token against the payment service JWKS, then the issuer, expiry, the embedded quote (it must be
  the quote the buyer accepted, signed with the seller's key), the audience, the quote's expiry,
  the price and currency, and the product. It never throws for an invalid payment: it returns one
  of the `AgenticCommerceInvalidReason` values with a message.
- **Seller key resolvers** (`SellerKeyResolver`): a KMS key, a JWKS URL, or a static public key.
  One is required; the seller key is never taken from the quote itself.
- **`AgenticCommerceFacilitatorClient`**, an HTTP facilitator client configured with one object
  (`baseUrl`, `sellerKeyResolver`, `getAuthHeaders`, `networkFilter`, `paymentTokenJwksUrl`), and
  `InProcessFacilitatorClient` for a facilitator in the seller's own process.
- **Quote signers.** `KmsQuoteSigner` signs with an AWS KMS key. `LocalQuoteSigner` signs with an
  EC (P-256, P-384, P-521) or RSA (2048 bits or more) private key you hold;
  `LocalQuoteSigner.fromPem` loads PKCS #8, SEC 1 or PKCS #1 PEM, encrypted or not, with
  `FromPemOptions` (`kid`, `serviceUrl`, `password`). `jwksDocument` builds the JWKS document a
  seller publishes for its quote-signing keys.
- **Route prices** as a string (`'$0.01'`), a number, or `{ amount, asset }`, where `amount` is a
  plain decimal string with at most 8 decimal places and `asset` is `iso4217:` and an upper-case
  three-letter code. Any other price is a `ValidationError`, never a signed quote.
- **Errors:** `AgenticCommerceError` and its subclasses, including `ValidationError`,
  `SignatureError`, `ExpiryError` and `SigningError`.
- The `./agentic-commerce/exact` sub-path, which exports the two `exact` schemes, the register
  helper and their option types.
- Both entry points ship ESM and CommonJS builds, each with its own type declarations, and the
  package declares `"sideEffects": false`.

### Security

- A payment token is accepted only for the quote it was issued for, signed by the seller's own
  key, for the route's price, currency and product.
- DPoP-bound payment tokens are refused without a valid proof for the request.
- Payment-token and quote signatures are limited to RS256, ES256, ES384 and ES512
  (`ALLOWED_ALGORITHMS`, frozen).
- A DPoP proof's `jti` is recorded in the `DPoPNonceStore` only after the facilitator has accepted
  the payment token (in the `onAfterVerify` scheme hook), with the expiry
  `iat + floor(maxAge + 5) + 1`, the second after the proof stops passing the freshness check. A
  forged token adds nothing to the store, and a replayed proof is refused with `dpop_invalid`.
- An error for a JWK that cannot be imported names the key by its `kid` and never includes the
  key's members.

[Unreleased]: https://github.com/aws/fiat-extension-for-x402/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/aws/fiat-extension-for-x402/releases/tag/v1.0.0
