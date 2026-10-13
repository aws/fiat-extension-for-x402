// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Fixed, known-good test vectors (TEST KEYS ONLY): a quote token, a payment
 * token and a DPoP proof, at a fixed time and jti, with the public keys that
 * verify them. ECDSA signatures are randomised, so these bytes are fixed
 * fixtures: do not regenerate them.
 *
 * The seller and buyer private keys are derived from labels at test time (see
 * sellerPrivateKey and buyerPrivateKey); they are not secrets. The payment
 * token's service key is not included: only its public JWKS.
 */

import { createHash, createPrivateKey, type KeyObject } from 'crypto';

/** The fixed current time, in seconds, at which the vectors were signed */
export const FIXED_NOW = 1790000000;

/** The fixed quote jti */
export const FIXED_JTI = '00000000-0000-4000-8000-000000000001';

/** The seller's public JWK, as LocalQuoteSigner.publicJwk gives it for kid 'fixture-seller-1' */
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

/** enhancePaymentRequirements input */
export const QUOTE_INPUT = {
  scheme: 'exact',
  network: 'aws:base',
  asset: 'iso4217:USD',
  amount: '0.10',
  payTo: 'prod-fixture123',
  maxTimeoutSeconds: 300,
  extra: { description: 'Weather', settlement: { mode: 'immediate' } },
} as const;

/** enhancePaymentRequirements output; `extra.quoteToken` is QUOTE_TOKEN */
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

/** The quote payload of QUOTE_TOKEN, byte for byte */
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

/** The buyer's DPoP public JWK; its RFC 7638 thumbprint is BUYER_JKT */
export const BUYER_PUBLIC_JWK = {
  kty: 'EC',
  crv: 'P-256',
  x: 'h9RYB7K40yUyXrZJ6SKDFSTeM_7cNh2OYnacpNO53ik',
  y: 'zKbWdpdwVqcF9t_oMtR2cfrW7vGi_xY-eIh81RXVsfg',
} as const;

/**
 * The buyer's DPoP private key, derived from a label: the P-256 scalar is
 * SHA-512("fiat-x402-fixture-buyer-v1"), read as a big-endian integer, mod n. A test key,
 * not a secret; no private key is stored in the repository.
 */
export function buyerPrivateKey(): KeyObject {
  const n = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const digest = createHash('sha512').update('fiat-x402-fixture-buyer-v1').digest('hex');
  const d = (BigInt(`0x${digest}`) % n).toString(16).padStart(64, '0');
  return createPrivateKey({
    key: { ...BUYER_PUBLIC_JWK, d: Buffer.from(d, 'hex').toString('base64url') },
    format: 'jwk',
  });
}

/**
 * The seller's quote-signing private key, derived from a label: the P-256
 * scalar is SHA-512("fiat-x402-fixture-seller-v1"), read as a big-endian
 * integer, mod n.
 * A test key, not a secret; no private key is stored in the repository.
 */
export function sellerPrivateKey(): KeyObject {
  const n = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
  const digest = createHash('sha512').update('fiat-x402-fixture-seller-v1').digest('hex');
  const d = (BigInt(`0x${digest}`) % n).toString(16).padStart(64, '0');
  const { kty, crv, x, y } = SELLER_PUBLIC_JWK;
  return createPrivateKey({
    key: { kty, crv, x, y, d: Buffer.from(d, 'hex').toString('base64url') },
    format: 'jwk',
  });
}

/** `htu` of DPOP_PROOF */
export const DPOP_HTU = `${SELLER_URL}/weather`;

/** `ath` of DPOP_PROOF: base64url of SHA-256 over PAYMENT_TOKEN */
export const DPOP_ATH = '3Ot2l6R3W8rB47ia2TJzd3q1OGBBjO2z0aY6qag75zE';

/**
 * DPoP proof (ES256, typ dpop+jwt, jwk=BUYER_PUBLIC_JWK) for PAYMENT_TOKEN:
 * htm=GET, htu=DPOP_HTU, iat=FIXED_NOW, jti=dpop-fixture-0001, ath=DPOP_ATH.
 * Valid until FIXED_NOW+65 with the default maximum age of 60 seconds.
 */
export const DPOP_PROOF =
  'eyJhbGciOiJFUzI1NiIsImp3ayI6eyJjcnYiOiJQLTI1NiIsImt0eSI6IkVDIiwieCI6Img5UllCN0s0MHlVeVhyWko2U0tERlNUZU1fN2NOaDJPWW5hY3BOTzUzaWsiLCJ5IjoiektiV2RwZHdWcWNGOXRfb010UjJjZnJXN3ZHaV94WS1lSWg4MVJYVnNmZyJ9LCJ0eXAiOiJkcG9wK2p3dCJ9.eyJqdGkiOiJkcG9wLWZpeHR1cmUtMDAwMSIsImh0bSI6IkdFVCIsImh0dSI6Imh0dHBzOi8vc2VsbGVyLmV4YW1wbGUuY29tL3dlYXRoZXIiLCJpYXQiOjE3OTAwMDAwMDAsImF0aCI6IjNPdDJsNlIzVzhyQjQ3aWEyVEp6ZDNxMU9HQkJqTzJ6MGFZNnFhZzc1ekUifQ.gIXQias_MZ00pgSYfT2JjIpkQQ7Jitq9N2fJKQMhlIlPbKl1dqRkVCcDWUI_NmkdOEgnVmzHUovqL8V8XcRENQ';
