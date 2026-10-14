// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * The shared wire fixtures in test/fixtures/cross-lang: the same JSON files
 * are run by every SDK implementation of the scheme, so this suite applies
 * them exactly as their README defines, on a fake clock. TEST KEYS ONLY: every
 * private key is derived from a public label at test time.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createECDH,
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign,
  webcrypto,
  type KeyObject,
} from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import * as jose from 'jose';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { AgenticCommerceVerifier } from '../../src/agentic-commerce/verifier';
import {
  ExactAgenticCommerceFacilitatorScheme,
  ExactAgenticCommerceServerScheme,
} from '../../src/agentic-commerce/exact';
import { enhancePaymentRequirements } from '../../src/agentic-commerce/exact/quote';
import { computeJWKThumbprint, verifyDPoPProof } from '../../src/dpop/verification';
import { LocalQuoteSigner } from '../../src/signers/local';
import { KmsQuoteSigner } from '../../src/signers/kms';
import { DPoPError, ValidationError, type DPoPNonceStore } from '../../src/types';
import { SERVICE_JWKS_BASE_URL, jwksFetch } from '../helpers/fake-payment-service';
import * as fixedVectors from '../helpers/fixed-vectors';

const { kmsSend } = vi.hoisted(() => ({ kmsSend: vi.fn() }));

// KMS is mocked: the kid vectors only read the header of a signed quote.
vi.mock('@aws-sdk/client-kms', () => ({
  KMSClient: class {
    send = kmsSend;
  },
  SignCommand: class {
    constructor(readonly input: { Message: Uint8Array }) {}
  },
}));

type Json = Record<string, unknown>;
type Role = 'seller' | 'service' | 'buyer';
type Curve = 'P-256' | 'P-384';
interface EcJwk extends Json {
  kty: 'EC';
  crv: Curve;
  x: string;
  y: string;
}

/** The shapes of the fixture files, as their README documents them */
interface KeysFile {
  derivation: { curveOrders: Record<Curve, string> };
  keys: {
    seller: { curve: Curve; label: string; kid: string; serviceUrl: string; publicJwk: EcJwk };
    service: { curve: Curve; label: string; kid: string; jwks: { keys: EcJwk[] } };
    buyer: { curve: Curve; label: string; publicJwk: EcJwk; jwkThumbprint: string };
  };
}
interface QuoteFile {
  now: number;
  jti: string;
  signer: { key: Role; kid: string; serviceUrl: string };
  input: Json;
  output: Json & { extra: Json };
  quoteToken: string;
  header: Json;
  payloadJson: string;
}
interface DPoPOptions extends Json {
  htm: string;
  htu: string;
  accessToken: string;
  maxAge: number;
}
interface PaymentTokenFile {
  token: string;
  header: Json;
  claims: Json;
  verify: {
    now: number;
    paymentTokenIssuer: string;
    requirements: Json & { extra: Json };
    expected: Json;
  };
  facilitator: {
    now: number;
    paymentPayload: Json;
    requirements: Json;
    expectedVerify: Json;
    expectedSettle: Json;
  };
}
interface DPoPProofFile {
  proof: string;
  header: Json & { jwk: EcJwk };
  claims: Json;
  verify: { now: number; options: DPoPOptions; expected: { claims: Json } };
}
interface Case {
  name: string;
  now?: number;
  requirements?: Json;
  options?: Json;
  paymentTokenClaims?: Json;
  paymentTokenHeader?: Json;
  quoteClaims?: Json;
  proofClaims?: Json;
  expected: Json;
}
interface BehaviourVectorsFile {
  verifier: { base: string; cases: Case[] };
  dpop: { base: string; cases: Case[] };
  dpopNonceStore: { base: string; cases: Case[] };
  parsePrice: { cases: { price: string | number; expected: Json }[] };
  kmsKid: { cases: { keyArn: string; kid: string }[] };
  jwkThumbprint: { cases: { name: string; jwk: jose.JWK; thumbprint: string }[] };
}

const DIR = new URL('../fixtures/cross-lang/', import.meta.url);
const FILES = ['keys', 'quote', 'payment-token', 'dpop-proof', 'behaviour-vectors'] as const;
const raw = (name: string) => readFileSync(new URL(name, DIR), 'utf8');
const load = <T>(name: (typeof FILES)[number]) => JSON.parse(raw(`${name}.json`)) as T;

