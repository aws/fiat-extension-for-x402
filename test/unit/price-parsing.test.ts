// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect, beforeAll } from 'vitest';
import type { AssetAmount } from '@x402/core/types';
import { ExactAgenticCommerceScheme } from '../../src/agentic-commerce/exact/server';
import { parseMoneyToDecimal } from '../../src/utils';
import { ValidationError } from '../../src/types';
import { QuoteTokenPriceSchema } from '../../src/schemas';
import { createMockServiceSigner } from '../helpers/mock-service-signer';

// Route price parsing must accept and reject exactly what the Python SDK does.
// The first block copies the cases of the Python SDK's TestParsePrice
// (tests/unit/agentic_commerce/exact/test_server.py:121-179) as they are.

const char = (code: number) => String.fromCharCode(code);

let scheme: ExactAgenticCommerceScheme;
const parse = (price: unknown) => scheme.parsePrice(price as never, 'aws:base');

beforeAll(async () => {
  const { signer } = await createMockServiceSigner('https://api.example.com');
  scheme = new ExactAgenticCommerceScheme({ signer });
});

describe('parsePrice: Python SDK TestParsePrice cases', () => {
  it.each([
    ['$1.50', '1.50', 'iso4217:USD'],
    ['1.50 USD', '1.50', 'iso4217:USD'],
    ['1.50', '1.50', 'iso4217:USD'],
    ['  $3  ', '3', 'iso4217:USD'],
    ['2 EUR', '2', 'iso4217:EUR'],
    ['0.5JPY', '0.5', 'iso4217:JPY'],
    [1.5, '1.5', 'iso4217:USD'],
    [2, '2', 'iso4217:USD'],
    [0, '0', 'iso4217:USD'],
  ])('parses %j', async (price, amount, asset) => {
    await expect(parse(price)).resolves.toEqual({ amount, asset, extra: {} });
  });

  it('passes an AssetAmount through unchanged', async () => {
    const price: AssetAmount = { amount: '7', asset: 'iso4217:GBP', extra: { k: 'v' } };
    await expect(parse(price)).resolves.toBe(price);
  });

  it('passes a plain amount/asset object through', async () => {
    const parsed = await parse({ amount: '7', asset: 'iso4217:GBP' });
    expect(parsed.amount).toBe('7');
    expect(parsed.asset).toBe('iso4217:GBP');
  });

  it.each(['', 'abc', 'USD 1.50', '1.50 usd', '1.', '1,50', '-1.50', '$-1', '1.50 USDD'])(
    'rejects the invalid string %j',
    async (price) => {
      await expect(parse(price)).rejects.toThrow(ValidationError);
      await expect(parse(price)).rejects.toThrow('Invalid price');
    }
  );

  it.each([-1.5, -1])('rejects the negative number %d', async (price) => {
    await expect(parse(price)).rejects.toThrow('finite, non-negative');
  });

  it('rejects NaN', async () => {
    await expect(parse(Number.NaN)).rejects.toThrow('finite, non-negative');
  });

  it('rejects Infinity', async () => {
    await expect(parse(Number.POSITIVE_INFINITY)).rejects.toThrow('finite, non-negative');
  });

  it('writes a small number in plain decimal notation', async () => {
    expect((await parse(1e-7)).amount).toBe('0.0000001');
  });

  it('accepts eight decimal places', async () => {
    expect((await parse('$0.00000001')).amount).toBe('0.00000001');
  });

  it.each(['$0.000000001', 1e-9])('rejects more than eight decimal places: %j', async (price) => {
    await expect(parse(price)).rejects.toThrow('at most 8 decimal places');
  });
});

