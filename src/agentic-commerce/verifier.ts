// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Payment token verification.
 *
 * A buyer pays for a request by presenting a payment token: a JWT issued and
 * signed by the AWS Marketplace Agentic Commerce service that embeds the quote
 * token the seller signed. Verification is cryptographic and needs no call to
 * the service other than fetching its public keys.
 */

import { createPublicKey, type KeyObject } from 'node:crypto';
import { compactVerify, decodeProtectedHeader } from 'jose';
import {
  DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL,
  PAYMENT_TOKEN_ISSUER,
  WELL_KNOWN_JWKS_PATH,
} from '../constants';
import { ALLOWED_ALGORITHMS, secureCompare } from '../security';
import { ValidationError } from '../types';
import type { KmsSellerKeyResolver, SellerKeyResolver } from './keys';
import {
  isPlainObject,
  isTruthy,
  looseEquals,
  toInteger,
  displayText,
  rstripSlashes,
} from './json-value';

// Seller keys (JWKS or KMS) are cached for an hour. The service's own keys are
// fetched on every verification: its JWKS endpoint sends Cache-Control: no-store
// so that a revoked key stops being accepted immediately.
const SELLER_KEY_CACHE_TTL_MS = 3_600_000;

// Timeout of every JWKS request.
const JWKS_FETCH_TIMEOUT_MS = 10_000;

/** Reasons a payment is invalid. The DPoP reasons are reported by the server scheme. */
export type AgenticCommerceInvalidReason =
  | 'invalid_payment'
  | 'payment_expired'
  | 'invalid_quote'
  | 'quote_expired'
  | 'dpop_required'
  | 'dpop_invalid';

/** Outcome of verifying a payment token */
export interface VerificationResult {
  /** Whether the payment is valid */
  isValid: boolean;
  /** Machine-readable reason when invalid */
  invalidReason?: AgenticCommerceInvalidReason;
  /** Human-readable detail when invalid */
  invalidMessage?: string;
  /** The buyer identifier (`sub` claim), when valid */
  payer?: string;
  /** The payment identifier (`payment_id` claim), when valid */
  paymentId?: string;
}

/** The terms a payment claims to satisfy, with wire field names */
export interface VerificationRequirements {
  /** The price the server requires, as a decimal string */
  amount?: string;
  /** The asset the server requires, for example `iso4217:USD` */
  asset?: string;
  /** `extra.quoteToken` is the quote the buyer accepted */
  extra?: Record<string, unknown>;
  /**
   * The route's AWS Marketplace product ID. When given, the quote's `payTo`
   * and `settlement.product_id` must equal it.
   */
  productId?: string;
}

/** Headers sent with the payment-token JWKS request */
export type JwksRequestHeaders =
  Record<string, string> | (() => Record<string, string> | Promise<Record<string, string>>);

/** Configuration of {@link AgenticCommerceVerifier} */
export interface AgenticCommerceVerifierConfig {
  /** Where to find the seller's quote-signing key. Required. */
  sellerKeyResolver: SellerKeyResolver;
  /** Base URL of the service's JWKS. Defaults to the production endpoint. */
  paymentTokenJwksUrl?: string;
  /**
   * Extra headers sent when fetching the service's JWKS. The production JWKS
   * needs none. Never sent to a seller JWKS URL.
   */
  jwksRequestHeaders?: JwksRequestHeaders;
  /** Expected `iss` of payment tokens. Defaults to {@link PAYMENT_TOKEN_ISSUER}. */
  paymentTokenIssuer?: string;
}

/**
 * A JWT validation failure. When the verifier tries several keys, only this
 * kind of error moves on to the next key.
 *
 * @internal
 */
export class JwtError extends Error {}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function invalid(reason: AgenticCommerceInvalidReason, message: string): VerificationResult {
  return { isValid: false, invalidReason: reason, invalidMessage: message };
}

/**
 * Verifies payment tokens against the requirements they claim to satisfy.
 *
 * Verification steps:
 *
 * 1. Verify the payment token's signature with the service's JWKS.
 * 2. Check its issuer is the service and it has not expired.
 * 3. Check the quote token embedded in it equals the quote in the
 *    requirements (constant-time comparison).
 * 4. Verify the quote token's signature with the seller's key, which the
 *    seller configures; it is never discovered from the token.
 * 5. Check the payment token's audience is the quote's issuer, and the quote
 *    has not expired.
 * 6. Check the quote's price matches the requirements' amount and currency
 *    and, when the requirements name the product, the quote's product.
 *
 * DPoP binding (`cnf.jkt`) is not checked here.
 *
 * @example
 * ```typescript
 * const verifier = new AgenticCommerceVerifier({
 *   sellerKeyResolver: { type: 'kms', kmsKeyArn, region: 'us-east-1' },
 * });
 * ```
 */
