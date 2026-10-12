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
 *
 * Follows the Python SDK's `fiat_extension_x402/signers/local.py` (commit
 * 62230e6). `signQuote` is async (a TS deviation, PYTHON-DELTA A19).
 */

import { KeyObject, createPrivateKey, createPublicKey } from 'node:crypto';
import * as jose from 'jose';
import { base64urlDecode, bigIntOf, isPlainObject, pyRepr } from '../agentic-commerce/python';
import { SigningError } from '../types';
import { stripPythonWhitespace } from '../utils';
import {
  describePrivateKey,
  privateJwkMembers,
  assertServiceUrl,
  privateKeyObject,
  type QuoteSigner,
} from './protocol';

// Node.js (OpenSSL) names of curves that cryptography names otherwise.
const CRYPTOGRAPHY_CURVE_NAMES: Record<string, string> = {
  prime192v1: 'secp192r1',
  prime256v1: 'secp256r1',
};

/** A curve as cryptography's `curve.name` writes it, for messages. */
function curveName(curve: string | undefined): string {
  const name = String(curve);
  return Object.hasOwn(CRYPTOGRAPHY_CURVE_NAMES, name) ? CRYPTOGRAPHY_CURVE_NAMES[name] : name;
}

/**
 * Smallest RSA modulus accepted for quote signing (NIST SP 800-57: 2048 bits).
 *
 * @internal
 */
export const MIN_RSA_KEY_BITS = 2048;

/** A JWK member decoded as PyJWT decodes it, or undefined when it does not decode. */
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

// The PEM tags cryptography's load_pem_private_key looks for (find_in_pem);
// any other block, such as OPENSSH PRIVATE KEY or CERTIFICATE, is skipped.
const PRIVATE_KEY_PEM_TAGS = [
  'PRIVATE KEY',
  'ENCRYPTED PRIVATE KEY',
  'RSA PRIVATE KEY',
  'EC PRIVATE KEY',
  'DSA PRIVATE KEY',
];

/**
 * The first private key PEM block (as `cryptography` loads the first one), and
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

/**
 * Load a PEM private key the way `cryptography`'s `load_pem_private_key` does:
 * a password is refused for an unencrypted key and required for an encrypted
 * one. A null password is no password, as Python's None.
 */
function loadPemPrivateKey(
  pem: string | Uint8Array,
  password?: string | Uint8Array | null
): KeyObject {
  const text = typeof pem === 'string' ? pem : Buffer.from(pem).toString('latin1');
  const first = firstPrivateKeyBlock(text);
  if (first === undefined) {
    // cryptography's messages: no PEM section at all, or no private key section
    if (!text.includes('-----BEGIN ')) {
      throw new Error(
        'Unable to load PEM file. See ' +
          'https://cryptography.io/en/latest/faq/#why-can-t-i-import-my-pem-file ' +
          'for more details. MalformedFraming'
      );
    }
    throw new Error(
      'Valid PEM but no BEGIN/END delimiters for a private key found. ' +
        'Are you sure this is a private key?'
    );
  }
  const { block: key, encrypted } = first;
  // cryptography's messages for a password mismatch. For an encrypted key an
  // empty password is no password, as in cryptography.
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
    // error, as cryptography 50 reports it ("Could not deserialize key data").
    if ((error as { code?: unknown }).code === 'ERR_OSSL_BAD_DECRYPT') {
      throw new Error('Incorrect password, could not decrypt key', { cause: error });
    }
    throw error;
  }
}

/** Options of {@link LocalQuoteSigner.fromPem} */
interface FromPemOptions {
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
   *   shorter than 2048 bits (the Python SDK's checks); or, checked only by
   *   this SDK, the key is not an EC (P-256, P-384, P-521) or RSA private key,
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
    // Not a Python SDK check: Python fails when signing, or signs with an alg
    // that no verifier accepts (PS256, RS384).
    const alg: unknown = publicJwk.alg === undefined ? 'ES256' : publicJwk.alg;
    if (alg !== key.alg) {
      throw new SigningError(
        `publicJwk alg ${pyRepr(alg)} does not match the private key (use ${key.alg})`
      );
    }
    if (!isPublicKeyOf(publicJwk, keyObject)) {
      throw new SigningError('publicJwk is not the public key of privateKey');
    }
    // PyJWT refuses a non-string kid when signing.
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
    // PyJWT's header: sorted members, the kid only when the JWK has one.
    this.header =
      publicJwk.kid === undefined
        ? { alg: key.alg, typ: 'JWT' }
        : { alg: key.alg, kid: publicJwk.kid, typ: 'JWT' };
  }

  /**
   * Create a signer from a PEM-encoded private key (PKCS #8, SEC 1 or PKCS #1).
   *
   * The public JWK is derived from the key. The algorithm follows the key:
   * `ES256`/`ES384`/`ES512` for P-256/P-384/P-521 and `RS256` for RSA.
   *
   * @param pem - The PEM-encoded private key
   * @param options - `kid`, `serviceUrl`, and `password` for an encrypted PEM
   * @returns The signer
   * @throws SigningError if the key cannot be
   *   loaded, is not EC (P-256, P-384, P-521) or RSA of at least 2048 bits, or
   *   `kid` is empty
   */
  static fromPem(pem: string | Uint8Array, options: FromPemOptions): LocalQuoteSigner {
    const { kid, serviceUrl, password } = options ?? ({} as FromPemOptions);
    if (typeof kid !== 'string' || !stripPythonWhitespace(kid)) {
      throw new SigningError('kid is required and must be non-empty.');
    }
    let privateKey: KeyObject;
    try {
      privateKey = loadPemPrivateKey(pem, password);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new SigningError(`Could not load the PEM private key: ${message}`, undefined, {
        cause: error,
      });
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
        ? // PyJWT's ECAlgorithm.to_jwk member order
          { kty: 'EC', crv: exported.crv, x: exported.x, y: exported.y }
        : // PyJWT's RSAAlgorithm.to_jwk member order, with its key_ops
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