const keys = load<KeysFile>('keys');
const quote = load<QuoteFile>('quote');
const payment = load<PaymentTokenFile>('payment-token');
const dpop = load<DPoPProofFile>('dpop-proof');
const vectors = load<BehaviourVectorsFile>('behaviour-vectors');

const ECDH_CURVES: Record<Curve, string> = { 'P-256': 'prime256v1', 'P-384': 'secp384r1' };

const publicJwkOf = (role: Role): EcJwk =>
  role === 'service' ? keys.keys.service.jwks.keys[0] : keys.keys[role].publicJwk;

const derived = new Map<Role, KeyObject>();

/** A key from keys.json, rebuilt from its label, checked against its public JWK */
function derivedKey(role: Role): KeyObject {
  const cached = derived.get(role);
  if (cached) return cached;
  const { curve, label } = keys.keys[role];
  const n = BigInt(`0x${keys.derivation.curveOrders[curve]}`);
  const size = curve === 'P-256' ? 32 : 48;
  const digest = createHash('sha512').update(label, 'utf8').digest('hex');
  const d = Buffer.from((BigInt(`0x${digest}`) % n).toString(16).padStart(size * 2, '0'), 'hex');
  const ecdh = createECDH(ECDH_CURVES[curve]);
  ecdh.setPrivateKey(d);
  const point = ecdh.getPublicKey(); // 0x04 || x || y
  const x = point.subarray(1, 1 + size).toString('base64url');
  const y = point.subarray(1 + size).toString('base64url');
  const publicJwk = publicJwkOf(role);
  if (publicJwk.crv !== curve || publicJwk.x !== x || publicJwk.y !== y) {
    throw new Error(`keys.json ${role}: the label does not derive the public JWK`);
  }
  const key = createPrivateKey({
    key: { kty: 'EC', crv: curve, x, y, d: d.toString('base64url') },
    format: 'jwk',
  });
  derived.set(role, key);
  return key;
}

function segment(token: string, index: number): Json {
  return JSON.parse(Buffer.from(token.split('.')[index], 'base64url').toString('utf8')) as Json;
}

/** Shallow merge: each member replaces its namesake, and null removes it */
function merge<T extends Json>(base: T, change: Json | undefined): T {
  const result: Json = { ...base };
  for (const [name, value] of Object.entries(change ?? {})) {
    if (value === null) delete result[name];
    else result[name] = value;
  }
  return result as T;
}

function resign(header: Json, claims: Json, key: KeyObject): Promise<string> {
  return new jose.CompactSign(new TextEncoder().encode(JSON.stringify(claims)))
    .setProtectedHeader(header as jose.CompactJWSHeaderParameters)
    .sign(key);
}

function atTime(now: number) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now * 1000);
}

function serveServiceJwks() {
  vi.stubGlobal(
    'fetch',
    jwksFetch({ [`${SERVICE_JWKS_BASE_URL}/.well-known/jwks.json`]: keys.keys.service.jwks })
  );
}

function verifier(
  issuer: string | null = payment.verify.paymentTokenIssuer
): AgenticCommerceVerifier {
  return new AgenticCommerceVerifier({
    sellerKeyResolver: { type: 'static', publicJwk: keys.keys.seller.publicJwk },
    paymentTokenJwksUrl: SERVICE_JWKS_BASE_URL,
    ...(issuer === null ? {} : { paymentTokenIssuer: issuer }),
  });
}

function facilitator(): ExactAgenticCommerceFacilitatorScheme {
  return new ExactAgenticCommerceFacilitatorScheme({ verifier: verifier() });
}

function sellerSigner(): LocalQuoteSigner {
  const pem = derivedKey(quote.signer.key).export({ type: 'pkcs8', format: 'pem' }) as string;
  return LocalQuoteSigner.fromPem(pem, {
    kid: quote.signer.kid,
    serviceUrl: quote.signer.serviceUrl,
  });
}

/** verifyDPoPProof options from the fixture's neutral option names */
function dpopOptions(change: Json | undefined, nonceStore?: DPoPNonceStore) {
  const { htm, htu, accessToken, maxAge } = merge(dpop.verify.options, change);
  return { method: htm, url: htu, accessToken, maxAge, nonceStore };
}