export class AgenticCommerceVerifier {
  private readonly paymentTokenJwksUrl: string;
  private readonly jwksRequestHeaders: JwksRequestHeaders;
  private readonly paymentTokenIssuer: string;
  private readonly sellerKeyResolver: SellerKeyResolver;
  private readonly sellerKeyCache = new Map<string, { value: unknown; time: number }>();

  /**
   * @param config - The seller key resolver and the payment-token JWKS options
   * @throws ValidationError if `sellerKeyResolver` is missing or of an unknown type
   */
  constructor(config: AgenticCommerceVerifierConfig) {
    validateSellerKeyResolver(config?.sellerKeyResolver);
    const base = rstripSlashes(config.paymentTokenJwksUrl || DEFAULT_PAYMENT_TOKEN_JWKS_BASE_URL);
    this.paymentTokenJwksUrl = `${base}${WELL_KNOWN_JWKS_PATH}`;
    const headers = config.jwksRequestHeaders ?? {};
    this.jwksRequestHeaders = typeof headers === 'function' ? headers : { ...headers };
    this.paymentTokenIssuer = config.paymentTokenIssuer ?? PAYMENT_TOKEN_ISSUER;
    this.sellerKeyResolver = config.sellerKeyResolver;
  }

  /**
   * Verify a payment token.
   *
   * @param paymentToken - The payment token JWT
   * @param requirements - The requirements the payment claims to satisfy
   * @returns The verification outcome. Never throws for an invalid payment.
   */
  async verify(
    paymentToken: string,
    requirements: VerificationRequirements
  ): Promise<VerificationResult> {
    const extra: unknown = requirements.extra;
    const expectedQuoteToken = isPlainObject(extra) ? extra.quoteToken : undefined;
    if (!isTruthy(expectedQuoteToken)) {
      return invalid('invalid_quote', 'Missing quoteToken in payment requirements');
    }

    let paymentClaims: Record<string, unknown>;
    try {
      const headers =
        typeof this.jwksRequestHeaders === 'function'
          ? await this.jwksRequestHeaders()
          : this.jwksRequestHeaders;
      const paymentJwks = await fetchJwks(this.paymentTokenJwksUrl, headers);
      paymentClaims = await verifyWithJwks(paymentToken, paymentJwks);
    } catch (error) {
      return invalid('invalid_payment', `Payment token signature invalid: ${errorMessage(error)}`);
    }

    const now = Math.floor(Date.now() / 1000);
    if (!looseEquals(paymentClaims.iss, this.paymentTokenIssuer)) {
      return invalid('invalid_payment', 'Payment token issuer is not the payment service');
    }
    const exp = paymentClaims.exp;
    if (!Number.isInteger(exp) || (exp as number) < now) {
      return invalid('payment_expired', 'Payment token expired');
    }

    const quoteToken = paymentClaims.quote_token;
    if (typeof quoteToken !== 'string' || !quoteToken) {
      return invalid('invalid_quote', 'Missing quote token in payment token');
    }
    if (!secureCompare(quoteToken, displayText(expectedQuoteToken))) {
      return invalid('invalid_quote', 'Payment token was issued for a different quote');
    }

    let quoteClaims: Record<string, unknown>;
    try {
      quoteClaims = await this.verifyQuote(quoteToken);
    } catch (error) {
      return invalid('invalid_quote', `Quote token signature invalid: ${errorMessage(error)}`);
    }

    if (!looseEquals(paymentClaims.aud, quoteClaims.iss)) {
      return invalid('invalid_payment', 'Payment token audience is not the quote issuer');
    }
    const quoteExp = quoteClaims.exp;
    if (!Number.isInteger(quoteExp) || (quoteExp as number) < now) {
      return invalid('quote_expired', 'Quote token expired');
    }

    const price = quoteClaims.price;
    const asset = requirements.asset === undefined ? '' : displayText(requirements.asset);
    const currency = asset.replaceAll('iso4217:', '');
    if (
      !isPlainObject(price) ||
      !looseEquals(price.amount, requirements.amount) ||
      !looseEquals(price.currency, currency)
    ) {
      return invalid('invalid_payment', 'Amount or currency mismatch');
    }

    // x402 core does not match on the product, so bind it here.
    if (requirements.productId !== undefined) {
      const settlement = quoteClaims.settlement;
      if (
        !looseEquals(quoteClaims.payTo, requirements.productId) ||
        !isPlainObject(settlement) ||
        !looseEquals(settlement.product_id, requirements.productId)
      ) {
        return invalid('invalid_payment', 'Quote is for a different product');
      }
    }

    return {
      isValid: true,
      payer: typeof paymentClaims.sub === 'string' ? paymentClaims.sub : undefined,
      paymentId:
        typeof paymentClaims.payment_id === 'string' ? paymentClaims.payment_id : undefined,
    };
  }

