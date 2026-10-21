# Security Guide

This page describes the protections in `@aws/fiat-extension-for-x402` and what a seller must do to
keep them effective. To report a vulnerability, see
[AWS vulnerability reporting](https://aws.amazon.com/security/vulnerability-reporting/).

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
- The quote must name the same route as the quote the server signed for the request: the same
  `iss`, `aud`, `payTo`, `settlement` and `reference`. A quote for another route, or from another
  service sharing the seller's key, is refused.
- The token's shape, `alg`, `kid`, issuer, expiry, `payment_id` and quote are checked before any key
  is fetched, so a malformed or misdirected token costs no network call.
- The payment service JWKS is cached for a minute, so a revoked service key stops being accepted
  within a minute. A token naming a `kid` the cached set lacks refetches it at most every 30
  seconds, and concurrent fetches share one request.
- JWKS requests time out after 10 seconds, refuse a body over 64 KiB and do not follow redirects,
  so the configured headers (`jwksRequestHeaders`, `getAuthHeaders`) never reach another host; they
  are never sent to a seller JWKS URL.

## Payment replay

Verification is stateless and `settle` is a no-op: the payment service captures the payment when it
issues the payment token. The SDK keeps no record of the payments it has accepted, so one
`PAYMENT-SIGNATURE` passes verification on every request until the earlier of the payment token's
and the quote's `exp` (300 seconds by default). Without a record, one payment buys every request made
with it in that window. A token bound to a key (`cnf.jkt`) needs a fresh DPoP proof per request, but
its holder can make one each time.

The SDK cannot keep that record for the seller: only a store shared by every instance of the seller
rejects a payment replayed against another instance. The seller **must** accept each payment once:

- **Record `paymentId` atomically.** Every valid payment token has a `payment_id`. The `exact`
  facilitator scheme returns it as `extra.paymentId` of the verify response, so an `onAfterVerify`
  hook sees it before the request is served (`AgenticCommerceVerifier.verify` returns it as
  `paymentId`). Insert it into a store shared by every instance of the seller with a conditional
  write (for example a DynamoDB `PutItem` with `attribute_not_exists`, or Redis `SET NX`), and refuse
  the request if it was already there. Use only this verified id: a `paymentId` in the payment
  payload is set by the buyer and never checked.
- **Keep it long enough.** Keep each id until `max(payment token exp, quote exp)` plus the clock
  skew between the seller's instances, after which the token is refused anyway.
- **Record it once the payment is valid.** Recording before verification lets a forged token block a
  genuine payment id.

For example, with an `onAfterVerify` hook on the `x402ResourceServer`, which refuses the request
when it returns an abort:

```typescript
resourceServer.onAfterVerify(async ({ paymentPayload, result }) => {
  const paymentId = result.extra?.paymentId; // verified by the facilitator
  const token = decodeJwt(String(paymentPayload.payload.paymentToken));
  const quote = decodeJwt(String(token.quote_token));
  const expiresAt = Math.max(token.exp!, quote.exp!) + 60;
  // claimOnce: your shared store's atomic "record unless present".
  if (typeof paymentId !== 'string' || !(await claimOnce(paymentId, expiresAt))) {
    return { abort: true, reason: 'payment_replayed', message: 'Payment already used' };
  }
});
```

This follows x402's own guidance for Solana, where a resource server or facilitator must likewise
remember the transactions it has settled:
[Duplicate Settlement Mitigation](https://github.com/coinbase/x402/blob/main/specs/schemes/exact/scheme_exact_svm.md#duplicate-settlement-mitigation-recommended).

## DPoP

DPoP (RFC 9449) binds a payment token to the buyer's key (`cnf.jkt`), so a stolen token is useless
without that key. The `exact` server scheme requires, before the facilitator is called, a `DPoP`
proof whose key thumbprint matches, for this request's method and URL, over this payment token,
issued within `dpopMaxAgeSeconds` (default 60, plus 5 seconds of skew).

The nonce store is used only after the facilitator has accepted the payment token, in the scheme's
`onAfterVerify` hook: it refuses a proof that went stale while the facilitator ran, or whose `jti`
was seen, and records the `jti`. A forged token, bound to the sender's own key, therefore never
adds an id. A replay is refused with `dpop_invalid` after one facilitator call; the seller's own
`onAfterVerify` hooks run for it first, and its `onVerifiedPaymentCanceled` hooks are called with
`after_verify_aborted`. The exported `verifyDPoPProof` with a `nonceStore` records the id as soon as
the proof verifies; call it only for an access token that is already verified.

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
- Route prices are parsed with linear-time patterns and at most 8 decimal places, whether a string,
  a number or an `{ amount, asset }` object, whose `amount` must be a plain decimal string and whose
  `asset` must be `iso4217:` and an upper-case three-letter code. Anything else is a
  `ValidationError` on the first 402.
- The package does not log tokens, keys or credentials. Error messages name fields, key ids and HTTP
  statuses, never key material: a JWK that cannot be imported (from a seller or service JWKS, a
  `static` resolver or a DPoP proof) is reported as `JWK <kid>: invalid key material`, or
  `JWK: invalid key material` when its `kid` is not a string.

## Common pitfalls

1. **Accepting a payment more than once.** Record each `paymentId` in a shared store; see
   [Payment replay](#payment-replay).
2. **Using the token helpers to accept payments.** `verifyQuoteToken` and `verifyPaymentToken` check
   one signature; only `AgenticCommerceVerifier` (through the facilitator) makes every check.
3. **A seller JWKS URL you do not control.** The `jwksUrl` must be the seller's own, the one
   registered for the listing.
4. **One nonce store per instance.** Use a shared store.
5. **Hard-coded keys or credentials.** Use KMS, environment configuration or a secrets manager, and
   the default AWS credential chain.