const named = (cases: Case[]) => cases.map((c) => [c.name, c] as const);

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shared wire fixtures: file format', () => {
  it('has exactly the documented files', () => {
    const listed = readdirSync(DIR).filter((name) => !name.startsWith('.'));
    expect(listed.sort()).toEqual(['README.md', ...FILES.map((name) => `${name}.json`)].sort());
  });

  it.each(FILES)('%s.json is canonical, ASCII-only JSON marked TEST KEYS ONLY', (name) => {
    const text = raw(`${name}.json`);
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
    const data = load<Json>(name);
    expect(data.formatVersion).toBe(1);
    expect(data.description).toMatch(/^TEST KEYS ONLY\. /);
  });

  it('README.md is ASCII-only and marked TEST KEYS ONLY', () => {
    const text = raw('README.md');
    expect(/^[\x20-\x7e\n]*$/.test(text)).toBe(true);
    expect(text).toMatch(/^# .*\(TEST KEYS ONLY\)\n/);
  });

  it('repeats each token identically wherever another file carries it', () => {
    expect(quote.output.extra.quoteToken).toBe(quote.quoteToken);
    expect(quote.signer).toEqual({
      key: 'seller',
      kid: keys.keys.seller.kid,
      serviceUrl: keys.keys.seller.serviceUrl,
    });
    expect(payment.verify.paymentTokenIssuer).toBe(payment.claims.iss);
    expect(payment.claims.quote_token).toBe(quote.quoteToken);
    expect(payment.verify.requirements.extra.quoteToken).toBe(quote.quoteToken);
    expect(payment.facilitator.requirements).toEqual(quote.output);
    expect(payment.facilitator.paymentPayload).toEqual({
      x402Version: 2,
      accepted: quote.output,
      payload: { paymentToken: payment.token },
    });
    expect(dpop.verify.options.accessToken).toBe(payment.token);
  });

  it('matches the fixed vectors the other unit tests use', () => {
    expect(quote.quoteToken).toBe(fixedVectors.QUOTE_TOKEN);
    expect(quote.payloadJson).toBe(fixedVectors.QUOTE_PAYLOAD_JSON);
    expect(quote.input).toEqual(fixedVectors.QUOTE_INPUT);
    expect(quote.output).toEqual(fixedVectors.QUOTE_OUTPUT);
    expect(payment.token).toBe(fixedVectors.PAYMENT_TOKEN);
    expect(dpop.proof).toBe(fixedVectors.DPOP_PROOF);
    expect(keys.keys.seller.publicJwk).toEqual(fixedVectors.SELLER_PUBLIC_JWK);
    expect(keys.keys.service.jwks).toEqual(fixedVectors.SERVICE_JWKS);
    expect(keys.keys.buyer.publicJwk).toEqual(fixedVectors.BUYER_PUBLIC_JWK);
    expect(keys.keys.buyer.jwkThumbprint).toBe(fixedVectors.BUYER_JKT);
    expect(quote.now).toBe(fixedVectors.FIXED_NOW);
    expect(quote.jti).toBe(fixedVectors.FIXED_JTI);
    expect(keys.keys.seller.serviceUrl).toBe(fixedVectors.SELLER_URL);
    expect(payment.verify.expected).toEqual({
      isValid: true,
      payer: fixedVectors.PAYMENT_PAYER,
      paymentId: fixedVectors.PAYMENT_ID,
    });
    expect(dpop.claims.htu).toBe(fixedVectors.DPOP_HTU);
    expect(dpop.claims.ath).toBe(fixedVectors.DPOP_ATH);
    const d = (key: KeyObject) => key.export({ format: 'jwk' }).d;
    expect(d(fixedVectors.sellerPrivateKey())).toBe(d(derivedKey('seller')));
    expect(d(fixedVectors.buyerPrivateKey())).toBe(d(derivedKey('buyer')));
  });
});

describe('shared wire fixtures: keys.json', () => {
  it.each(['seller', 'service', 'buyer'] as const)(
    'the %s label derives its public key',
    (role) => {
      expect(derivedKey(role).asymmetricKeyDetails?.namedCurve).toBe(
        ECDH_CURVES[keys.keys[role].curve]
      );
    }
  );

  it('LocalQuoteSigner publishes the seller public JWK', () => {
    expect(sellerSigner().publicJwk).toEqual(keys.keys.seller.publicJwk);
  });
});