describe('parsePrice: decimal places', () => {
  it.each(['1.10000000', '0.00000000', '99.99999990 EUR'])('accepts 8 decimals: %j', async (p) => {
    await expect(parse(p)).resolves.toMatchObject({ amount: p.split(' ')[0] });
  });

  it.each(['1.123456789', '1.000000000', '$0.000000000 EUR', 0.1 + 0.2, 1.5e-9])(
    'rejects more than 8 decimals: %j',
    async (price) => {
      await expect(parse(price)).rejects.toThrow('at most 8 decimal places');
    }
  );

  it('counts the decimals of a number from its shortest round-trip digits', async () => {
    expect((await parse(1.5e-7)).amount).toBe('0.00000015');
    expect((await parse(0.12345678)).amount).toBe('0.12345678');
  });
});

describe('parsePrice: "$" prefix, currency suffix and casing', () => {
  it('keeps the string amount verbatim', async () => {
    expect((await parse('$01.50')).amount).toBe('01.50');
    expect((await parse('1.50')).amount).toBe('1.50');
    expect((await parse('$1.00')).amount).toBe('1.00');
  });

  it.each([
    ['$2.50 EUR', '2.50', 'iso4217:EUR'],
    ['$7.00GBP', '7.00', 'iso4217:GBP'],
    ['10.0 USD', '10.0', 'iso4217:USD'],
  ])('parses %j', async (price, amount, asset) => {
    await expect(parse(price)).resolves.toEqual({ amount, asset, extra: {} });
  });

  it.each(['1.50 eur', '1.50 Eur', '1.50 EU', '1.50 EURO', '1.50 $', '$$1.50', '1.50$', 'EUR'])(
    'rejects %j',
    async (price) => {
      await expect(parse(price)).rejects.toThrow('Invalid price');
    }
  );
});

describe('parsePrice: whitespace (Python str.strip() and re \\s)', () => {
  it.each([
    [' 1.50 ', '1.50', 'iso4217:USD'],
    ['\t1.50\n', '1.50', 'iso4217:USD'],
    ['1.50   EUR', '1.50', 'iso4217:EUR'],
    ['1.50\tEUR', '1.50', 'iso4217:EUR'],
    [`1.50${char(0xa0)}EUR`, '1.50', 'iso4217:EUR'],
    [`${char(0x1c)}1.50${char(0x85)}`, '1.50', 'iso4217:USD'],
    [`1.50${char(0x3000)}`, '1.50', 'iso4217:USD'],
  ])('parses %j', async (price, amount, asset) => {
    await expect(parse(price)).resolves.toEqual({ amount, asset, extra: {} });
  });

  // U+FEFF is whitespace to JavaScript's trim() but not to Python.
  it.each([' ', '\t', '$ 1.50', '1 .50', '1. 50', `${char(0xfeff)}1.50`, `1.50${char(0x200b)}`])(
    'rejects %j',
    async (price) => {
      await expect(parse(price)).rejects.toThrow('Invalid price');
    }
  );
});

describe('parsePrice: malformed numbers', () => {
  it.each(['1e5', '1E5', '1.5e-3', '+1.50', '+1', '.5', '0x10', 'Infinity', 'NaN', '1_000'])(
    'rejects %j',
    async (price) => {
      await expect(parse(price)).rejects.toThrow('Invalid price');
    }
  );

  it.each([null, undefined, true, {}, ['1.50'], [2], BigInt(10)])(
    'rejects the non-price value %s',
    async (price) => {
      await expect(parse(price)).rejects.toThrow(ValidationError);
    }
  );
});

describe('parsePrice: very large amounts', () => {
  it('keeps a long integer string verbatim', async () => {
    const amount = '123456789012345678901234567890';
    expect((await parse(amount)).amount).toBe(amount);
    expect((await parse(`${amount}.12345678 EUR`)).amount).toBe(`${amount}.12345678`);
  });

  it('writes a large number in plain notation', async () => {
    expect((await parse(1e21)).amount).toBe('1000000000000000000000');
    expect((await parse(1.5e30)).amount).toBe(`15${'0'.repeat(29)}`);
    expect((await parse(Number.MAX_SAFE_INTEGER)).amount).toBe('9007199254740991');
  });
});

