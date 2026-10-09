// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Cross-language test vectors (TEST KEYS ONLY), minted with the Python SDK
 * (fiat_extension_x402 1.0.0 at commit 62230e6, PyJWT 2.15.1). ECDSA signatures
 * are randomised, so these bytes are fixed fixtures: do not regenerate them.
 *
 * The seller key is derived from the label "fiat-x402-fixture-seller-v1"; it is
 * not a secret, and only its public half is needed here.
 */

/** time() pinned by the Python probe */
export const FIXED_NOW = 1790000000;

/** uuid4() pinned by the Python probe */
export const FIXED_JTI = '00000000-0000-4000-8000-000000000001';

/** LocalQuoteSigner.from_pem(kid='fixture-seller-1', service_url=SELLER_URL).public_jwk */
export const SELLER_PUBLIC_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'mp_RPHXbeJ21oBjtde5uuNzTZOtPoNYuyH-rvx3aUHo',
  y: 'DO2fjqXVHzhr3KiNITqpVq0IJztKnH5xoNUqN63Lpcc',
  alg: 'ES256',
  kid: 'fixture-seller-1',
  use: 'sig',
} as const;

export const SELLER_URL = 'https://seller.example.com';

/** enhance_payment_requirements input */
export const QUOTE_INPUT = {
  scheme: 'exact',
  network: 'aws:base',
  asset: 'iso4217:USD',
  amount: '0.10',
  payTo: 'prod-fixture123',
  maxTimeoutSeconds: 300,
  extra: { description: 'Weather', settlement: { mode: 'immediate' } },
} as const;

/** enhance_payment_requirements output; `extra.quoteToken` is QUOTE_TOKEN */
export const QUOTE_TOKEN =
  'eyJhbGciOiJFUzI1NiIsImtpZCI6ImZpeHR1cmUtc2VsbGVyLTEiLCJ0eXAiOiJKV1QifQ.eyJpc3MiOiJodHRwczovL3NlbGxlci5leGFtcGxlLmNvbSIsImF1ZCI6ImF3czptYXJrZXRwbGFjZSIsImlhdCI6MTc5MDAwMDAwMCwiZXhwIjoxNzkwMDAwMzAwLCJqdGkiOiIwMDAwMDAwMC0wMDAwLTQwMDAtODAwMC0wMDAwMDAwMDAwMDEiLCJwcmljZSI6eyJhbW91bnQiOiIwLjEwIiwiY3VycmVuY3kiOiJVU0QifSwicGF5VG8iOiJwcm9kLWZpeHR1cmUxMjMiLCJyZWZlcmVuY2UiOiJSRVNPVVJDRSIsInNldHRsZW1lbnQiOnsibW9kZSI6ImltbWVkaWF0ZSIsInByb2R1Y3RfaWQiOiJwcm9kLWZpeHR1cmUxMjMifSwiZGVzY3JpcHRpb24iOiJXZWF0aGVyIn0.k298wVylkQg0qJgrrDw9tvxcGpxbP_LnKRofzJ0dFrU2lFXvvmD4OHQGA9g7v-uffpoqzN9FPzAJU-_6RfcePA';

export const QUOTE_OUTPUT = {
  scheme: 'exact',
  network: 'aws:base',
  asset: 'iso4217:USD',
  amount: '0.10',
  payTo: 'urn:x402:agentic-commerce:see-quote',
  maxTimeoutSeconds: 300,
  extra: { description: 'Weather', settlement: { mode: 'immediate' }, quoteToken: QUOTE_TOKEN },
} as const;

/** The quote payload in Python's exact byte order */
export const QUOTE_PAYLOAD_JSON =
  '{"iss":"https://seller.example.com","aud":"aws:marketplace","iat":1790000000,"exp":1790000300,"jti":"00000000-0000-4000-8000-000000000001","price":{"amount":"0.10","currency":"USD"},"payTo":"prod-fixture123","reference":"RESOURCE","settlement":{"mode":"immediate","product_id":"prod-fixture123"},"description":"Weather"}';