describe('shared wire fixtures: quote.json', () => {
  it('the fixed quote token has the documented header and exact payload bytes', async () => {
    expect(segment(quote.quoteToken, 0)).toEqual(quote.header);
    const payloadBytes = Buffer.from(quote.quoteToken.split('.')[1], 'base64url');
    expect(payloadBytes.toString('utf8')).toBe(quote.payloadJson);
    const key = await jose.importJWK(keys.keys.seller.publicJwk, 'ES256');
    await expect(jose.compactVerify(quote.quoteToken, key)).resolves.toBeDefined();
  });

  it('enhancePaymentRequirements turns the input into the output, with the same payload bytes', async () => {
    atTime(quote.now);
    vi.spyOn(webcrypto, 'randomUUID').mockReturnValue(
      quote.jti as ReturnType<typeof webcrypto.randomUUID>
    );
    const output = await enhancePaymentRequirements(
      structuredClone(quote.input) as unknown as PaymentRequirements,
      sellerSigner()
    );
    const { quoteToken, ...extra } = output.extra;
    expect({ ...output, extra }).toEqual({
      ...quote.output,
      extra: merge(quote.output.extra, { quoteToken: null }),
    });
    expect(segment(quoteToken as string, 0)).toEqual(quote.header);
    expect(Buffer.from((quoteToken as string).split('.')[1], 'base64url').toString('utf8')).toBe(
      quote.payloadJson
    );
    const key = await jose.importJWK(keys.keys.seller.publicJwk, 'ES256');
    await expect(jose.compactVerify(quoteToken as string, key)).resolves.toBeDefined();
  });
});

describe('shared wire fixtures: payment-token.json', () => {
  it('decodes to the documented header and claims', () => {
    expect(segment(payment.token, 0)).toEqual(payment.header);
    expect(segment(payment.token, 1)).toEqual(payment.claims);
    expect(payment.claims.quote_token).toBe(quote.quoteToken);
    expect(payment.claims.cnf).toEqual({ jkt: keys.keys.buyer.jwkThumbprint });
  });

  it('the verifier accepts it, with the fixture issuer and with the default issuer', async () => {
    atTime(payment.verify.now);
    serveServiceJwks();
    for (const v of [verifier(), verifier(null)]) {
      expect(await v.verify(payment.token, payment.verify.requirements)).toEqual(
        payment.verify.expected
      );
    }
  });

  it('the facilitator verifies and settles it', async () => {
    const fixture = payment.facilitator;
    atTime(fixture.now);
    serveServiceJwks();
    const payload = fixture.paymentPayload as unknown as PaymentPayload;
    const requirements = fixture.requirements as unknown as PaymentRequirements;
    expect(await facilitator().verify(payload, requirements)).toEqual(fixture.expectedVerify);
    expect(await facilitator().settle(payload, requirements)).toEqual(fixture.expectedSettle);
  });
});

describe('shared wire fixtures: dpop-proof.json', () => {
  it('decodes to the documented header and claims, bound to the payment token', () => {
    expect(segment(dpop.proof, 0)).toEqual(dpop.header);
    expect(segment(dpop.proof, 1)).toEqual(dpop.claims);
    expect(dpop.header.jwk).toEqual(keys.keys.buyer.publicJwk);
    expect(dpop.claims.ath).toBe(createHash('sha256').update(payment.token).digest('base64url'));
    expect(dpop.verify.options.accessToken).toBe(payment.token);
  });

  it('verification returns its claims', async () => {
    atTime(dpop.verify.now);
    expect(await verifyDPoPProof(dpop.proof, dpopOptions(undefined))).toEqual(
      dpop.verify.expected.claims
    );
  });
});

