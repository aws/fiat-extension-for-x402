// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Quote signer for a private key the seller manages.
 *
 * Holds the private key in memory and signs JWTs directly. Use it with a key
 * loaded from the seller's own store (a PEM file, a secrets manager, an HSM
 * export) and publish the public key in a JWKS; see {@link jwksDocument}.
 * Sellers who prefer the private key never to leave AWS use
 * {@link KmsQuoteSigner} instead.
 */

import { KeyObject, createPrivateKey, createPublicKey } from 'node:crypto';
import * as jose from 'jose';
import {
  base64urlDecode,
  bigIntOf,
  isPlainObject,
  quotedLiteral,
} from '../agentic-commerce/json-value';
import { SigningError } from '../types';
import { stripWhitespace } from '../utils';
import {
  describePrivateKey,
  privateJwkMembers,
  assertServiceUrl,
  privateKeyObject,
  type QuoteSigner,
} from './protocol';

// Node.js (OpenSSL) curve names that differ from the SEC 2 names used in messages.
const SEC_CURVE_NAMES: Record<string, string> = {
  prime192v1: 'secp192r1',
  prime256v1: 'secp256r1',
};

/** A curve's SEC 2 name (secp256r1 rather than prime256v1), for messages. */
function curveName(curve: string | undefined): string {
  const name = String(curve);
  return Object.hasOwn(SEC_CURVE_NAMES, name) ? SEC_CURVE_NAMES[name] : name;
}

/**
 * Smallest RSA modulus accepted for quote signing (NIST SP 800-57: 2048 bits).
 *
 * @internal
 */
export const MIN_RSA_KEY_BITS = 2048;

/** A JWK member decoded as jwksDocument decodes it, or undefined when it does not decode. */
function decodedMember(value: unknown): Buffer | undefined {
  try {
    return base64urlDecode(value);
  } catch {
    return undefined;
  }
}

/**
 * Whether a JWK holds the public key of `privateKey`: the same kty and crv; for
 * EC the same x and y bytes (fixed width, as jwksDocument requires), for RSA the
 * same n and e as integers (a leading zero byte does not matter).
 */
function isPublicKeyOf(jwk: Record<string, unknown>, privateKey: KeyObject): boolean {
  const own: Record<string, unknown> = createPublicKey(privateKey).export({ format: 'jwk' });
  const ec = own.kty === 'EC';
  if (jwk.kty !== own.kty || (ec && jwk.crv !== own.crv)) return false;
  return (ec ? ['x', 'y'] : ['n', 'e']).every((name) => {
    const theirs = decodedMember(jwk[name]);
    const ours = decodedMember(own[name])!;
    if (theirs === undefined) return false;
    return ec ? theirs.equals(ours) : bigIntOf(theirs) === bigIntOf(ours);
  });
}

// The PEM tags of the private key formats fromPem reads; any other block, such
// as OPENSSH PRIVATE KEY or CERTIFICATE, is skipped.
const PRIVATE_KEY_PEM_TAGS = [
  'PRIVATE KEY',
  'ENCRYPTED PRIVATE KEY',
  'RSA PRIVATE KEY',
  'EC PRIVATE KEY',
  'DSA PRIVATE KEY',
];

/**
 * The first private key PEM block (the one that is loaded), and
 * whether it is encrypted (PKCS #8 ENCRYPTED, or a traditional PEM with
 * Proc-Type: 4,ENCRYPTED). Undefined when there is none. Plain index search:
 * no regex on the input.
 */
function firstPrivateKeyBlock(pem: string): { block: string; encrypted: boolean } | undefined {
  let from = 0;
  for (;;) {
    const begin = pem.indexOf('-----BEGIN ', from);
    if (begin < 0) return undefined;
    const labelEnd = pem.indexOf('-----', begin + 11);
    if (labelEnd < 0) return undefined;
    const label = pem.slice(begin + 11, labelEnd);
    from = labelEnd + 5;
    if (!PRIVATE_KEY_PEM_TAGS.includes(label)) continue;
    const endMarker = `-----END ${label}-----`;
    const end = pem.indexOf(endMarker, from);
    if (end < 0) return undefined;
    const block = pem.slice(begin, end + endMarker.length);
    return {
      block,
      encrypted: label === 'ENCRYPTED PRIVATE KEY' || block.includes('Proc-Type: 4,ENCRYPTED'),
    };
  }
}

