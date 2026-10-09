# Security Guide

## Overview

The `@aws/fiat-extension-for-x402` SDK implements several security measures to protect payment flows between AI agents, API services, and the AWS Marketplace Agent Pay Service.

## Algorithm Allowlist

Only the following JWT signing algorithms are accepted:

- **RS256** — RSA with SHA-256 (service quote token signing)
- **ES256** — ECDSA P-256 (DPoP keys)
- **ES384** — ECDSA P-384 (Agent Pay payment token signing)
- **ES512** — ECDSA P-521 (DPoP keys)

Symmetric algorithms (HS256, HS384, HS512) and `"none"` are explicitly rejected. This prevents algorithm confusion attacks where an attacker could forge tokens using the public key as an HMAC secret.

The allowlist is enforced at every `jwtVerify` call site via the `algorithms` option.

## Constant-Time Comparison

All sensitive string comparisons (quote tokens, payment IDs) use `crypto.timingSafeEqual` via the `secureCompare()` utility. This prevents timing attacks where an attacker could determine how many characters of a token match by measuring response time.

Affected code paths:
- Quote token matching (facilitator verify)
- Payment ID matching (facilitator verify)

## Token Expiry Enforcement

Token expiry is checked before any further processing:
- Quote tokens: checked during facilitator verification (`quote_expired` error)
- Payment tokens: checked during facilitator verification (`payment_expired` error)
- DPoP proofs: checked by the server scheme before verification (`iat` within `dpopMaxAgeSeconds` plus 5 seconds of skew)

## Secure Random Generation

All nonces, JTIs, and client tokens use `crypto.randomUUID()` (Node.js built-in CSPRNG). No custom random implementations are used.

## URL Validation

The `validateUrl()` utility enforces:
- HTTPS protocol required for production URLs
- HTTP allowed only for `localhost` / `127.0.0.1` (development)
- Well-formed URL structure (rejects malformed strings)

## DPoP (Proof-of-Possession)

DPoP binds payment tokens to ephemeral client keys, preventing token theft:
- Agent Pay binds via `cnf.jkt` (SHA-256 thumbprint) in the payment token
- The `exact` server scheme's `onBeforeVerify` hook requires a `DPoP` proof whose key thumbprint matches, before the facilitator is called
- Proofs must be signed with ES256, ES384, ES512, RS256 or PS256 (never HS* or `none`)
- `htm`, `htu` (without query and fragment, not normalised) and `ath` must match the request and the payment token
- Replay is rejected with a `dpopNonceStore` shared by all seller instances

## Sensitive Data Handling

The SDK does NOT log:
- Private keys
- Payment tokens
- Quote tokens (contain pricing information)
- AWS credentials

Error messages include contextual information (HTTP status codes, field names) but never include token values or key material.

## Common Pitfalls

1. **Don't disable HTTPS** — The `validateUrl` utility allows HTTP only for localhost. Never use HTTP in production.

2. **Don't skip token verification** — Always verify payment token signatures before delivering resources.

3. **Don't reuse DPoP keys** — Generate a fresh key pair per session using `generateDPoPKeyPair()`.

4. **Don't hardcode credentials** — Use environment variables or AWS credential providers for SigV4 authentication.

5. **Don't ignore `clientToken` conflicts** — A 409 response means the same idempotency key was used with different parameters. This could indicate a replay attempt.

## Reporting Security Issues

If you discover a security vulnerability, please report it through your organization's security reporting channel. Do not open a public issue.
