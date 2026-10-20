# Shared wire fixtures (TEST KEYS ONLY)

These files are the wire contract of the AWS Marketplace Agentic Commerce
`exact` scheme. Every SDK implementation of the scheme carries the same files,
byte for byte, and runs them in its own test suite. A change to any file here
is a change to the wire contract: make it in every SDK at once.

The tokens and the proof are fixed bytes. ECDSA signatures are randomised, so
re-signing produces different bytes that are equally valid: never regenerate
the fixed tokens; add a new fixture instead.

## Conventions

- **Format.** UTF-8 JSON, ASCII only, two-space indent, LF line endings and a
  final newline. Numbers are written in their shortest round-trip form (`1e-7`,
  `0.30000000000000004`). An SDK whose JSON writer formats numbers differently
  checks that the text is ASCII with LF endings, and compares parsed values.
  Each file has `formatVersion` (currently 1) and a `description`.
- **Time.** Every `now` is Unix time in whole seconds. Tests run on a fake
  clock set to that time, never on the real clock. The fake clock must cover
  every clock the SDK and its JWT library read: the fixed times are in the
  past, so a library left on the real clock rejects every token.
- **Keys.** No private key is stored. Each private scalar is
  `SHA-512(label) mod n` (see `keys.json`), so any SDK can rebuild the key
  with its own crypto library. A test must check that the rebuilt key matches
  the public JWK before it uses it.
- **Names.** Result and option fields are camelCase, as on the x402 wire. An
  SDK whose idiom is snake_case maps them mechanically (`isValid` is
  `is_valid`, `accessToken` is `access_token`, `maxAge` is `max_age`). An
  optional result field that is absent here must be absent (or null) in the
  result.
- **Service JWKS.** The verifier fetches the service JWKS from
  `{base URL}/.well-known/jwks.json`; a test serves `keys.service.jwks` from a
  stubbed HTTP client at any base URL.

## Files

`keys.json`
- `derivation.rule`, `derivation.curveOrders`: how each private key is
  derived; the curve orders are hexadecimal.
- `keys.seller`, `keys.service`, `keys.buyer`: each has `curve` and `label`.
  The seller also has `kid`, `serviceUrl` and `publicJwk`; the service has
  `kid` and `jwks`; the buyer has `publicJwk` and its RFC 7638
  `jwkThumbprint`.

`quote.json`
- `now`, `jti`: the clock and the quote `jti` while the quote is signed.
- `signer`: the key (`seller`), `kid` and `serviceUrl` of the quote signer.
- `input`, `output`: `enhancePaymentRequirements` input and output.
  `output.extra.quoteToken` is `quoteToken`.
- `quoteToken`, `header`, `payloadJson`: the fixed quote token, its decoded
  protected header, and its payload exactly as signed. A quote minted from
  `input` at `now` with `jti` has this header and these payload bytes.

`payment-token.json`
- `token`, `header`, `claims`: the fixed payment token and its decoded parts.
- `verify`: verify `token` against `requirements` at `now`, with the seller's
  `publicJwk` as the seller key, the service JWKS, and `paymentTokenIssuer` as
  the payment token issuer (also the SDK default). The result is `expected`.
- `facilitator`: at `now`, the facilitator's verify of `paymentPayload`
  against `requirements` returns `expectedVerify` (an x402 `VerifyResponse`),
  and its settle returns `expectedSettle` (an x402 `SettleResponse`).

`dpop-proof.json`
- `proof`, `header`, `claims`: the fixed DPoP proof and its decoded parts.
- `verify`: verify `proof` at `now` with `options` (`htm` and `htu` are the
  expected method and URL, `accessToken` the payment token that `ath` hashes,
  `maxAge` the maximum age in seconds). The result is `expected.claims`.

`behaviour-vectors.json`
- `verifier.cases`, `dpop.cases`, `dpopNonceStore.cases`: single changes to
  the base named by `base`, below.
- `parsePrice.cases[]`: `price` and `expected`; `kmsKid.cases[]`: `keyArn`
  and `kid`; `jwkThumbprint.cases[]`: `name`, `jwk` and `thumbprint`. These
  have no `base`; see below.

## Behaviour vectors

Each case names its `base` (a section of another file), changes it as below,
runs it, and compares the outcome with `expected`.

Changes are shallow merges: each member replaces the member of the same name,
and `null` removes it (a removed option takes the SDK default).

- `now`: replaces the base clock.
- `requirements`: merged into the verifier requirements, after
  `extra.quoteToken` is set to the quote in use; a case that replaces `extra`
  must carry its own `quoteToken`.
- `options`: merged into the DPoP verification options.
- `paymentTokenClaims`, `paymentTokenHeader`: merged into the payment token's
  claims or protected header, which is then re-signed with the service key.
- `quoteClaims`: merged into the quote payload, which is then re-signed with
  the seller key; the new quote replaces `quote_token` in the payment token
  (re-signed with the service key) and `extra.quoteToken` in the requirements.
- `proofClaims`: merged into the DPoP proof claims, which are then re-signed
  with the buyer key.

A member keeps its position when it is replaced; a new member goes last.

Expected outcomes:

- Verifier: `isValid`, then `payer` and `paymentId` when valid, or
  `invalidReason` and `invalidMessage` when not. When `settle` is present, the
  facilitator's settle returns it for the same token, with `quote.json`
  `output` (its `extra.quoteToken` set to the quote in use) as both the
  requirements and the payload's `accepted`.
- DPoP: `claims` (verification succeeds and returns them) or `error` (the
  exact error message).
- DPoP nonce store: verification calls the store's `add` once with
  `addedJti` and `addedExpiresAt`, and the same proof verified again with
  that store fails with `replayError`.
- Route price parsing: `amount` and `asset` for the route price `price` (a
  JSON string or number), or `errorPrefix` (the error message starts with
  it; the rest shows the input in the SDK's own notation).
- KMS `kid`: the `kid` a KMS quote signer derives from `keyArn` when no `kid`
  is given.
- JWK thumbprints: the RFC 7638 SHA-256 thumbprint of `jwk`.

Every case pins behaviour that every SDK shares today, lenient or strict, so
changing any outcome is a contract change. Cases named "lenient" are the ones
a reviewer is most likely to want tightened (a digit-string `iat` is read as
an integer; the quote `aud` is not checked). Others are deliberate choices
too: a payment token must have a `kid` and a `payment_id`, a price of `0` is
accepted, a fractional `exp` is expired, and `htu` is compared exactly, with
no URI normalisation.