// id-RSASSA-PSS (1.2.840.113549.1.1.10), the DER contents of the OID
const RSA_PSS_OID = Buffer.from('2a864886f70d01010a', 'hex');

/**
 * Strict base64 decoding of a body already stripped of whitespace: only the
 * base64 alphabet, padding only at the end and exactly as much as the last
 * quantum needs. Undefined for anything else.
 */
function strictBase64(body: string): Buffer | undefined {
  let data = 0;
  let pads = 0;
  for (const ch of body) {
    if (ch === '=') {
      pads++;
      continue;
    }
    const alphabet =
      (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9');
    if ((!alphabet && ch !== '+' && ch !== '/') || pads > 0) return undefined;
    data++;
  }
  // Exactly the padding a whole number of quanta needs.
  if (pads > 2 || (data + pads) % 4 !== 0) return undefined;
  return Buffer.from(body, 'base64');
}

/**
 * The content offset and length of the DER element at `offset` with the given
 * tag, with a length of up to 4 bytes. Undefined if the tag differs, the
 * length is longer or the input ends early.
 */
function derHeader(
  der: Buffer,
  offset: number,
  tag: number
): { start: number; length: number } | undefined {
  if (offset + 1 >= der.length || der[offset] !== tag) return undefined;
  const first = der[offset + 1];
  if (first < 0x80) return { start: offset + 2, length: first };
  const count = first & 0x7f;
  if (count < 1 || count > 4 || offset + 2 + count > der.length) return undefined;
  let length = 0;
  for (let i = 0; i < count; i++) length = length * 256 + der[offset + 2 + i];
  return { start: offset + 2 + count, length };
}

/**
 * Whether a PEM holds an unencrypted PKCS #8 key marked RSA-PSS only: the
 * first `BEGIN PRIVATE KEY` block anywhere in the text (even after another key
 * block), base64 decoded strictly, and the algorithm OID of its
 * PrivateKeyInfo. Only the DER headers up to that OID are read, so a key that
 * is damaged after them is still refused here; input whose base64 or headers
 * do not parse is left to the PEM loader to report. The block is found by
 * index search; whitespace is dropped with a fixed one-character class.
 */
function isRsaPssPem(text: string): boolean {
  const beginMarker = '-----BEGIN PRIVATE KEY-----';
  const endMarker = '-----END PRIVATE KEY-----';
  const begin = text.indexOf(beginMarker);
  if (begin < 0) return false;
  const end = text.indexOf(endMarker, begin + beginMarker.length);
  if (end < 0) return false;
  // ASCII whitespace is dropped. A fixed one-character class.
  const body = text
    .slice(begin + beginMarker.length, end)
    .split(/[ \t\n\r\v\f]/)
    .join('');
  const der = strictBase64(body);
  if (der === undefined) return false;
  try {
    const info = derHeader(der, 0, 0x30); // PrivateKeyInfo
    const version = info && derHeader(der, info.start, 0x02);
    const algorithm = version && derHeader(der, version.start + version.length, 0x30);
    const oid = algorithm && derHeader(der, algorithm.start, 0x06);
    return oid !== undefined && der.subarray(oid.start, oid.start + oid.length).equals(RSA_PSS_OID);
  } finally {
    der.fill(0);
  }
}

/**
 * The PEM as text, each byte one character (the PEM is read as bytes). This is
 * the only conversion, used by both the RSA-PSS check and the loader, and it is
 * Buffer.from, as the loader always used: bytes from any realm or offset are
 * read the same way. Buffer.from throws for input that is not bytes (undefined,
 * a number), which the caller reports as a SigningError.
 */
function pemAsText(pem: string | Uint8Array): string {
  return typeof pem === 'string' ? pem : Buffer.from(pem).toString('latin1');
}

/** The SigningError for a PEM that cannot be read or loaded, with its cause */
function pemLoadError(error: unknown): SigningError {
  const message = error instanceof Error ? error.message : String(error);
  return new SigningError(`Could not load the PEM private key: ${message}`, undefined, {
    cause: error,
  });
}

/**
 * Load a PEM private key: a password is refused for an unencrypted key and
 * required for an encrypted one. A null password is no password.
 */
function loadPemPrivateKey(text: string, password?: string | Uint8Array | null): KeyObject {
  const first = firstPrivateKeyBlock(text);
  if (first === undefined) {
    // No PEM section at all, or no private key section
    if (!text.includes('-----BEGIN ')) {
      throw new Error('Unable to load PEM file: no PEM data found.');
    }
    throw new Error(
      'Valid PEM but no BEGIN/END delimiters for a private key found. ' +
        'Are you sure this is a private key?'
    );
  }
  const { block: key, encrypted } = first;
  // A password mismatch. For an encrypted key an empty password is no password.
  if (encrypted && (password == null || password.length === 0)) {
    throw new Error('Password was not given but private key is encrypted');
  }
  if (!encrypted) {
    const unencrypted = createPrivateKey({ key, format: 'pem' });
    if (password != null) {
      throw new Error('Password was given but private key is not encrypted.');
    }
    return unencrypted;
  }
  const passphrase = typeof password === 'string' ? password : Buffer.from(password!);
  try {
    return createPrivateKey({ key, format: 'pem', passphrase });
  } catch (error) {
    // Only a failed decryption is a wrong password. A decrypt that passes the
    // padding check but does not decode (ERR_OSSL_UNSUPPORTED) is a format
    // error, reported with OpenSSL's message.
    if ((error as { code?: unknown }).code === 'ERR_OSSL_BAD_DECRYPT') {
      throw new Error('Incorrect password, could not decrypt key', { cause: error });
    }
    throw error;
  }
}

/** Options of {@link LocalQuoteSigner.fromPem} */
export interface FromPemOptions {
  /** Key ID published in the JWKS and sent as the JWS `kid` */
  kid: string;
  /** Service URL used as the `iss` claim */
  serviceUrl: string;
  /** Password for an encrypted PEM. Null or undefined means none. */
  password?: string | Uint8Array | null;
}

/**
 * Quote signer holding its private key in memory.
 *
 * @example
 * ```typescript
 * const signer = LocalQuoteSigner.fromPem(readFileSync('quote-key.pem'), {
 *   kid: 'quote-key-2026-10',
 *   serviceUrl: 'https://api.example.com',
 * });
 * // Serve jwksDocument(signer.publicJwk) at /.well-known/jwks.json
 * ```
 */
export class LocalQuoteSigner implements QuoteSigner {
  private readonly privateKey: KeyObject;
  private readonly jwk: jose.JWK;
  private readonly serviceUrl: string;
  private readonly header: jose.JWTHeaderParameters;

  /**
   * @param privateKey - EC (P-256, P-384, P-521) or RSA private key, as a
   *   Node.js KeyObject or a WebCrypto CryptoKey
   * @param publicJwk - Public key as a JWK. `alg` selects the signing
   *   algorithm (default `ES256`) and `kid` becomes the JWS `kid` header.
   * @param serviceUrl - Service URL used as the `iss` claim
   * @throws SigningError if `serviceUrl` is
   *   empty, `publicJwk` contains private key material, or an RSA key is
   *   shorter than 2048 bits; or the key is not an EC (P-256, P-384, P-521) or
   *   RSA private key,
   *   the JWK's `alg` is not the one the key signs with, or the JWK is not the
   *   key's public key
   */
  constructor(privateKey: jose.KeyLike, publicJwk: jose.JWK, serviceUrl: string) {
    assertServiceUrl(serviceUrl);
    if (!isPlainObject(publicJwk)) {
      throw new SigningError('publicJwk must be a JWK object');
    }
    const leaked = privateJwkMembers(publicJwk);
    if (leaked) {
      throw new SigningError(
        `publicJwk contains private key members: ${leaked}. Pass only the public key.`
      );
    }
    const keyObject = privateKeyObject(privateKey);
    const key = keyObject && describePrivateKey(keyObject);
    if (keyObject === undefined || key === undefined) {
      throw new SigningError('privateKey must be an EC or RSA private key');
    }
    if (key.kty === 'RSA' && !((key.bits ?? 0) >= MIN_RSA_KEY_BITS)) {
      throw new SigningError(
        `RSA keys must be at least ${MIN_RSA_KEY_BITS} bits, got ${String(key.bits)}`
      );
    }
    if (key.alg === undefined) {
      throw new SigningError(`Unsupported EC curve: ${curveName(key.curve)}`);
    }
    // Checked here rather than at sign time, and so that a JWK alg no verifier
    // accepts (PS256, RS384) is refused.
    const alg: unknown = publicJwk.alg === undefined ? 'ES256' : publicJwk.alg;
    if (alg !== key.alg) {
      throw new SigningError(
        `publicJwk alg ${quotedLiteral(alg)} does not match the private key (use ${key.alg})`
      );
    }
    if (!isPublicKeyOf(publicJwk, keyObject)) {
      throw new SigningError('publicJwk is not the public key of privateKey');
    }
    // The JWS `kid` header must be a string.
    if (publicJwk.kid !== undefined && typeof publicJwk.kid !== 'string') {
      throw new SigningError('publicJwk kid must be a string');
    }
    let jwk: jose.JWK;
    try {
      jwk = structuredClone(publicJwk);
    } catch {
      throw new SigningError('publicJwk must be a JWK object');
    }
    this.privateKey = keyObject;
    this.jwk = jwk;
    this.serviceUrl = serviceUrl;
    // Header members sorted by name, the kid only when the JWK has one.
    this.header =
      publicJwk.kid === undefined
        ? { alg: key.alg, typ: 'JWT' }
        : { alg: key.alg, kid: publicJwk.kid, typ: 'JWT' };
  }

  /**
   * Create a signer from a PEM-encoded private key (PKCS #8, SEC 1 or PKCS #1).
   *
   * The public JWK is derived from the key. The algorithm follows the key:
   * `ES256`/`ES384`/`ES512` for P-256/P-384/P-521 and `RS256` for RSA. RSA
   * keys marked for RSA-PSS only (for example from `openssl genpkey
   * -algorithm RSA-PSS`) are rejected, because quote
   * tokens are signed RS256 (PKCS #1 v1.5), which such a key does not allow.
   *
   * @param pem - The PEM-encoded private key
   * @param options - `kid`, `serviceUrl`, and `password` for an encrypted PEM
   * @returns The signer
   * @throws SigningError if the key cannot be
   *   loaded, is not EC (P-256, P-384, P-521) or RSA of at least 2048 bits, is
   *   marked RSA-PSS only, or `kid` is empty. An unencrypted RSA-PSS PEM whose
   *   algorithm can be read (lengths of 1 to 4 bytes) is refused before
   *   loading. Any other RSA-PSS key (encrypted, or with an indefinite or
   *   longer length) is refused after loading, with the same message unless
   *   loading fails first.
   */
  static fromPem(pem: string | Uint8Array, options: FromPemOptions): LocalQuoteSigner {
    const { kid, serviceUrl, password } = options ?? ({} as FromPemOptions);
    if (typeof kid !== 'string' || !stripWhitespace(kid)) {
      throw new SigningError('kid is required and must be non-empty.');
    }
    let text: string;
    let privateKey: KeyObject;
    try {
      text = pemAsText(pem);
    } catch (error) {
      throw pemLoadError(error);
    }
    // An RSA-PSS-only key is refused before loading, since quotes are signed
    // RS256 (PKCS #1 v1.5), which it does not allow.
    if (isRsaPssPem(text)) {
      throw new SigningError('Only EC and RSA private keys are supported.');
    }
    try {
      privateKey = loadPemPrivateKey(text, password);
    } catch (error) {
      throw pemLoadError(error);
    }

    // The key type and curve are checked before the public key is exported:
    // Node.js has no JWK form for DSA, RSA-PSS or curves such as secp224r1.
    const key = describePrivateKey(privateKey);
    if (key === undefined) {
      throw new SigningError('Only EC and RSA private keys are supported.');
    }
    if (key.alg === undefined) {
      throw new SigningError(`Unsupported EC curve: ${curveName(key.curve)}`);
    }
    const exported = createPublicKey(privateKey).export({ format: 'jwk' });
    const publicJwk: jose.JWK =
      key.kty === 'EC'
        ? // Member order: kty, crv, x, y
          { kty: 'EC', crv: exported.crv, x: exported.x, y: exported.y }
        : // Member order: kty, key_ops, n, e
          { kty: 'RSA', key_ops: ['verify'], n: exported.n, e: exported.e };
    Object.assign(publicJwk, { alg: key.alg, kid, use: 'sig' });
    return new LocalQuoteSigner(privateKey, publicJwk, serviceUrl);
  }

  /** The public key as a JWK, for publishing in the seller's JWKS. A copy each time. */
  get publicJwk(): jose.JWK {
    return structuredClone(this.jwk);
  }

  /**
   * Sign quote token claims.
   *
   * @param payload - Quote token claims to sign
   * @returns The compact JWS
   */
  async signQuote(payload: object): Promise<string> {
    return await new jose.SignJWT(payload as jose.JWTPayload)
      .setProtectedHeader(this.header)
      .sign(this.privateKey);
  }

  /** The service URL (issuer) */
  getServiceUrl(): string {
    return this.serviceUrl;
  }
}
