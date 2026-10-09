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

/** The service JWKS, served at `{base}/.well-known/jwks.json` */
export const SERVICE_JWKS = {
  keys: [
    {
      kty: 'EC',
      crv: 'P-384',
      x: 'WWj23aoYPYoVbEYYIg7ZVb9VzXSD2mRnut-_Dn0uk0JJfRJRXlj6B-4t5YFuZgZd',
      y: 'giaq5nHOyDsWeRFL3FhCiwCATWfj8c-UDvrZm1pM1W9HBAwjW6SuNyx2PE3nuCl3',
      kid: 'fixture-service-1',
      alg: 'ES384',
      use: 'sig',
    },
  ],
} as const;

/**
 * Payment token (ES384, service key) for QUOTE_TOKEN: iss=PAYMENT_TOKEN_ISSUER,
 * aud=SELLER_URL, sub=PAYMENT_PAYER, payment_id=jti=PAYMENT_ID,
 * iat=FIXED_NOW, exp=FIXED_NOW+300, cnf.jkt=BUYER_JKT
 */
export const PAYMENT_TOKEN =
  'eyJhbGciOiJFUzM4NCIsImtpZCI6ImZpeHR1cmUtc2VydmljZS0xIiwidHlwIjoiSldUIn0.eyJpc3MiOiJhd3NtcC1hZ2VudHBheS5hbWF6b25hd3MuY29tIiwiYXVkIjoiaHR0cHM6Ly9zZWxsZXIuZXhhbXBsZS5jb20iLCJzdWIiOiIxMjM0NTY3ODkwMTIiLCJwYXltZW50X2lkIjoiYXdzbXAtZml4dHVyZS0wMDAxIiwianRpIjoiYXdzbXAtZml4dHVyZS0wMDAxIiwicXVvdGVfdG9rZW4iOiJleUpoYkdjaU9pSkZVekkxTmlJc0ltdHBaQ0k2SW1acGVIUjFjbVV0YzJWc2JHVnlMVEVpTENKMGVYQWlPaUpLVjFRaWZRLmV5SnBjM01pT2lKb2RIUndjem92TDNObGJHeGxjaTVsZUdGdGNHeGxMbU52YlNJc0ltRjFaQ0k2SW1GM2N6cHRZWEpyWlhSd2JHRmpaU0lzSW1saGRDSTZNVGM1TURBd01EQXdNQ3dpWlhod0lqb3hOemt3TURBd016QXdMQ0pxZEdraU9pSXdNREF3TURBd01DMHdNREF3TFRRd01EQXRPREF3TUMwd01EQXdNREF3TURBd01ERWlMQ0p3Y21salpTSTZleUpoYlc5MWJuUWlPaUl3TGpFd0lpd2lZM1Z5Y21WdVkza2lPaUpWVTBRaWZTd2ljR0Y1Vkc4aU9pSndjbTlrTFdacGVIUjFjbVV4TWpNaUxDSnlaV1psY21WdVkyVWlPaUpTUlZOUFZWSkRSU0lzSW5ObGRIUnNaVzFsYm5RaU9uc2liVzlrWlNJNkltbHRiV1ZrYVdGMFpTSXNJbkJ5YjJSMVkzUmZhV1FpT2lKd2NtOWtMV1pwZUhSMWNtVXhNak1pZlN3aVpHVnpZM0pwY0hScGIyNGlPaUpYWldGMGFHVnlJbjAuazI5OHdWeWxrUWcwcUpncnJEdzl0dnhjR3B4YlBfTG5LUm9mekowZEZyVTJsRlh2dm1ENE9IUUdBOWc3di11ZmZwb3F6TjlGUHpBSlUtXzZSZmNlUEEiLCJpYXQiOjE3OTAwMDAwMDAsImV4cCI6MTc5MDAwMDMwMCwiY25mIjp7ImprdCI6InQ5blR2Si1wSk9TTkpvZmVMZ09Uek9ySDlZdzBfOFJKSWd5SE9PLWdHQ2cifX0.7grSp_Q7be5VmDc5DloBEjT6MQ6775qNpKwCStwRRiP_OgRZjcjmhAWLlKMj6J7U5s1_kmnCzmxxNaCgvn2yvk7G_D1vSJ_JScPVnpDdb7R_prDOm-OYuVNBynqz0AWd';

export const PAYMENT_PAYER = '123456789012';
export const PAYMENT_ID = 'awsmp-fixture-0001';
export const BUYER_JKT = 't9nTvJ-pJOSNJofeLgOTzOrH9Yw0_8RJIgyHOO-gGCg';
