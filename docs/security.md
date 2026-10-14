# Security Guide

This page describes the protections in `@aws/fiat-extension-for-x402` and what a seller must do to
keep them effective. To report a vulnerability, see [SECURITY.md](../SECURITY.md).

## Keys

- **Seller keys are configured, never discovered.** `AgenticCommerceVerifier` requires a
  `sellerKeyResolver` (a KMS key, a JWKS URL or a static JWK) and verifies quotes only with that
  key. It never fetches a key from the quote's `iss`, a `jku` or any other URL in a token.
- **Private keys stay private.** Prefer `KmsQuoteSigner`, where the key never leaves AWS KMS. With
  `LocalQuoteSigner`, load the PEM at startup from a mounted file or a secrets manager; never commit
  it, bake it into an image or hard-code it. `LocalQuoteSigner` refuses a public JWK with private
  key members, `publicJwk` never holds any, and `jwksDocument` rejects them.
- **Key strength.** Quote keys are EC on P-256, P-384 or P-521, or RSA of at least 2048 bits.
  RSA-PSS-only keys are refused.
- **Rotation.** Give every key a unique `kid`, publish the next key at least an hour before signing
  with it (verifiers cache seller keys for an hour), and remove the old key once its quotes have
  expired.
- **Least privilege.** The seller needs `kms:Sign` on its KMS key; the facilitator needs only
  `kms:GetPublicKey`.

## Algorithms

Payment-token and quote signatures are limited to `ALLOWED_ALGORITHMS`: RS256, ES256, ES384 and
ES512. The list is frozen, so no code in the process can widen it. DPoP proofs may use ES256, ES384,
ES512, RS256 or PS256. `none` and the HMAC algorithms (HS256, HS384, HS512) are always refused,
which prevents algorithm-confusion forgeries.

## Payment verification

A payment token is accepted only when it is signed by the payment service, has the expected issuer
and has not expired, embeds exactly the quote the buyer accepted, and that quote is signed by the
seller's configured key, addressed to the seller (`aud`), unexpired, and for the route's price,
currency and product. Every failure rejects the payment; nothing fails open. The full order of
checks is in [sdk-guide.md](sdk-guide.md#51-payment-verification).

- The quote comparison is constant-time (`secureCompare`).
- The payment service JWKS is fetched on every verification, so a revoked service key stops being
  accepted at once.
- JWKS requests time out after 10 seconds and do not follow redirects, so the configured headers
  (`jwksRequestHeaders`, `getAuthHeaders`) never reach another host; they are never sent to a seller
  JWKS URL.

## DPoP

DPoP (RFC 9449) binds a payment token to the buyer's key (`cnf.jkt`), so a stolen token is useless
without that key. The `exact` server scheme requires, before the facilitator is called, a `DPoP`
proof whose key thumbprint matches, for this request's method and URL, over this payment token,
issued within `dpopMaxAgeSeconds` (default 60, plus 5 seconds of skew).

What the seller must do:

- **Share a nonce store.** Pass a `dpopNonceStore` shared by every instance of the seller, or a
  proof can be replayed against another instance within its maximum age. An asynchronous store must
  record the `jti` atomically in `has`. Each `jti` is added with the expiry
  `iat + floor(dpopMaxAgeSeconds + 5) + 1`, the second after its proof stops being fresh, so a store
  that forgets ids on time still rejects every replay, provided every seller instance's clock agrees
  with the store's; a store shared by instances whose clocks differ must keep ids that much longer.
- **Keep the request URL public.** `htu` is compared exactly with the URL the framework reports,
  with no normalisation. Behind a proxy, make the framework see the public scheme and host (for
  Express, set `trust proxy` and forward the original `Host`).
- **Do not bypass the server scheme.** The facilitator does not check DPoP. Calling it directly,
  outside `x402ResourceServer`, accepts a DPoP-bound token without a proof.

## Transport and input

- Serve the seller, its JWKS and every facilitator over HTTPS.
- String and number route prices are parsed with linear-time patterns and at most 8 decimal places;
  anything else is a `ValidationError` on the first 402. An `{ amount, asset }` price is used as
  given, so write its `amount` as a plain decimal string.
- The package does not log tokens, keys or credentials. Error messages name fields, key ids and HTTP
  statuses, never key material: a JWK that cannot be imported (from a seller or service JWKS, a
  `static` resolver or a DPoP proof) is reported as `JWK <kid>: invalid key material`, or
  `JWK: invalid key material` when its `kid` is not a string.

## Common pitfalls

1. **Using the token helpers to accept payments.** `verifyQuoteToken` and `verifyPaymentToken` check
   one signature; only `AgenticCommerceVerifier` (through the facilitator) makes every check.
2. **A seller JWKS URL you do not control.** The `jwksUrl` must be the seller's own, the one
   registered for the listing.
3. **One nonce store per instance.** Use a shared store.
4. **Hard-coded keys or credentials.** Use KMS, environment configuration or a secrets manager, and
   the default AWS credential chain.
