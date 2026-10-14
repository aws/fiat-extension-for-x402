// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * A seller as an AWS Lambda function behind an API Gateway HTTP API (payload
 * format 2.0), on x402's framework-neutral `x402HTTPResourceServer`. The
 * quote-signing key stays in AWS KMS.
 *
 * Environment:
 * - SELLER_KMS_KEY_ARN: the KMS key (ECC_NIST_P384, SIGN_VERIFY) that signs
 *   quotes. The function's role needs kms:Sign and kms:GetPublicKey on it.
 * - SELLER_SERVICE_URL: your public URL, the quote token's `iss`.
 * - SELLER_PRODUCT_ID: your AWS Marketplace product ID.
 * - AWS_REGION: set by Lambda.
 */
import { x402Facilitator } from '@x402/core/facilitator';
import {
  type HTTPAdapter,
  type HTTPRequestContext,
  type HTTPResponseInstructions,
  type RoutesConfig,
  x402HTTPResourceServer,
  x402ResourceServer,
} from '@x402/core/server';
import {
  AgenticCommerceVerifier,
  ExactAgenticCommerceFacilitatorScheme,
  InProcessFacilitatorClient,
  KmsQuoteSigner,
  registerExactAgenticCommerceServer,
  type DPoPNonceStore,
} from '@aws/fiat-extension-for-x402';

/** The fields of an API Gateway HTTP API (2.0) event this handler reads */
export interface HttpApiEvent {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  requestContext: { domainName: string; stage: string; http: { method: string } };
}

/** An API Gateway HTTP API (2.0) result */
export interface HttpApiResult {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name}`);
  }
  return value;
}

/**
 * Remembers DPoP proof ids so a replayed proof is refused. This one lives in a
 * single execution environment; to cover every concurrent environment, back
 * it with a shared store (for example a DynamoDB table with a conditional put
 * in `has`, and a TTL of 71 seconds, since `has` gets no expiry: a proof can
 * be first used 5 seconds before its `iat` and is refused from `expiresAt`,
 * `iat + 66` with the default maximum age of 60 seconds).
 */
class MemoryNonceStore implements DPoPNonceStore {
  /**
   * Ids are recorded only for payment tokens the facilitator accepted, but a
   * busy seller can still hold many. When this many are held and none has
   * expired, every new proof is refused rather than an id forgotten early.
   */
  static readonly MAX_IDS = 100_000;
  private readonly seen = new Map<string, number>();
  private lastPrune = 0;

  /** True while the time is before the id's `expiresAt`, and when the store is full */
  has(jti: string): boolean {
    const expiresAt = this.seen.get(jti);
    if (expiresAt !== undefined) return Date.now() / 1000 < expiresAt;
    if (this.seen.size >= MemoryNonceStore.MAX_IDS) {
      this.prune(true);
      return this.seen.size >= MemoryNonceStore.MAX_IDS;
    }
    return false;
  }

  add(jti: string, expiresAt: number): void {
    this.seen.set(jti, expiresAt);
    this.prune(false);
  }

  /** Forget expired ids: at most once a minute, or once a second when full */
  private prune(full: boolean): void {
    const now = Date.now() / 1000;
    if (now - this.lastPrune < (full ? 1 : 60)) return;
    this.lastPrune = now;
    for (const [id, until] of this.seen) {
      if (until <= now) this.seen.delete(id);
    }
  }
}

const keyArn = required('SELLER_KMS_KEY_ARN');
const region = required('AWS_REGION');

const signer = new KmsQuoteSigner({ keyArn, region, serviceUrl: required('SELLER_SERVICE_URL') });
const verifier = new AgenticCommerceVerifier({
  sellerKeyResolver: { type: 'kms', kmsKeyArn: keyArn, region },
});
const facilitator = new x402Facilitator().register(
  'aws:base',
  new ExactAgenticCommerceFacilitatorScheme({ verifier })
);
const resourceServer = registerExactAgenticCommerceServer(
  new x402ResourceServer(new InProcessFacilitatorClient(facilitator)),
  { signer, dpopNonceStore: new MemoryNonceStore() }
);

const routes: RoutesConfig = {
  'GET /weather': {
    accepts: {
      scheme: 'exact',
      network: 'aws:base',
      payTo: required('SELLER_PRODUCT_ID'), // signed into the quote
      price: '$0.01',
      extra: { description: 'Current weather', reference: 'weather-v1' },
    },
    description: 'Current weather',
    mimeType: 'application/json',
  },
};
const httpServer = new x402HTTPResourceServer(resourceServer, routes);

// Fetches the supported kinds once per execution environment, and again after
// a failure.
let ready: Promise<void> | undefined;
function initialize(): Promise<void> {
  ready ??= httpServer.initialize().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  return ready;
}

/** The paid resource */
function weather(): HttpApiResult {
  return {
    statusCode: 200,
    // A paid response must never be served from a shared cache.
    headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
    body: JSON.stringify({ city: 'Seattle', temperatureF: 58, conditions: 'cloudy' }),
  };
}

function error(statusCode: number, message: string): HttpApiResult {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ error: message }),
  };
}

/** Turns x402's response instructions (a 402, or a failed settlement) into a result */
function fromInstructions({ status, headers, body, isHtml }: HTTPResponseInstructions) {
  const lowerCased: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) lowerCased[name.toLowerCase()] = value;
  lowerCased['content-type'] ??= isHtml ? 'text/html' : 'application/json';
  const text = isHtml ? (typeof body === 'string' ? body : '') : JSON.stringify(body ?? {});
  return { statusCode: status, headers: lowerCased, body: text } satisfies HttpApiResult;
}

/**
 * Reads the request as x402 expects. The path has the stage removed, for
 * route matching; the URL is the public one the buyer called, without the
 * query, for the DPoP `htu` check.
 */
function adapterFor(event: HttpApiEvent, path: string): HTTPAdapter {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers[name.toLowerCase()] = value;
  }
  const query = new URLSearchParams(event.rawQueryString ?? '');
  return {
    getHeader: (name) => headers[name.toLowerCase()],
    getMethod: () => event.requestContext.http.method,
    getPath: () => path,
    getUrl: () => `https://${event.requestContext.domainName}${event.rawPath}`,
    getAcceptHeader: () => headers.accept ?? '',
    getUserAgent: () => headers['user-agent'] ?? '',
    getQueryParams: () => Object.fromEntries(query),
    getQueryParam: (name) => query.get(name) ?? undefined,
  };
}