describe('parsePrice: plain-notation output for numbers', () => {
  it.each([
    [1e-8, '0.00000001'],
    [5e-7, '0.0000005'],
    [1.2e-7, '0.00000012'],
    [1e-6 / 4, '0.00000025'],
  ])('writes %d as %j', async (price, amount) => {
    expect((await parse(price)).amount).toBe(amount);
  });
});

describe('parseMoneyToDecimal applies the same rules', () => {
  it('trims Python whitespace', () => {
    expect(parseMoneyToDecimal('  $3  ')).toEqual({ amount: 3, currency: 'USD' });
  });

  it.each(['1.', '$0.000000001', '1.123456789 EUR'])('rejects %j', (price) => {
    expect(() => parseMoneyToDecimal(price)).toThrow(ValidationError);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1e-9])('rejects the number %d', (price) => {
    expect(() => parseMoneyToDecimal(price)).toThrow(ValidationError);
  });
});

// The old pattern, ^\$?(\d+\.?\d*)\s*([A-Z]{3})?$, backtracks quadratically: a
// 50,000-character input took about 11 seconds. The budget is far above the
// new parser's time (under 1 ms) and far below the old one's, and the best of
// three runs is used, so a slow CI machine or a GC pause does not fail it.
describe('price parsing runs in linear time (CodeQL js/polynomial-redos)', () => {
  const BUDGET_MS = 50;
  const LENGTH = 50_000;
  const bestOfThree = async (run: () => void | Promise<void>): Promise<number> => {
    let best = Infinity;
    for (let i = 0; i < 3 && best >= BUDGET_MS; i++) {
      const start = performance.now();
      await run();
      best = Math.min(best, performance.now() - start);
    }
    return best;
  };

  it.each([
    ['digits then a non-matching character', '1'.repeat(LENGTH) + '!'],
    [
      'digits, a dot, digits, then a non-matching character',
      `$${'1'.repeat(LENGTH / 2)}.${'1'.repeat(LENGTH / 2)}!`,
    ],
    ['whitespace between digits and a non-matching character', `1${' '.repeat(LENGTH)}!`],
    ['tabs between digits and a lowercase code', `1${'\t'.repeat(LENGTH)}usd`],
  ])(
    'rejects %s within the budget',
    async (_name, input) => {
      const elapsed = await bestOfThree(() => {
        expect(() => parseMoneyToDecimal(input)).toThrow('Invalid price');
      });
      expect(elapsed).toBeLessThan(BUDGET_MS);
    },
    120_000
  );

  it('rejects an adversarial route price within the budget', async () => {
    const input = '1'.repeat(LENGTH) + '!';
    const elapsed = await bestOfThree(async () => {
      await expect(parse(input)).rejects.toThrow('Invalid price');
    });
    expect(elapsed).toBeLessThan(BUDGET_MS);
  }, 120_000);
});

describe('QuoteTokenPriceSchema amount runs in linear time (CodeQL js/polynomial-redos)', () => {
  it('accepts the same decimal strings as before', () => {
    for (const amount of ['0', '1', '1.', '1.50', '0.00000001', '123456789012345678901234567890']) {
      expect(QuoteTokenPriceSchema.safeParse({ amount, currency: 'USD' }).success).toBe(true);
    }
    for (const amount of ['', '.5', '1..5', '1.5.', '-1', '1e5', ' 1', 'abc']) {
      expect(QuoteTokenPriceSchema.safeParse({ amount, currency: 'USD' }).success).toBe(false);
    }
  });

  it('rejects a 50,000-digit amount with a trailing non-digit within 50 ms', () => {
    const amount = '1'.repeat(50_000) + '!';
    let best = Infinity;
    for (let i = 0; i < 3 && best >= 50; i++) {
      const start = performance.now();
      expect(QuoteTokenPriceSchema.safeParse({ amount, currency: 'USD' }).success).toBe(false);
      best = Math.min(best, performance.now() - start);
    }
    expect(best).toBeLessThan(50);
  }, 120_000);
});
