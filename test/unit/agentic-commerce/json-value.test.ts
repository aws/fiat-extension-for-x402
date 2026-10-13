// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import {
  isPlainObject,
  isTruthy,
  looseEquals,
  toInteger,
  displayText,
  rstripSlashes,
} from '../../../src/agentic-commerce/json-value';

describe('JSON value helpers', () => {
  it('isPlainObject is true for objects only', () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
  });

  it('isTruthy is false for undefined, null, false, 0 and empty strings, arrays and objects', () => {
    for (const falsy of [undefined, null, false, 0, '', [], {}])
      expect(isTruthy(falsy)).toBe(false);
    for (const truthy of [1, 'a', [0], { a: 0 }, true]) expect(isTruthy(truthy)).toBe(true);
  });

  it('looseEquals compares JSON values deeply, with true equal to 1 and undefined to null', () => {
    expect(looseEquals(undefined, null)).toBe(true);
    expect(looseEquals(true, 1)).toBe(true);
    expect(looseEquals(false, 0)).toBe(true);
    expect(looseEquals('a', 'a')).toBe(true);
    expect(looseEquals('a', ['a'])).toBe(false);
    expect(looseEquals([1, [2]], [1, [2]])).toBe(true);
    expect(looseEquals([1], [1, 2])).toBe(false);
    expect(looseEquals({ a: 1, b: [1] }, { b: [1], a: 1 })).toBe(true);
    expect(looseEquals({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(looseEquals({ a: 1 }, { b: 1 })).toBe(false);
    expect(looseEquals({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('toInteger truncates finite numbers and parses decimal integer strings with sign, spaces and underscores', () => {
    expect(toInteger(true)).toBe(1);
    expect(toInteger(12.9)).toBe(12);
    expect(toInteger(-12.9)).toBe(-12);
    expect(toInteger(Number.NaN)).toBeUndefined();
    expect(toInteger(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(toInteger(' +1_000 ')).toBe(1000);
    expect(toInteger('1.5')).toBeUndefined();
    expect(toInteger('1__0')).toBeUndefined();
    expect(toInteger(null)).toBeUndefined();
    expect(toInteger({})).toBeUndefined();
  });

  it('displayText renders null and undefined as None and booleans as True and False', () => {
    expect(displayText(undefined)).toBe('None');
    expect(displayText(null)).toBe('None');
    expect(displayText(true)).toBe('True');
    expect(displayText(false)).toBe('False');
    expect(displayText('x')).toBe('x');
    expect(displayText(3)).toBe('3');
  });

  it('rstripSlashes removes trailing slashes only', () => {
    expect(rstripSlashes('https://h///')).toBe('https://h');
    expect(rstripSlashes('https://h/a//b/')).toBe('https://h/a//b');
    expect(rstripSlashes('https://h')).toBe('https://h');
    expect(rstripSlashes('///')).toBe('');
    expect(rstripSlashes('')).toBe('');
    expect(rstripSlashes(`${'/'.repeat(100_000)}x`)).toBe(`${'/'.repeat(100_000)}x`);
  });
});