export async function handler(event: HttpApiEvent): Promise<HttpApiResult> {
  const { stage, http } = event.requestContext;
  const prefix = stage && stage !== '$default' ? `/${stage}` : '';
  const path =
    prefix && event.rawPath.startsWith(`${prefix}/`)
      ? event.rawPath.slice(prefix.length)
      : event.rawPath;
  // Only GET /weather exists. Anything else never reaches the resource.
  if (path !== '/weather') {
    return error(404, 'Not found');
  }
  if (http.method !== 'GET') {
    const refused = error(405, 'Method not allowed');
    return { ...refused, headers: { ...refused.headers, allow: 'GET' } };
  }

  const adapter = adapterFor(event, path);
  const context: HTTPRequestContext = {
    adapter,
    path,
    method: http.method,
    paymentHeader: adapter.getHeader('payment-signature') || adapter.getHeader('x-payment'),
  };

  try {
    await initialize();
    const result = await httpServer.processHTTPRequest(context);
    if (result.type === 'payment-error') {
      return fromInstructions(result.response);
    }
    if (result.type === 'no-payment-required') {
      // Not reached: GET /weather is a paid route. Refuse rather than serve it.
      return error(500, 'Route is not protected');
    }

    // Verified: produce the resource, then settle (a no-op for this scheme,
    // which reports the payment id) and add the settlement headers.
    const response = weather();
    const settlement = await httpServer.processSettlement(
      result.paymentPayload,
      result.paymentRequirements,
      result.declaredExtensions
    );
    if (!settlement.success) {
      return fromInstructions(settlement.response);
    }
    return { ...response, headers: { ...response.headers, ...settlement.headers } };
  } catch (caught) {
    // A KMS or facilitator failure: log it, and give the buyer no details.
    console.error(caught);
    return error(502, 'Payment processing failed');
  }
}
