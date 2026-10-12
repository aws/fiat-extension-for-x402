// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Python value semantics for JSON values, so this SDK accepts and rejects the
 * same inputs as the Python SDK. Internal: not exported from the package.
 */

import { stripPythonWhitespace } from '../utils';

/** A JSON object (Python `dict`) */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Python truthiness: also false for an empty array or object, which JavaScript treats as true. */
export function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return Boolean(value);
}

/**
 * Python `==` on decoded JSON values. A missing value and `null` are both
 * Python's `None`, and `True == 1` as in Python.
 */
export function pyEquals(a: unknown, b: unknown): boolean {
  const x = typeof a === 'boolean' ? Number(a) : (a ?? null);
  const y = typeof b === 'boolean' ? Number(b) : (b ?? null);
  if (x === y) return true;
  if (Array.isArray(x) && Array.isArray(y)) {
    return x.length === y.length && x.every((item, i) => pyEquals(item, y[i]));
  }
  if (isPlainObject(x) && isPlainObject(y)) {
    const keys = Object.keys(x);
    return (
      keys.length === Object.keys(y).length &&
      keys.every((key) => Object.hasOwn(y, key) && pyEquals(x[key], y[key]))
    );
  }
  return false;
}

/** Python `int(value)` on a decoded JSON value, or undefined where Python raises. */
export function pyInt(value: unknown): number | undefined {
  if (typeof value === 'boolean') return Number(value);
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : undefined;
  if (typeof value === 'string') {
    const text = stripPythonWhitespace(value);
    return /^[+-]?\d+(?:_\d+)*$/.test(text) ? Number(text.replace(/_/g, '')) : undefined;
  }
  return undefined;
}

/** Python `str(value)` for the scalar JSON values that appear in messages. */
export function pyStr(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/**
 * Python `value.rstrip('/')`: every trailing '/' removed, in linear time
 * (a regex such as `/\/+$/` is quadratic on a long run of '/' mid-string).
 */
export function rstripSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === '/') end--;
  return value.slice(0, end);
}

// Python's str.isprintable() is false for these categories (Other and
// Separator), except the ASCII space. Tested one character at a time.
const NOT_PRINTABLE = /^[\p{C}\p{Z}]$/u;

/** Python's repr escape of a non-printable code point */
function pyEscape(code: number): string {
  if (code < 0x100) return `\\x${code.toString(16).padStart(2, '0')}`;
  if (code < 0x10000) return `\\u${code.toString(16).padStart(4, '0')}`;
  return `\\U${code.toString(16).padStart(8, '0')}`;
}

/**
 * Python `repr(value)` for the JSON values that appear in messages: strings
 * in single quotes (double quotes when the text holds a ' and no "), None,
 * True and False, lists and dicts.
 */
export function pyRepr(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(', ')}]`;
  if (isPlainObject(value)) {
    const items = Object.entries(value).map(([key, item]) => `${pyRepr(key)}: ${pyRepr(item)}`);
    return `{${items.join(', ')}}`;
  }
  if (typeof value !== 'string') return pyStr(value);
  const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of value) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\' || ch === quote) out += `\\${ch}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch !== ' ' && NOT_PRINTABLE.test(ch)) out += pyEscape(code);
    else out += ch;
  }
  return out + quote;
}

/**
 * Python `str.encode('utf-8')` refuses a lone surrogate (UnicodeEncodeError, a
 * ValueError); Buffer.from would replace it with U+FFFD instead.
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

// Value of each base64 character after urlsafe_b64decode's '-' to '+', '_' to '/'.
function base64Value(byte: number): number {
  if (byte >= 0x41 && byte <= 0x5a) return byte - 0x41; // A-Z
  if (byte >= 0x61 && byte <= 0x7a) return byte - 0x61 + 26; // a-z
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30 + 52; // 0-9
  if (byte === 0x2b || byte === 0x2d) return 62; // '+', '-'
  if (byte === 0x2f || byte === 0x5f) return 63; // '/', '_'
  return -1;
}

/**
 * PyJWT's `base64url_decode` (jwt/utils.py): the UTF-8 bytes are padded with
 * '=' to a multiple of 4, then decoded as CPython's non-strict
 * `binascii.a2b_base64` does: other characters are skipped, a complete pad
 * ends the input, and a partial final quantum is an error. The errors carry
 * Python's messages (PyJWK adds "Unable to construct key from JWK: ").
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
  // binascii.Error, a ValueError
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
 * Big-endian bytes as an unsigned integer (Python `int.from_bytes(b, 'big')`).
 *
 * @internal
 */
export function bigIntOf(bytes: Buffer): bigint {
  return bytes.length ? BigInt(`0x${bytes.toString('hex')}`) : 0n;
}
