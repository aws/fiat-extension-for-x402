# Examples

Small sellers you can copy. Each runs the `exact` server scheme on x402's stock resource server with
an in-process facilitator. Keys come from AWS KMS or from a PEM the environment points to; none is
hard-coded.

| Example                           | What it shows                                                                                       |
| --------------------------------- | --------------------------------------------------------------------------------------------------- |
| [express-seller](express-seller/) | Express with `paymentMiddleware` from `@x402/express`, a key you hold, and `/.well-known/jwks.json` |
| [lambda-seller](lambda-seller/)   | An AWS Lambda handler for an API Gateway HTTP API, on `x402HTTPResourceServer`, with a KMS key      |

## express-seller

`app.ts` builds the app (`createSellerApp`); `server.ts` reads the environment and listens;
`nonce-store.ts` is the in-memory DPoP nonce store. In this repository the examples import the
package by name, which resolves to the built `dist/`, so build it first. In your own project,
install the package instead.

```bash
npm ci && npm run build
openssl ecparam -name secp384r1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out quote-key.pem
export SELLER_KEY_FILE=quote-key.pem SELLER_KEY_ID=quote-key-2026-10
export SELLER_SERVICE_URL=https://api.example.com SELLER_PRODUCT_ID=prod-example123
npx tsx examples/express-seller/server.ts
```

- `GET /.well-known/jwks.json` serves `jwksDocument(signer.publicJwk)`. Register
  `https://<seller>/.well-known/jwks.json` as the listing's JWKS URL. A `{ type: 'jwks' }` resolver
  takes the base, `https://<seller>`.
- `GET /weather` costs $0.01. Without a payment it answers `402` with a signed quote.

The facilitator here runs in the seller's process and uses the signer's own public key. A
facilitator running elsewhere uses `{ type: 'jwks', jwksUrl: SELLER_SERVICE_URL }` instead.

`server.ts` passes an in-memory DPoP nonce store, which covers one process only and holds at most
100,000 unexpired ids (when full it refuses new proofs rather than forget an id early); with several
instances, use a store they share. Behind a load balancer or proxy that terminates TLS, set
`TRUST_PROXY` (Express's `trust proxy`, for example `1`) and have the proxy forward the original
`Host`, so DPoP `htu` checks see the public https URL.

## lambda-seller

`handler.ts` exports `handler` for an API Gateway HTTP API (payload format 2.0) route
`GET /weather`. Set `SELLER_KMS_KEY_ARN` (an `ECC_NIST_P384` `SIGN_VERIFY` key),
`SELLER_SERVICE_URL` and `SELLER_PRODUCT_ID`; the function's role needs `kms:Sign` and
`kms:GetPublicKey` on the key. Bundle it with your usual tool (for example esbuild) with this
package and `@x402/core` as dependencies.

The handler builds the request URL from `requestContext.domainName` and `rawPath`, the host and path
the buyer called (a custom domain and a named stage included), so DPoP `htu` checks see the public
URL; it matches routes with the stage removed. An API mapping key on a custom domain (such as `/v1`)
is also in `rawPath`: strip it too, or the route does not match. Behind CloudFront or another proxy,
build the URL from the public host instead. Any method other than `GET` gets `405`, the paid
response is `Cache-Control: private, no-store`, and a KMS or facilitator failure is logged and
answered with `502`. Its DPoP nonce store lives in one execution environment; back it with a shared
store (for example a DynamoDB table with a conditional write) to cover every concurrent environment.

## Checks

The examples are typechecked in CI (`npm run typecheck:examples`), and
`test/examples/express-seller.test.ts` runs the Express app in-process: it fetches the JWKS, checks
the 402 challenge, and checks that an unpaid `HEAD` is refused. `test/examples/nonce-store.test.ts`
checks the nonce store against `verifyDPoPProof`. They are not part of the published package.
