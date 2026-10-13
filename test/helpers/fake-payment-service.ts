// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Test doubles: a fake payment service, a seller key, and a JWKS-serving fetch.
 *
 * The payment service issues payment tokens in production; tests sign them with
 * a local key, so the seller and facilitator code paths run offline.
 */

import { vi } from 'vitest';
import * as jose from 'jose';
import { PAYMENT_TOKEN_ISSUER } from '../../src/constants';
import type { QuoteSigner } from '../../src/signers/protocol';
import { toQuoteSigner } from '../../src/signers';

export const SERVICE_JWKS_BASE_URL = 'https://jwks.payments.test';
export const SERVICE_JWKS_URL = `${SERVICE_JWKS_BASE_URL}/.well-known/jwks.json`;
export const SELLER_URL = 'https://seller.example.com';
export const BUYER = '123456789012';

/** An EC key pair and its public JWK */
export async function ecKey(
  kid: string,
  alg: 'ES256' | 'ES384' = 'ES256'
): Promise<{ privateKey: jose.KeyLike; jwk: jose.JWK }> {
  const { privateKey, publicKey } = await jose.generateKeyPair(alg, { extractable: true });
  const jwk = { ...(await jose.exportJWK(publicKey)), kid, alg };
  return { privateKey, jwk };
}

/** A seller: its quote signer (this SDK's own) and its public JWK */
export async function createSeller(
  serviceUrl: string = SELLER_URL
): Promise<{ signer: QuoteSigner; publicJwk: jose.JWK; privateKey: jose.KeyLike }> {
  const { privateKey, jwk } = await ecKey('seller-key');
  return { signer: toQuoteSigner(privateKey, jwk, serviceUrl), publicJwk: jwk, privateKey };
}

/** Options of {@link FakePaymentService.issue} */
export interface IssueOptions {
  /** `aud`. Defaults to the quote's `iss`, as the service sets it. */
  audience?: unknown;
  buyer?: string;
  dpopJwk?: jose.JWK;
  issuer?: unknown;
  expiresIn?: number;
  /** Claims to add or (with `undefined`) remove */
  claims?: Record<string, unknown>;
  /** Protected header; defaults to `{alg: 'ES384', kid: 'service-key'}` */
  header?: jose.JWTHeaderParameters;
  /** Sign with this key instead of the service's */
  signingKey?: jose.KeyLike;
}

/** Payment creation request body, as the Agentic Commerce Service accepts it */
export interface CreatePaymentRequest {
  quoteToken: string;
  clientToken?: string;
  dpopJwk?: jose.JWK;
}

/** Payment creation response body */
export interface CreatePaymentResponse {
  paymentId: string;
  paymentToken: string;
}

/** Issues payment tokens the way the payment service does. */
export class FakePaymentService {
  private constructor(
    private readonly privateKey: jose.KeyLike,
    readonly jwk: jose.JWK
  ) {}

  static async create(): Promise<FakePaymentService> {
    const { privateKey, jwk } = await ecKey('service-key', 'ES384');
    return new FakePaymentService(privateKey, jwk);
  }

  get jwks(): { keys: jose.JWK[] } {
    return { keys: [this.jwk] };
  }

  async issue(quoteToken: string, options: IssueOptions = {}): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const paymentId = `awsmp-${crypto.randomUUID()}`;
    let audience = options.audience;
    if (!('audience' in options)) {
      try {
        audience = jose.decodeJwt(quoteToken).iss;
      } catch {
        audience = SELLER_URL;
      }
    }
    const claims: Record<string, unknown> = {
      iss: 'issuer' in options ? options.issuer : PAYMENT_TOKEN_ISSUER,
      aud: audience,
      sub: options.buyer ?? BUYER,
      payment_id: paymentId,
      jti: paymentId,
      quote_token: quoteToken,
      iat: now,
      exp: now + (options.expiresIn ?? 300),
    };
    if (options.dpopJwk) {
      claims.cnf = { jkt: await jose.calculateJwkThumbprint(options.dpopJwk) };
    }
    for (const [name, value] of Object.entries(options.claims ?? {})) {
      if (value === undefined) delete claims[name];
      else claims[name] = value;
    }
    return new jose.SignJWT(claims as jose.JWTPayload)
      .setProtectedHeader(options.header ?? { alg: 'ES384', kid: this.jwk.kid })
      .sign(options.signingKey ?? this.privateKey);
  }

  /** The buyer side: the CreateAgentPayment call */
  async createPayment(request: CreatePaymentRequest): Promise<CreatePaymentResponse> {
    const paymentToken = await this.issue(request.quoteToken, { dpopJwk: request.dpopJwk });
    return { paymentToken, paymentId: jose.decodeJwt(paymentToken).payment_id as string };
  }
}

/** The URL of a fetch() call */
export function requestUrl(input: string | URL | Request): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
}

/**
 * A fetch() stub that serves each JWKS at its exact URL and 404 elsewhere.
 * Install it with `vi.stubGlobal('fetch', stub)`.
 */
export function jwksFetch(routes: Record<string, unknown>) {
  return vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = requestUrl(input);
    const body = Object.hasOwn(routes, url) ? routes[url] : undefined;
    return Promise.resolve(
      body === undefined
        ? new Response('not found', { status: 404 })
        : new Response(JSON.stringify(body), { status: 200 })
    );
  });
}

/** Hostnames of every fetch() call made through a stub */
export function fetchedHostnames(stub: ReturnType<typeof jwksFetch>): string[] {
  return stub.mock.calls.map(([input]) => new URL(requestUrl(input)).hostname);
}
