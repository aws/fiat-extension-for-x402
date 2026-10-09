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
