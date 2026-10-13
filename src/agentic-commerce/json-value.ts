// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Value rules for decoded JSON, defined the same way everywhere in the
 * package: equality, truthiness, integer parsing, the text form of values
 * (used both in error messages and in comparisons), and the decoding of JWK
 * members (base64url, big-endian integers). Their output is part of the
 * verifier's behaviour. Internal: not exported from the package.
 */

import { stripWhitespace } from '../utils';

/** A JSON object (not null, not an array) */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Truthiness that is also false for an empty array or object, which JavaScript treats as true. */
export function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * Equality of decoded JSON values, compared by value: a missing value equals
 * `null`, and `true` equals 1 (and `false` equals 0).
 */
export function looseEquals(a: unknown, b: unknown): boolean {
  const x = typeof a === 'boolean' ? Number(a) : (a ?? null);
  const y = typeof b === 'boolean' ? Number(b) : (b ?? null);
  if (x === y) return true;
  if (Array.isArray(x) && Array.isArray(y)) {
    return x.length === y.length && x.every((item, i) => looseEquals(item, y[i]));
  }
  if (isPlainObject(x) && isPlainObject(y)) {
    const keys = Object.keys(x);
    return (
      keys.length === Object.keys(y).length &&
      keys.every((key) => Object.hasOwn(y, key) && looseEquals(x[key], y[key]))
    );
  }
  return false;
}

/**
 * A decoded JSON value as an integer: a boolean as 0 or 1, a finite number
 * truncated, or a string of decimal digits (optional sign, `_` between
 * digits, surrounding whitespace). Undefined for anything else.
 */
export function toInteger(value: unknown): number | undefined {
  if (typeof value === 'boolean') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : undefined;
  if (typeof value === 'string') {
    const text = stripWhitespace(value);
    return /^[+-]?\d+(?:_\d+)*$/.test(text) ? Number(text.replace(/_/g, '')) : undefined;
  }
  return undefined;
}

/**
 * The text form of a scalar JSON value: the string itself, `None`, `True` and
 * `False` for null and booleans, and JSON for anything else. Used in error
 * messages, and also as the comparison form of values (quote tokens, key types,
 * curves, assets), so its output is part of the verifier's behaviour.
 */
export function displayText(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Every trailing '/' removed, in linear time
 * (a regex such as `/\/+$/` is quadratic on a long run of '/' mid-string).
 */
export function rstripSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

// Characters escaped in quoted message text: the Unicode Other and Separator
// categories, except the ASCII space. Tested one character at a time.
const NOT_PRINTABLE = /^[\p{C}\p{Z}]$/u;

/** The escape of a non-printable code point: \xNN, \uNNNN or \UNNNNNNNN */
function escapeCodePoint(code: number): string {
  if (code < 0x100) return `\\x${code.toString(16).padStart(2, '0')}`;
  if (code < 0x10000) return `\\u${code.toString(16).padStart(4, '0')}`;
  return `\\U${code.toString(16).padStart(8, '0')}`;
}

/**
 * A JSON value quoted for an error message: strings in single quotes (double
 * quotes when the text holds a ' and no "), with non-printable characters
 * escaped; None, True and False; arrays and objects as [a, b] and {'k': v}.
 */
export function quotedLiteral(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(quotedLiteral).join(', ')}]`;
  if (isPlainObject(value)) {
    const items = Object.entries(value).map(
      ([key, item]) => `${quotedLiteral(key)}: ${quotedLiteral(item)}`
    );
    return `{${items.join(', ')}}`;
  }
  if (typeof value !== 'string') return displayText(value);
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\' || ch === quote) out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch !== ' ' && NOT_PRINTABLE.test(ch)) out += escapeCodePoint(code);
    else out += ch;
  }
  return out + quote;
}

/**
 * A lone surrogate has no UTF-8 encoding, so it is refused; Buffer.from would
 * silently replace it with U+FFFD instead.
 */
function assertEncodable(value: string): void {
  let position = 0;
  for (let i = 0; i < value.length; i++, position++) {
    const code = value.charCodeAt(i);
    if (code < 0xd800 || code > 0xdfff) continue;
    const next = value.charCodeAt(i + 1);
    if (code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
      i++;
      continue;
    }
    throw new Error(
      `'utf-8' codec can't encode character '\\u${code.toString(16)}' in position ` +
        `${position}: surrogates not allowed`
    );
  }
}

// Value of each base64 character; the URL-safe '-' and '_' count as '+' and '/'.
function base64Value(byte: number): number {
  if (byte >= 0x41 && byte <= 0x5a) return byte - 0x41; // A-Z
  if (byte >= 0x61 && byte <= 0x7a) return byte - 0x61 + 26; // a-z
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30 + 52; // 0-9
  if (byte === 0x2b || byte === 0x2d) return 62; // '+', '-'
  if (byte === 0x2f || byte === 0x5f) return 63; // '/', '_'
  return -1;
}

/**
 * Base64url decoding of a JWK member: the UTF-8 bytes are padded with '=' to
 * a multiple of 4, then decoded leniently: characters outside the alphabet
 * are skipped, a complete pad ends the input, and a partial final quantum is
 * an error. Callers that parse a JWK add "Unable to construct key from JWK: "
 * to the error message.
 *
 * @internal
 */
export function base64urlDecode(value: unknown): Buffer {
  if (typeof value !== 'string') throw new TypeError('Expected a string value');
  assertEncodable(value);
  const input = Buffer.from(value, 'utf8');
  const padded = Buffer.concat([input, Buffer.from('='.repeat((4 - (input.length % 4)) % 4))]);
  const out: number[] = [];
  let quadPos = 0;
  let leftChar = 0;
  let pads = 0;
  for (const byte of padded) {
    if (byte === 0x3d) {
      if (quadPos >= 2 && quadPos + ++pads >= 4) return Buffer.from(out);
      continue;
    }
    const bits = base64Value(byte);
    if (bits < 0) continue;
    pads = 0;
    if (quadPos === 0) {
      leftChar = bits;
    } else if (quadPos === 1) {
      out.push(((leftChar << 2) | (bits >> 4)) & 0xff);
      leftChar = bits & 0x0f;
    } else if (quadPos === 2) {
      out.push(((leftChar << 4) | (bits >> 2)) & 0xff);
      leftChar = bits & 0x03;
    } else {
      out.push(((leftChar << 6) | bits) & 0xff);
    }
    quadPos = (quadPos + 1) % 4;
  }
  if (quadPos === 1) {
    throw new Error(
      'Invalid base64-encoded string: number of data ' +
        `characters (${Math.floor(out.length / 3) * 4 + 1}) cannot be 1 more than a multiple of 4`
    );
  }
  if (quadPos !== 0) throw new Error('Incorrect padding');
  return Buffer.from(out);
}

/**
 * Big-endian bytes as an unsigned integer.
 *
 * @internal
 */
export function bigIntOf(bytes: Buffer): bigint {
  return bytes.length ? BigInt(`0x${bytes.toString('hex')}`) : 0n;
}
