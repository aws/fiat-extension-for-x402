# Fiat Extension for x402 (TypeScript)

Accept fiat payments for HTTP APIs through the [x402](https://x402.org) protocol with **AWS
Marketplace Agentic Commerce**.

This package plugs into the x402 TypeScript SDK (`@x402/core`). It provides the `exact` payment
scheme for AWS Marketplace Agentic Commerce networks (`aws:*`), for the two roles a seller runs:

| x402 role                | Class                                   | What it does                                                                                                          |
| ------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Resource server (seller) | `ExactAgenticCommerceServerScheme`      | Prices routes in fiat, adds a signed **quote token** to every `402 Payment Required` response, and checks DPoP proofs |
| Facilitator              | `ExactAgenticCommerceFacilitatorScheme` | Verifies the **payment token** a buyer presents against the quote it pays for, with `AgenticCommerceVerifier`         |

Use x402's own HTTP middleware (for example `paymentMiddleware` from `@x402/express`) to protect
routes. This package provides no middleware and no buyer-side code.

## How a payment works

1. A buyer requests a protected route without paying. The middleware answers `402` with `exact`
   payment requirements on network `aws:base`, priced in `iso4217:USD`, carrying a quote token
   signed by the seller.
2. The buyer obtains a payment token for that quote from AWS Marketplace Agentic Commerce, which
   signs it and captures the payment.
3. The buyer retries with the payment token. The server scheme checks the DPoP proof if the token is
   DPoP-bound, the facilitator verifies the token, and the route runs. Settlement is a no-op that
   reports the payment ID: the payment was already captured.

See [docs/sdk-guide.md](docs/sdk-guide.md) for the full sequence, the token formats and every check.

## Install

```bash
npm install @aws/fiat-extension-for-x402 @x402/core @x402/express express
```

Requires Node.js 20.19 or later and `@x402/core` 2.23.0 or later (below 3). `@x402/core` is a peer
dependency; `@x402/express` and `express` are only needed for the Express middleware.

## Quick start (Express)

```typescript
import express from 'express';
import { paymentMiddleware } from '@x402/express';
import { x402Facilitator } from '@x402/core/facilitator';
import { x402ResourceServer } from '@x402/core/server';
import {
  AgenticCommerceVerifier,
  ExactAgenticCommerceFacilitatorScheme,
  InProcessFacilitatorClient,
  KmsQuoteSigner,
  registerExactAgenticCommerceServer,
} from '@aws/fiat-extension-for-x402';

const KEY_ARN = 'arn:aws:kms:us-east-1:111122223333:alias/my-quote-key';

// Seller: signs quotes with a KMS key (ECC_NIST_P384, SIGN_VERIFY).
const signer = new KmsQuoteSigner({
  keyArn: KEY_ARN,
  region: 'us-east-1',
  serviceUrl: 'https://api.example.com',
});

// Facilitator: verifies payment tokens, here in the seller's own process.
const verifier = new AgenticCommerceVerifier({
  sellerKeyResolver: { type: 'kms', kmsKeyArn: KEY_ARN, region: 'us-east-1' },
});
const facilitator = new x402Facilitator().register(
  'aws:base',
  new ExactAgenticCommerceFacilitatorScheme({ verifier })
);
const server = registerExactAgenticCommerceServer(
  new x402ResourceServer(new InProcessFacilitatorClient(facilitator)),
  { signer } // networks defaults to ['aws:base']
);

const payments = paymentMiddleware(
  {
    'GET /weather': {
      accepts: { scheme: 'exact', network: 'aws:base', payTo: 'prod-example123', price: '$0.01' },
      description: 'Current weather',
    },
  },
  server
);

const app = express();
// Express 4 ignores the promise a handler returns, so pass a rejection on.
app.use((req, res, next) => {
  payments(req, res, next).catch(next);
});
// x402 protects GET only, but Express answers HEAD with the GET handler: refuse it.
app.head('/weather', (_req, res) => {
  res.set('Allow', 'GET').sendStatus(405);
});
app.get('/weather', (_req, res) => {
  res.json({ temperatureF: 58 });
});
app.listen(3000);
```

For replay protection, also pass a shared `dpopNonceStore` (see [DPoP](#dpop)). Runnable versions,
an Express seller with its own key and an AWS Lambda seller, are in [examples/](examples/).

## Seller keys

The seller signs every quote with its own key. The listing is registered with either the KMS key or
a JWKS URL, and the facilitator is configured with the same key.

| Signer             | Key                                                                     | Facilitator `sellerKeyResolver`      |
| ------------------ | ----------------------------------------------------------------------- | ------------------------------------ |
| `KmsQuoteSigner`   | An AWS KMS key. The private key never leaves KMS.                       | `{ type: 'kms', kmsKeyArn, region }` |
| `LocalQuoteSigner` | A private key you manage (a PEM file, a secrets manager, an HSM export) | `{ type: 'jwks', jwksUrl }`          |

To keep the key elsewhere, for example in an HSM that signs remotely, implement `QuoteSigner`
(`signQuote(payload): Promise<string>` and `getServiceUrl(): string`).

The signer's service URL becomes the quote token's `iss` claim and must be the seller URL registered
for the listing.

### An AWS KMS key

Create an asymmetric signing key:

```bash
aws kms create-key --key-spec ECC_NIST_P384 --key-usage SIGN_VERIFY \
  --description "x402 quote signing"
aws kms create-alias --alias-name alias/my-quote-key --target-key-id <key-id>
```

`ECC_NIST_P384` with `ECDSA_SHA_384` is the default. `ECC_NIST_P256` and `ECC_NIST_P521` work with
`algorithm: 'ECDSA_SHA_256'` or `'ECDSA_SHA_512'`. `KmsQuoteSigner` uses the default AWS credential
chain unless you pass `credentials`.

| Who                                                 | Needs on the key   |
| --------------------------------------------------- | ------------------ |
| The seller (`KmsQuoteSigner`)                       | `kms:Sign`         |
| The facilitator (`{ type: 'kms' }` seller resolver) | `kms:GetPublicKey` |

The JWS `kid` is taken from the key ARN (the alias name, or `key/<id>`) unless you set `kid`.

### Your own key with a JWKS URL

Sign with your own private key and publish the public key at
`https://<seller>/.well-known/jwks.json`, the JWKS URL registered for the listing.
`LocalQuoteSigner.fromPem` takes the PEM and a `FromPemOptions` object:

```typescript
import { readFileSync } from 'node:fs';
import express from 'express';
import {
  AgenticCommerceVerifier,
  LocalQuoteSigner,
  jwksDocument,
  type FromPemOptions,
} from '@aws/fiat-extension-for-x402';

// 1. Load the key. The algorithm follows the key: P-256/P-384/P-521, or RSA
//    of at least 2048 bits. Set `password` for an encrypted PEM.
const options: FromPemOptions = {
  kid: 'quote-key-2026-10',
  serviceUrl: 'https://api.example.com',
  password: process.env.QUOTE_KEY_PASSWORD || undefined, // an empty value means none
};
const signer = LocalQuoteSigner.fromPem(readFileSync('quote-key.pem'), options);

// 2. Serve the public key, built once at startup. Leave this route out of the
//    payment routes.
const app = express();
const jwks = jwksDocument(signer.publicJwk);
app.get('/.well-known/jwks.json', (_req, res) => {
  res.json(jwks);
});

// 3. Point the facilitator at the JWKS base URL; /.well-known/jwks.json is appended.
const verifier = new AgenticCommerceVerifier({
  sellerKeyResolver: { type: 'jwks', jwksUrl: 'https://api.example.com' },
});
```

Use an EC key (P-256, P-384 or P-521) or a plain RSA key of at least 2048 bits. RSA keys marked for
RSA-PSS only (`openssl genpkey -algorithm RSA-PSS`) are not supported: quote tokens are signed with
RS256, which such a key does not allow. `LocalQuoteSigner` rejects them, including an encrypted
RSA-PSS PEM. `fromPem` reads PKCS #8, SEC 1 and PKCS #1 PEM.

Create a P-384 key with OpenSSL:

```bash
openssl ecparam -name secp384r1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out quote-key.pem
```

Never publish or commit the PEM. Load it from a file your deployment mounts, or from a secrets
manager, and never hard-code it.

**Rotation.** Every key needs a unique `kid`: verifiers pick the key named in the quote's header. To
rotate, publish both keys (`jwksDocument(next.publicJwk, current.publicJwk)`), switch the signer to
the new key, and remove the old key once its quotes have expired. Facilitators cache the JWKS for up
to an hour, so publish a new key at least an hour before signing with it.

`jwksDocument` accepts only keys verifiers will use: EC on P-256, P-384 or P-521, or RSA of at least
2048 bits, each with a unique `kid` and an `alg` that matches the key. It parses the key material
and rejects anything malformed or containing private key fields. `publicJwk` never holds any.

### Local development and tests

Sign with a generated key and give the facilitator the public key directly, with no JWKS endpoint:

```typescript
import * as jose from 'jose';
import { AgenticCommerceVerifier, LocalQuoteSigner } from '@aws/fiat-extension-for-x402';

const { privateKey, publicKey } = await jose.generateKeyPair('ES256');
const publicJwk = { ...(await jose.exportJWK(publicKey)), alg: 'ES256', kid: 'dev' };
const signer = new LocalQuoteSigner(privateKey, publicJwk, 'http://localhost:3000');
const verifier = new AgenticCommerceVerifier({
  sellerKeyResolver: { type: 'static', publicJwk },
});
```

The JWK's `alg` defaults to `ES256`, so set it for a P-384, P-521 or RSA key; the constructor checks
that it matches the key and that the JWK is the key's public half.

## Routes

Set each route's `payTo` to your **AWS Marketplace product ID**. The server scheme signs it into the
quote as `payTo` and as `settlement.product_id`. On the wire, `payTo` is replaced by the placeholder
`SENTINEL_PAY_TO` (`urn:x402:agentic-commerce:see-quote`); the signed quote carries the real value.

Other quote details come from the route's `extra`:

```typescript
import type { RouteConfig } from '@x402/core/server';

const weather: RouteConfig = {
  accepts: {
    scheme: 'exact',
    network: 'aws:base',
    payTo: 'prod-example123', // AWS Marketplace product ID
    // or '0.01 USD', 0.01 or { amount: '0.01', asset: 'iso4217:USD' }; at most 8 decimal places
    price: '$0.01',
    maxTimeoutSeconds: 300, // the quote's lifetime (default 300)
    extra: {
      description: 'Current weather',
      dimensions: { calls: 1 },
      reference: 'weather-v1', // defaults to 'RESOURCE'
    },
  },
  description: 'Current weather',
};
```

x402 matches a route's method exactly. Express (like several frameworks) answers `HEAD` with the
`GET` handler, so refuse or protect `HEAD` for every paid `GET` route, as the quick start does: add
an `app.head` for each one, or key the route `'* /path'` so that every method, `HEAD` included,
pays.

The 402's `maxTimeoutSeconds` equals the quote's lifetime. x402 builds the requirements again on the
buyer's paid retry, which signs a new quote token; the scheme declares `quoteToken` a dynamic field,
so x402 ignores it when matching the buyer's accepted requirements, and the facilitator checks the
quote the buyer actually paid for.

## The verifier and the facilitator

`AgenticCommerceVerifier` is the single check behind every payment. A `sellerKeyResolver` is
required, and the seller key is always the configured one, never one named or linked by the token:

| `sellerKeyResolver`                  | Key source                                                       |
| ------------------------------------ | ---------------------------------------------------------------- |
| `{ type: 'kms', kmsKeyArn, region }` | `kms:GetPublicKey` (cached for one hour). Optional `credentials` |
| `{ type: 'jwks', jwksUrl }`          | `{jwksUrl}/.well-known/jwks.json` (cached for one hour)          |
| `{ type: 'static', publicJwk }`      | A JWK the facilitator already holds                              |

Other options:

- `paymentTokenJwksUrl`: base URL of the payment service's signing keys. Defaults to the production
  endpoint. Those keys are cached for a minute, so a revoked key stops working within a minute.
- `jwksRequestHeaders`: extra headers for that request (an object, or a function returning one).
  They are never sent to a seller JWKS URL.
- `paymentTokenIssuer`: the expected `iss` of payment tokens. Defaults to `PAYMENT_TOKEN_ISSUER`.

`verify` checks, in order: that the requirements carry the quote the buyer accepted, the payment
token's signature and issuer, its expiry, that it was issued for the quote the buyer accepted, the
quote's signature with your key, that the token's audience is the quote's issuer, the quote's
expiry, the price and currency, and the product. Every JWKS request times out after 10 seconds and
does not follow redirects. Any failure, including an unreachable key, rejects the payment.

The facilitator can run in three ways:

- **In the seller's process**, as in the quick start: an `x402Facilitator` with
  `ExactAgenticCommerceFacilitatorScheme`, wrapped in `InProcessFacilitatorClient`.
- **As a separate service**: run the same `x402Facilitator` behind your own HTTP endpoint, and give
  the seller's `x402ResourceServer` an `HTTPFacilitatorClient` from `@x402/core/server`.
- **`AgenticCommerceFacilitatorClient`**, a `FacilitatorClient` that reads the supported kinds from
  an Agentic Commerce provider and verifies locally, with the same checks:

```typescript
import { x402ResourceServer } from '@x402/core/server';
import {
  AgenticCommerceFacilitatorClient,
  registerExactAgenticCommerceServer,
  type QuoteSigner,
} from '@aws/fiat-extension-for-x402';

declare const signer: QuoteSigner; // KmsQuoteSigner or LocalQuoteSigner, as above

const facilitatorClient = new AgenticCommerceFacilitatorClient({
  baseUrl: 'https://facilitator.example.com', // serves /.well-known/x402-supported
  sellerKeyResolver: { type: 'jwks', jwksUrl: 'https://api.example.com' },
  networkFilter: new Set(['aws:base' as const]), // claim only these networks
});
const server = registerExactAgenticCommerceServer(new x402ResourceServer([facilitatorClient]), {
  signer,
});
```

`settle` is a no-op in every case: the payment service captured the payment when it issued the
token. It returns the token's `payment_id` as the transaction, and the buyer (`sub`) as the payer.

## DPoP

When a payment token is bound to a key (`cnf.jkt`), the request must carry a `DPoP` header
(RFC 9449) proving possession of that key for this method, URL and payment token. The server scheme
checks this in its `onBeforeVerify` hook, which x402 runs before it calls the facilitator. To reject
replayed proofs, pass a `DPoPNonceStore` shared by all instances of the seller. The store is used
only after the facilitator has accepted the payment token, in the scheme's `onAfterVerify` hook, so
a forged token never adds an id; a replayed proof is refused after that facilitator call:

<!-- fragment: server, signer and store as above -->

```typescript
registerExactAgenticCommerceServer(server, {
  signer,
  dpopNonceStore: store,
  dpopMaxAgeSeconds: 60,
});
```

A `DPoPNonceStore` has `has(jti)` and `add(jti, expiresAt)`, either of which may be async. `add`
records the id until `expiresAt` (Unix seconds), `iat + floor(dpopMaxAgeSeconds + 5) + 1`, the first
second at which the proof is no longer accepted (`iat + 66` by default). `has` must return `true`
for the id while the time is before `expiresAt`; the store may forget it from then on. A store that
records the `jti` in `has`, which gets no expiry, should keep it for
`floor(dpopMaxAgeSeconds + 5) + 6` seconds (71 by default), since a proof may be used from 5 seconds
before its `iat`. An async store shared by several instances must record the `jti` atomically in
`has`, or two concurrent requests with the same proof can both pass. `dpopMaxAgeSeconds`
(default 60) limits how old a proof may be; 5 seconds of clock skew are allowed on either side.

The proof's `htu` must equal the URL the framework reports for the request (`HTTPAdapter.getUrl()`),
without its query and fragment. Nothing is normalised (scheme or host case, default port, trailing
slash). Behind a proxy or load balancer, configure the framework and the proxy so that the request
URL is the public one. `@x402/express`, for example, builds it from `req.protocol` (which honours
Express's `trust proxy` setting) and the `Host` header, so the proxy must forward the original
`Host`.

The facilitator does not check DPoP itself: a facilitator called without the server scheme's hook
(for example directly, outside `x402ResourceServer`) accepts a DPoP-bound token without a proof.

## Failure reasons

A rejected payment gets another `402`, and the facilitator's verify result carries the reason.
Verification never throws for an invalid payment.

| Reason            | Meaning                                                                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `invalid_payment` | The payment token is missing or not signed by the service, its issuer or audience is wrong, the amount or currency differs from the route, or the quote is for another product |
| `payment_expired` | The payment token has expired                                                                                                                                                  |
| `invalid_quote`   | The quote is missing, is not the one the payment token was issued for, or is not signed by the seller's configured key                                                         |
| `quote_expired`   | The quote has expired                                                                                                                                                          |
| `dpop_required`   | The payment token is bound to a key but the request has no `DPoP` header                                                                                                       |
| `dpop_invalid`    | The `DPoP` proof does not match the key, method, URL or token, is too old, or was replayed                                                                                     |

## Errors

Configuration errors throw. Every error class extends `AgenticCommerceError`, which has a `code`:

| Class             | Code               | Thrown when                                                                                                   |
| ----------------- | ------------------ | ------------------------------------------------------------------------------------------------------------- |
| `ValidationError` | `VALIDATION_ERROR` | A scheme, verifier, client or `jwksDocument` is misconfigured, or a route price cannot be parsed              |
| `SigningError`    | `SIGNING_ERROR`    | A quote signer is misconfigured, a PEM cannot be loaded, or the KMS `Sign` call fails or returns no signature |
| `DPoPError`       | `DPOP_ERROR`       | `verifyDPoPProof` or `extractDPoPThumbprint` rejects a proof                                                  |

When a PEM fails to load or the KMS `Sign` call fails, the original error is the `SigningError`'s
`cause`. A malformed DER signature from KMS is a plain `Error`, and an error from the signing
library itself is passed through.

```typescript
import { readFileSync } from 'node:fs';
import { LocalQuoteSigner, SigningError } from '@aws/fiat-extension-for-x402';

try {
  LocalQuoteSigner.fromPem(readFileSync('quote-key.pem'), {
    kid: 'quote-key-2026-10',
    serviceUrl: 'https://api.example.com',
  });
} catch (error) {
  if (error instanceof SigningError) {
    console.error(`Cannot load the quote key (${error.code}): ${error.message}`);
  }
  throw error;
}
```

## Security notes

- Keep private keys out of source control and out of images. Prefer `KmsQuoteSigner`; otherwise load
  the PEM from a mounted file or a secrets manager at startup.
- The verifier only trusts the seller key you configure. It never fetches a key from the quote's
  `iss` or from any URL in a token.
- Payment-token and quote signatures are limited to `ALLOWED_ALGORITHMS` (RS256, ES256, ES384,
  ES512). The list is frozen. DPoP proofs may also use PS256; `none` and HMAC are always refused.
- Use HTTPS for the seller URL and every JWKS URL.
- Accept each payment once: verification is stateless, so record the `payment_id` claim of each
  verified payment token (`extra.paymentId` of the verify response) in a store shared by all seller
  instances and refuse one already recorded. Never key on the `paymentId` in the payment payload:
  the buyer sets it and nothing checks it. See [Payment replay](docs/security.md#payment-replay).
- Share one `DPoPNonceStore` across all seller instances, and keep the request URL the framework
  sees equal to the public URL.
- Never call the facilitator outside `x402ResourceServer` for a request that may carry a DPoP-bound
  token, since only the server scheme's hook checks the proof.

See [docs/security.md](docs/security.md) for more. To report a vulnerability, see
[AWS vulnerability reporting](https://aws.amazon.com/security/vulnerability-reporting/).

## Versioning

This package follows [semantic versioning](https://semver.org). The public API is every name
exported from `@aws/fiat-extension-for-x402` and
`@aws/fiat-extension-for-x402/agentic-commerce/exact`; removing or renaming one needs a new major
version.

## Development

```bash
npm ci --ignore-scripts
npm run typecheck && npm run typecheck:test && npm run typecheck:examples
npm run lint && npm run format:check
npm run test:coverage
```

## License

This project is licensed under the Apache-2.0 License.
