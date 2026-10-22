# Fiat Extension for x402: SDK Guide

**Package:** `@aws/fiat-extension-for-x402` 1.0.0 **Peer dependency:** `@x402/core >=2.23.0 <3` (the
`exact` scheme needs core's `dynamicExtraFields` and `paymentFlows`) **Runtime:** Node.js 20.19 or
later

This guide describes how the package fits into x402, the tokens it signs and verifies, and every
check it makes. The [README](../README.md) covers setup.

## Contents

1. [How x402 is organised](#1-how-x402-is-organised)
2. [What this package adds](#2-what-this-package-adds)
3. [The payment flow](#3-the-payment-flow)
4. [Tokens](#4-tokens)
5. [Checks](#5-checks)
6. [Reference](#6-reference)

## 1. How x402 is organised

`@x402/core` implements HTTP 402 Payment Required for machine-to-machine payments. It has three
roles, each a core class with a scheme interface that extensions implement:

| Role            | Core class                                               | Scheme interface           | Purpose                                                                     |
| --------------- | -------------------------------------------------------- | -------------------------- | --------------------------------------------------------------------------- |
| Resource server | `x402ResourceServer`                                     | `SchemeNetworkServer`      | Protects routes: builds the 402 requirements, verifies and settles payments |
| Client (buyer)  | `x402Client`                                             | `SchemeNetworkClient`      | Reads a 402 and pays                                                        |
| Facilitator     | `x402Facilitator`, reached through a `FacilitatorClient` | `SchemeNetworkFacilitator` | Verifies and settles payments for the resource server                       |

Each core class keeps a registry of `(network, scheme)` pairs, filled with
`register(network, scheme)`. A payment is handled by the scheme registered for its requirements'
network. This package implements the resource-server and facilitator schemes; it has no client
scheme.

`x402ResourceServer` takes one or more `FacilitatorClient`s. On `initialize()` it asks each for its
supported kinds and routes every `(scheme, network)` pair to the first facilitator that claims it.

## 2. What this package adds

AWS Marketplace Agentic Commerce settles x402 payments in fiat. No transaction is on chain: two
signed JWTs are the proof of payment.

| Token         | Signed by           | Says                                                                     |
| ------------- | ------------------- | ------------------------------------------------------------------------ |
| Quote token   | The seller          | "This route costs 0.01 USD for product X, until time T."                 |
| Payment token | The payment service | "Buyer B has paid for this quote." It carries the quote and a payment ID |

| Export                                                             | Role                                                                                                                                          |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `ExactAgenticCommerceServerScheme`                                 | `SchemeNetworkServer` for scheme `exact`, asset transfer method `payment-token`. Parses fiat prices, signs a quote into each 402, checks DPoP |
| `registerExactAgenticCommerceServer`                               | Registers one server scheme on each network (default `aws:base`)                                                                              |
| `ExactAgenticCommerceFacilitatorScheme`                            | `SchemeNetworkFacilitator` for scheme `exact` on `aws:*`. Verifies with an `AgenticCommerceVerifier`; settle is a no-op                       |
| `AgenticCommerceVerifier`                                          | The check behind every payment (section 5)                                                                                                    |
| `InProcessFacilitatorClient`                                       | A `FacilitatorClient` over an `x402Facilitator` in the same process                                                                           |
| `AgenticCommerceFacilitatorClient`                                 | A `FacilitatorClient` that reads supported kinds from an Agentic Commerce provider and verifies locally                                       |
| `KmsQuoteSigner`, `LocalQuoteSigner`, `QuoteSigner`                | Quote signing with a KMS key, a key you hold, or your own implementation                                                                      |
| `jwksDocument`                                                     | Builds the JWKS a seller serves at `/.well-known/jwks.json`                                                                                   |
| `SellerKeyResolver`                                                | Where the verifier finds the seller's key: KMS, a JWKS URL, or a static JWK                                                                   |
| `verifyDPoPProof`, `extractDPoPThumbprint`, `computeJWKThumbprint` | The DPoP checks the server scheme uses, for a scheme of your own                                                                              |

The `./agentic-commerce/exact` sub-path exports the two schemes, the register helper and their
option types.

## 3. The payment flow

[payment-flow.mmd](payment-flow.mmd) has the same sequence as a Mermaid diagram.

```
Buyer                       Seller (resource server)          Payment service
  |                                  |                                |
  |-- GET /weather ----------------->|                                |
  |                                  | sign quote (seller key)        |
  |<-- 402, PAYMENT-REQUIRED --------|                                |
  |    accepts[0].extra.quoteToken   |                                |
  |                                  |                                |
  |-- obtain a payment token for the quote ------------------------->|
  |<-- payment token (signed, carries the quote and payment_id) -----|
  |                                  |                                |
  |-- GET /weather, PAYMENT-SIGNATURE, DPoP (if bound) ------------->|
  |                                  | DPoP check (server scheme)     |
  |                                  | verify (facilitator):          |
  |                                  |   payment service JWKS ------->|
  |                                  |   seller key (configured)      |
  |                                  | settle: no-op, payment_id      |
  |<-- 200 + resource, PAYMENT-RESPONSE                               |
```

1. An unpaid request reaches x402's middleware. The server scheme parses the route price into a
   decimal amount and an ISO 4217 asset (`$0.01` becomes `0.01` and `iso4217:USD`), signs a quote
   token, and puts it in `extra.quoteToken`. The outer `payTo` becomes `SENTINEL_PAY_TO` and
   `maxTimeoutSeconds` the quote's lifetime.
2. The buyer obtains a payment token for the quote from the payment service, which captures the
   payment and embeds the quote in the token (`quote_token`).
3. The buyer retries with the payment payload `{ paymentToken, paymentId }`. x402 rebuilds the
   requirements for the route, which signs a new quote; `quoteToken` is a dynamic extra field, so
   the buyer's accepted requirements still match.
4. Before calling the facilitator, x402 runs the server scheme's `onBeforeVerify` hook, which checks
   the DPoP proof of a DPoP-bound token (section 5.2).
5. The facilitator verifies the payment (section 5.1) against the quote the buyer accepted. If it
   accepts, the server scheme's `onAfterVerify` hook refuses a replayed proof and records its `jti`.
6. The route runs. `settle` returns success with the token's `payment_id` as the transaction and
   `sub` as the payer. It calls nothing: the payment was captured in step 2.

## 4. Tokens

### 4.1 Quote token

Signed by the seller's `QuoteSigner`, with `alg` ES256, ES384, ES512 or RS256 (from the key) and the
key's `kid` in the header:

```json
{
  "iss": "https://api.example.com",
  "aud": "aws:marketplace",
  "iat": 1760000000,
  "exp": 1760000300,
  "jti": "550e8400-e29b-41d4-a716-446655440000",
  "price": { "amount": "0.01", "currency": "USD" },
  "payTo": "prod-example123",
  "reference": "weather-v1",
  "settlement": { "product_id": "prod-example123" },
  "description": "Current weather",
  "dimensions": { "calls": 1 }
}
```

- `iss` is the signer's service URL. `jti` is a random UUID.
- `exp` is `iat` plus the route's `maxTimeoutSeconds`, or 300 seconds.
- `payTo` and `settlement.product_id` are the route's `payTo`, the AWS Marketplace product ID.
  `extra.settlement`, when the route sets one, is copied in, and a `product_id` in it must equal
  `payTo`.
- `reference` comes from `extra.reference` (default `RESOURCE`). `description`, `dimensions`,
  `support` and `terms` are copied from `extra` when set.

### 4.2 Payment token

Signed by the payment service and verified against its JWKS:

```json
{
  "iss": "awsmp-agentpay.amazonaws.com",
  "sub": "buyer-identity",
  "aud": "https://api.example.com",
  "iat": 1760000010,
  "exp": 1760000310,
  "jti": "awsmp-<payment id>",
  "payment_id": "awsmp-<payment id>",
  "quote_token": "<the quote token>",
  "cnf": { "jkt": "<SHA-256 thumbprint of the buyer's DPoP key>" }
}
```

`iss` is `PAYMENT_TOKEN_ISSUER`; `aud` is the quote's `iss`; `cnf` is present only for a DPoP-bound
token.

### 4.3 The 402 requirements

| Field               | Value                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------- |
| `scheme`            | `exact`                                                                                 |
| `network`           | `aws:base` (or another registered `aws:*` network)                                      |
| `amount`, `asset`   | The decimal price and `iso4217:<currency>`                                              |
| `payTo`             | `SENTINEL_PAY_TO`, `urn:x402:agentic-commerce:see-quote`; the quote carries the product |
| `maxTimeoutSeconds` | The quote's `exp - iat`                                                                 |
| `extra.quoteToken`  | The quote token                                                                         |

## 5. Checks

### 5.1 Payment verification

`AgenticCommerceVerifier.verify(paymentToken, requirements)` never throws for an invalid payment; it
returns `{ isValid: false, invalidReason, invalidMessage }`. In order:

| #   | Check                                                                                                                | Reason on failure |
| --- | -------------------------------------------------------------------------------------------------------------------- | ----------------- |
| 1   | The requirements carry `extra.quoteToken`                                                                            | `invalid_quote`   |
| 2   | The payment token is a compact JWS whose header has an allowed `alg` and a `kid`                                     | `invalid_payment` |
| 3   | Its `iss` is `paymentTokenIssuer` (default `PAYMENT_TOKEN_ISSUER`)                                                   | `invalid_payment` |
| 4   | Its `exp` is an integer and not in the past                                                                          | `payment_expired` |
| 5   | It has a `payment_id`                                                                                                | `invalid_payment` |
| 6   | It has a top-level `quote_token`, equal (constant-time) to `extra.quoteToken`                                        | `invalid_quote`   |
| 7   | Its signature verifies against the payment service JWKS (`paymentTokenJwksUrl`); then checks 3-6 again               | `invalid_payment` |
| 8   | The quote's signature verifies with the configured `sellerKeyResolver`                                               | `invalid_quote`   |
| 9   | The payment token's `aud` is the quote's `iss`                                                                       | `invalid_payment` |
| 10  | The quote's `exp` is an integer and not in the past                                                                  | `quote_expired`   |
| 11  | The quote's price amount and currency equal the requirements'                                                        | `invalid_payment` |
| 12  | With a product ID in the requirements, the quote's `payTo` and `settlement.product_id` equal it                      | `invalid_payment` |
| 13  | With the route's quote in the requirements, the quote's `iss`, `aud`, `payTo`, `settlement` and `reference` equal it | `invalid_quote`   |

Checks 2 to 6 read the token before its signature is verified, so a request failing them costs no
key fetch; they are made again once it is. The facilitator scheme and
`AgenticCommerceFacilitatorClient` pass the route's product ID and quote, read from the quote the
server signed for this request, so a quote for another product, another route or another service
sharing the seller's key is refused. A payload without `paymentToken` is `invalid_payment`.
Signatures are limited to `ALLOWED_ALGORITHMS`. Any error fetching a key, including a timeout (10
seconds), a redirect (not followed), a non-200 status or a body over 64 KiB, fails the check it
belongs to.

Verification does not record payments: a valid payment token passes every time until it or its
quote expires. To accept each payment once, see
[security.md](security.md#payment-replay).

### 5.2 DPoP

The `exact` server scheme checks a payment token bound to a key (`cnf.jkt`) in its `onBeforeVerify`
hook, before the facilitator is called:

1. A `DPoP` header is present, else `dpop_required`.
2. The thumbprint of its header JWK equals `cnf.jkt`. Then its `typ` is `dpop+jwt` (any case), its
   `alg` is ES256, ES384, ES512, RS256 or PS256, its signature verifies, and it has `jti`, `htm`,
   `htu` and an integer `iat`.
3. `iat` is at most 5 seconds ahead, and at most `dpopMaxAgeSeconds` (default 60) plus 5 seconds
   old.
4. `htm` equals the request method upper-cased, and `htu` the request URL without its query and
   fragment, exactly.
5. `ath` is the hash of the payment token.

Any other failure is `dpop_invalid`, and the facilitator is not called. A token without `cnf.jkt`
needs no proof. A token that cannot be decoded is left to the facilitator, which rejects it.

The payment token is not verified yet at that point, so the nonce store is not used there. With a
`dpopNonceStore`, the scheme's `onAfterVerify` hook, which x402 runs once the facilitator has
accepted the token, then checks that:

6. The proof is still fresh: the current second is before
   `iat + floor(dpopMaxAgeSeconds + 5) + 1`, the second after the proof stops being fresh.
7. The `jti` has not been seen. It is then added with that expiry (Unix seconds, exclusive).

Either failure, or an error from the store, is `dpop_invalid`. x402 then calls the seller's
`onVerifiedPaymentCanceled` hooks with the reason `after_verify_aborted`; nothing is settled. A
forged token, which the facilitator rejects, never reaches the store. A replayed proof costs one
facilitator call before it is refused, and the seller's own `onAfterVerify` hooks, which x402 runs
before the scheme's, see it as verified.

## 6. Reference

### 6.1 Errors

All error classes extend `AgenticCommerceError` (with `code` and optional `details`):

| Class             | Code               | When                                                                                               |
| ----------------- | ------------------ | -------------------------------------------------------------------------------------------------- |
| `ValidationError` | `VALIDATION_ERROR` | Misconfiguration of a scheme, the verifier, a client or `jwksDocument`; an unparseable route price |
| `SigningError`    | `SIGNING_ERROR`    | Quote signer misconfiguration, a PEM that cannot be loaded, a failed KMS `Sign` (`cause` set)      |
| `DPoPError`       | `DPOP_ERROR`       | `verifyDPoPProof` / `extractDPoPThumbprint` reject a proof                                         |

The schemes and the verifier report invalid payments as results, not errors.

### 6.2 Caching

| What                         | Cached                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Seller JWKS (`type: 'jwks'`) | One hour, per verifier                                                                                         |
| Seller KMS public key        | One hour, per verifier                                                                                         |
| Payment service JWKS         | One minute, per verifier; a `kid` it lacks refetches it at most every 30 seconds; concurrent fetches share one |

### 6.3 Constants

| Constant                       | Value                                 |
| ------------------------------ | ------------------------------------- |
| `SCHEME_EXACT`                 | `exact`                               |
| `DEFAULT_NETWORK`              | `aws:base`                            |
| `AGENTIC_COMMERCE_CAIP_FAMILY` | `aws:*`                               |
| `SENTINEL_PAY_TO`              | `urn:x402:agentic-commerce:see-quote` |
| `PAYMENT_TOKEN_ISSUER`         | `awsmp-agentpay.amazonaws.com`        |
| `ALLOWED_ALGORITHMS`           | `RS256`, `ES256`, `ES384`, `ES512`    |

### 6.4 Lower-level helpers

`decodeQuoteToken` decodes a quote token without verifying it, so do not use it to accept a payment:
only `AgenticCommerceVerifier` makes the checks of section 5.1.
`parseMoneyToDecimal`, `secureCompare` and `validateUrl` are general price-parsing, comparison and
URL utilities; the documented setup does not need them.

### 6.5 Build outputs

Each entry point (`.` and `./agentic-commerce/exact`) ships an ESM build (`.js`), a CommonJS build
(`.cjs`) and their type declarations (`.d.ts`, `.d.cts`). The package declares
`"sideEffects": false`.