describe('shared wire fixtures: behaviour vectors', () => {
  it('names the bases the README defines', () => {
    expect(vectors.verifier.base).toBe('payment-token.json verify');
    expect(vectors.dpop.base).toBe('dpop-proof.json verify');
    expect(vectors.dpopNonceStore.base).toBe('dpop-proof.json verify');
  });

  it.each(named(vectors.verifier.cases))('verifier: %s', async (_name, c) => {
    atTime(c.now ?? payment.verify.now);
    serveServiceJwks();

    let quoteToken = quote.quoteToken;
    if (c.quoteClaims) {
      const claims = merge(JSON.parse(quote.payloadJson) as Json, c.quoteClaims);
      quoteToken = await resign(quote.header, claims, derivedKey('seller'));
    }
    let token = payment.token;
    if (c.quoteClaims || c.paymentTokenClaims || c.paymentTokenHeader) {
      const claims = merge(
        merge(payment.claims, { quote_token: quoteToken }),
        c.paymentTokenClaims
      );
      const header = merge(payment.header, c.paymentTokenHeader);
      token = await resign(header, claims, derivedKey('service'));
    }
    const base = payment.verify.requirements;
    const requirements = merge(
      merge(base, { extra: { ...base.extra, quoteToken } }),
      c.requirements
    );

    const { settle, ...expected } = c.expected;
    expect(await verifier().verify(token, requirements)).toEqual(expected);
    if (settle !== undefined) {
      const accepted = { ...quote.output, extra: { ...quote.output.extra, quoteToken } };
      const payload = { x402Version: 2, accepted, payload: { paymentToken: token } };
      const settled = await facilitator().settle(
        payload as unknown as PaymentPayload,
        accepted as unknown as PaymentRequirements
      );
      expect(settled).toEqual(settle);
    }
  });

  it.each(named(vectors.dpop.cases))('DPoP proof verification: %s', async (_name, c) => {
    atTime(c.now ?? dpop.verify.now);
    const proof = c.proofClaims
      ? await resign(dpop.header, merge(dpop.claims, c.proofClaims), derivedKey('buyer'))
      : dpop.proof;
    const outcome = await verifyDPoPProof(proof, dpopOptions(c.options)).then(
      (claims) => ({ claims }),
      (error: unknown) => {
        expect(error).toBeInstanceOf(DPoPError);
        return { error: (error as Error).message };
      }
    );
    expect(outcome).toEqual(c.expected);
  });

  it.each(named(vectors.dpopNonceStore.cases))('DPoP nonce store: %s', async (_name, c) => {
    atTime(c.now ?? dpop.verify.now);
    const added: [string, number][] = [];
    const nonceStore: DPoPNonceStore = {
      has: (jti) => added.some(([id]) => id === jti),
      add: (jti, expiresAt) => {
        added.push([jti, expiresAt]);
      },
    };
    const options = dpopOptions(c.options, nonceStore);

    await verifyDPoPProof(dpop.proof, options);
    expect(added).toEqual([[c.expected.addedJti, c.expected.addedExpiresAt]]);
    const replay = await verifyDPoPProof(dpop.proof, options).catch((error: unknown) => error);
    expect(replay).toBeInstanceOf(DPoPError);
    expect((replay as Error).message).toBe(c.expected.replayError);
  });

  it.each(vectors.parsePrice.cases.map((c) => [JSON.stringify(c.price), c] as const))(
    'route price parsing: %s',
    async (_name, { price, expected }) => {
      const scheme = new ExactAgenticCommerceServerScheme({ signer: sellerSigner() });
      const outcome = await scheme.parsePrice(price, 'aws:base').then(
        ({ amount, asset }) => ({ amount, asset }),
        (error: unknown) => {
          expect(error).toBeInstanceOf(ValidationError);
          return { message: (error as Error).message };
        }
      );
      if (typeof expected.errorPrefix === 'string') {
        const { message } = outcome as { message?: string };
        expect(message?.slice(0, expected.errorPrefix.length)).toBe(expected.errorPrefix);
      } else {
        expect(outcome).toEqual(expected);
      }
    }
  );

  // Any P-384 key will do: only the header of the signed quote is read.
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });

  it.each(vectors.kmsKid.cases.map((c) => [c.keyArn, c] as const))(
    'KMS kid derivation: %s',
    async (_name, { keyArn, kid }) => {
      kmsSend.mockImplementation((command: { input: { Message: Uint8Array } }) =>
        Promise.resolve({
          Signature: sign('sha384', command.input.Message, { key: privateKey, dsaEncoding: 'der' }),
        })
      );
      const signer = new KmsQuoteSigner({
        keyArn,
        region: 'us-east-1',
        serviceUrl: keys.keys.seller.serviceUrl,
      });
      const token = await signer.signQuote({});
      expect(jose.decodeProtectedHeader(token).kid).toBe(kid);
    }
  );

  it.each(vectors.jwkThumbprint.cases.map((c) => [c.name, c] as const))(
    'JWK thumbprint: %s',
    async (_name, { jwk, thumbprint }) => {
      expect(await computeJWKThumbprint(jwk)).toBe(thumbprint);
    }
  );
});