  private async verifyQuote(quoteToken: string): Promise<Record<string, unknown>> {
    const resolver = this.sellerKeyResolver;
    switch (resolver.type) {
      case 'kms':
        return verifyWithKey(quoteToken, await this.kmsPublicKey(resolver));
      case 'static':
        return verifyWithJwks(quoteToken, { keys: [resolver.publicJwk] });
      case 'jwks': {
        const url = `${rstripSlashes(resolver.jwksUrl)}${WELL_KNOWN_JWKS_PATH}`;
        // Seller JWKS URLs never receive the payment-token JWKS headers.
        return verifyWithJwks(quoteToken, await this.cached(url, () => fetchJwks(url, {})));
      }
      default:
        throw new ValidationError('A seller key resolver is required to verify quote tokens');
    }
  }

  private async cached<T>(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.sellerKeyCache.get(key);
    const now = Date.now();
    if (hit !== undefined && now - hit.time < SELLER_KEY_CACHE_TTL_MS) {
      return hit.value as T;
    }
    const value = await load();
    this.sellerKeyCache.set(key, { value, time: now });
    return value;
  }

  private kmsPublicKey(resolver: KmsSellerKeyResolver): Promise<KeyObject> {
    return this.cached(`kms:${resolver.kmsKeyArn}`, async () => {
      // Imported lazily so the KMS path costs nothing when unused.
      const { GetPublicKeyCommand, KMSClient } = await import('@aws-sdk/client-kms');
      const client =
        resolver.kmsClient ??
        new KMSClient({
          region: resolver.region,
          ...(resolver.credentials ? { credentials: await resolver.credentials() } : {}),
        });
      const response = await client.send(new GetPublicKeyCommand({ KeyId: resolver.kmsKeyArn }));
      if (!response.PublicKey?.length) {
        throw new ValidationError('KMS GetPublicKey returned no key material');
      }
      return createPublicKey({ key: Buffer.from(response.PublicKey), format: 'der', type: 'spki' });
    });
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Fail at startup, not on every payment, when the resolver is misconfigured. */
function validateSellerKeyResolver(resolver: unknown): void {
  const r: Record<string, unknown> = isPlainObject(resolver) ? resolver : {};
  const valid =
    (r.type === 'kms' && isNonEmptyString(r.kmsKeyArn) && isNonEmptyString(r.region)) ||
    (r.type === 'jwks' && isNonEmptyString(r.jwksUrl)) ||
    (r.type === 'static' && isPlainObject(r.publicJwk));
  if (!valid) {
    throw new ValidationError(
      "sellerKeyResolver is required: { type: 'kms', kmsKeyArn, region } | " +
        "{ type: 'jwks', jwksUrl } | { type: 'static', publicJwk }"
    );
  }
}

async function fetchJwks(url: string, headers: Record<string, string>): Promise<unknown> {
  // Redirects are not followed, so the headers never reach another host.
  const response = await fetch(url, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(JWKS_FETCH_TIMEOUT_MS),
  });
  if (response.status !== 200) {
    throw new ValidationError(`Failed to fetch JWKS from ${url}: HTTP ${response.status}`);
  }
  return response.json();
}

function unverifiedHeader(token: string): Record<string, unknown> {
  if (typeof token !== 'string' || token.split('.').length < 3) {
    throw new JwtError('Not enough segments');
  }
  try {
    return decodeProtectedHeader(token);
  } catch (error) {
    throw new JwtError(errorMessage(error));
  }
}

/** Verify with the key named by `kid`; without a `kid`, with any key in the set. */
async function verifyWithJwks(token: string, jwks: unknown): Promise<Record<string, unknown>> {
  const kid = unverifiedHeader(token).kid ?? null;
  if (!isPlainObject(jwks)) {
    throw new ValidationError('JWKS must be a JSON object');
  }
  const keys = jwks.keys ?? [];
  if (!Array.isArray(keys)) {
    throw new ValidationError('JWKS keys must be a list');
  }
  const candidates = keys.filter((key: unknown) => {
    if (kid === null) return true;
    if (!isPlainObject(key)) throw new ValidationError('JWKS keys must be JSON objects');
    return looseEquals(key.kid, kid);
  });
  if (candidates.length === 0) {
    throw new ValidationError('No matching key found in JWKS');
  }
  let lastError: Error = new ValidationError('No matching key found in JWKS');
  for (const keyData of candidates) {
    try {
      return await verifyWithKey(token, importJwk(keyData));
    } catch (error) {
      if (!(error instanceof JwtError)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

// Algorithm family of each JWK `kty`, and the default `alg` of each EC curve.
const KEY_TYPE_ALGORITHMS: Record<string, RegExp> = {
  EC: /^ES(256|256K|384|512)$/,
  RSA: /^(RS|PS)(256|384|512)$/,
  OKP: /^(EdDSA|Ed25519)$/,
};
const EC_CURVE_ALGORITHMS: Record<string, string> = {
  'P-256': 'ES256',
  'P-384': 'ES384',
  'P-521': 'ES512',
  secp256k1: 'ES256K',
};

/**
 * A public key from a JWK. A JWK without `kty`, or with an `alg` (given or
 * implied by its curve) outside its key type's family, is rejected.
 *
 * @internal
 */
export function importJwk(keyData: unknown): KeyObject {
  if (!isPlainObject(keyData)) {
    throw new ValidationError('JWKS keys must be JSON objects');
  }
  const kty = keyData.kty;
  if (!isTruthy(kty)) {
    throw new JwtError(`kty is not found: ${JSON.stringify(keyData)}`);
  }
  let alg = keyData.alg;
  if (!isTruthy(alg)) {
    const crv = keyData.crv;
    if (kty === 'EC') {
      alg = isTruthy(crv) ? EC_CURVE_ALGORITHMS[displayText(crv)] : 'ES256';
      if (alg === undefined) throw new JwtError(`Unsupported crv: ${displayText(crv)}`);
    } else if (kty === 'RSA') {
      alg = 'RS256';
    } else if (kty === 'OKP') {
      if (!isTruthy(crv)) throw new JwtError(`crv is not found: ${JSON.stringify(keyData)}`);
      if (crv !== 'Ed25519') throw new JwtError(`Unsupported crv: ${displayText(crv)}`);
      alg = 'EdDSA';
    } else {
      throw new JwtError(`Unsupported kty: ${displayText(kty)}`);
    }
  }
  const family = KEY_TYPE_ALGORITHMS[displayText(kty)];
  if (family === undefined || typeof alg !== 'string' || !family.test(alg)) {
    throw new JwtError(`Unable to find an algorithm for key: ${JSON.stringify(keyData)}`);
  }
  try {
    return createPublicKey({ key: keyData, format: 'jwk' });
  } catch (error) {
    throw new JwtError(`Unable to construct key from JWK: ${errorMessage(error)}`);
  }
}

async function verifyWithKey(token: string, key: KeyObject): Promise<Record<string, unknown>> {
  const alg = unverifiedHeader(token).alg ?? '';
  if (typeof alg !== 'string' || !ALLOWED_ALGORITHMS.includes(alg)) {
    throw new ValidationError(`Algorithm not allowed: ${displayText(alg)}`);
  }
  let payload: Uint8Array;
  try {
    ({ payload } = await compactVerify(token, key, { algorithms: ALLOWED_ALGORITHMS }));
  } catch (error) {
    const signatureFailed =
      (error as { code?: unknown }).code === 'ERR_JWS_SIGNATURE_VERIFICATION_FAILED';
    throw new JwtError(signatureFailed ? 'Signature verification failed' : errorMessage(error));
  }
  const claims = parseClaims(payload);
  validateRegisteredClaims(claims);
  return claims;
}

/** @internal */
export function parseClaims(payload: Uint8Array): Record<string, unknown> {
  let claims: unknown;
  try {
    claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
  } catch (error) {
    throw new JwtError(`Invalid payload string: ${errorMessage(error)}`);
  }
  if (!isPlainObject(claims)) {
    throw new JwtError('Invalid payload string: must be a json object');
  }
  return claims;
}

/**
 * The registered-claim checks made on every verified token: `iat` and `nbf`
 * must be integers and not in the future (no leeway), and `sub` and `jti`
 * must be strings. Expiry and audience are not checked here: the verifier
 * checks the payment token's `exp` and `aud` and the quote token's `exp` (not
 * its `aud`), and DPoP proofs check freshness from `iat` instead. With
 * `verifyIat: false`, `iat` is not checked.
 *
 * @internal
 */
export function validateRegisteredClaims(
  claims: Record<string, unknown>,
  { verifyIat = true }: { verifyIat?: boolean } = {}
): void {
  const now = Date.now() / 1000;
  if (verifyIat && Object.hasOwn(claims, 'iat')) {
    const iat = toInteger(claims.iat);
    if (iat === undefined) throw new JwtError('Issued At claim (iat) must be an integer.');
    if (iat > now) throw new JwtError('The token is not yet valid (iat)');
  }
  if (Object.hasOwn(claims, 'nbf')) {
    const nbf = toInteger(claims.nbf);
    if (nbf === undefined) throw new JwtError('Not Before claim (nbf) must be an integer.');
    if (nbf > now) throw new JwtError('The token is not yet valid (nbf)');
  }
  if (Object.hasOwn(claims, 'sub') && typeof claims.sub !== 'string') {
    throw new JwtError('Subject must be a string');
  }
  if (Object.hasOwn(claims, 'jti') && typeof claims.jti !== 'string') {
    throw new JwtError('JWT ID must be a string');
  }
}
