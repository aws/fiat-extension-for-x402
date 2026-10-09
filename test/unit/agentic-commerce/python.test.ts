// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  isPlainObject,
  isTruthy,
  pyEquals,
  pyInt,
  pyStr,
  rstripSlashes,
} from '../../../src/agentic-commerce/python';

describe('Python value semantics', () => {
  it('isPlainObject is true for objects only', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });

  it('isTruthy follows Python', () => {
    for (const falsy of [undefined, null, false, 0, '', [], {}])
      expect(isTruthy(falsy)).toBe(false);
    for (const truthy of [1, 'a', [0], { a: 0 }, true]) expect(isTruthy(truthy)).toBe(true);
  });

  it('pyEquals follows == on JSON values', () => {
    expect(pyEquals(undefined, null)).toBe(true);
    expect(pyEquals(true, 1)).toBe(true);
    expect(pyEquals(false, 0)).toBe(true);
    expect(pyEquals('a', 'a')).toBe(true);
    expect(pyEquals('a', ['a'])).toBe(false);
    expect(pyEquals([1, [2]], [1, [2]])).toBe(true);
    expect(pyEquals([1], [1, 2])).toBe(false);
    expect(pyEquals({ a: 1, b: [1] }, { b: [1], a: 1 })).toBe(true);
    expect(pyEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(pyEquals({ a: 1 }, { b: 1 })).toBe(false);
    expect(pyEquals({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('pyInt follows int()', () => {
    expect(pyInt(true)).toBe(1);
    expect(pyInt(12.9)).toBe(12);
    expect(pyInt(-12.9)).toBe(-12);
    expect(pyInt(Number.NaN)).toBeUndefined();
    expect(pyInt(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(pyInt(' +1_000 ')).toBe(1000);
    expect(pyInt('1.5')).toBeUndefined();
    expect(pyInt('1__0')).toBeUndefined();
    expect(pyInt(null)).toBeUndefined();
    expect(pyInt({})).toBeUndefined();
  });

  it('pyStr follows str() for scalars', () => {
    expect(pyStr(undefined)).toBe('None');
    expect(pyStr(null)).toBe('None');
    expect(pyStr(true)).toBe('True');
    expect(pyStr(false)).toBe('False');
    expect(pyStr('x')).toBe('x');
    expect(pyStr(3)).toBe('3');
  });

  it("rstripSlashes follows rstrip('/')", () => {
    expect(rstripSlashes('https://h///')).toBe('https://h');
    expect(rstripSlashes('https://h/a//b/')).toBe('https://h/a//b');
    expect(rstripSlashes('https://h')).toBe('https://h');
    expect(rstripSlashes('///')).toBe('');
    expect(rstripSlashes('')).toBe('');
    expect(rstripSlashes(`${'/'.repeat(100_000)}x`)).toBe(`${'/'.repeat(100_000)}x`);
  });
});
