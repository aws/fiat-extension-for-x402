// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
/**
 * Freezes the public API surface: every sub-path in package.json `exports`,
 * and every name each one exports with its kind (class, function, const,
 * interface, type), type-only exports included.
 *
 * Adding, removing or renaming an export, or changing its kind, fails this
 * test until the snapshot is updated on purpose with
 * `npx vitest run test/api -u`, so it shows up in review. Removing or
 * renaming an export, or changing its kind, is a breaking change and needs a
 * new major version. Signatures and members are not in the snapshot; review
 * those in the source diff.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import ts from 'typescript';
import tsupConfig from '../../tsup.config';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Conditions {
  import: { types: string; default: string };
  require: { types: string; default: string };
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  exports: Record<string, Conditions>;
};

// './dist/agentic-commerce/exact/index.js' -> 'src/agentic-commerce/exact/index.ts'
const sourceOf = (conditions: Conditions): string => {
  // Fail with a clear message, not a TypeError in beforeAll, if an entry is
  // a plain string (e.g. "./package.json") or lacks an import condition.
  const target: unknown =
    typeof conditions === 'object' && conditions !== null
      ? (conditions as Partial<Conditions>).import
      : undefined;
  if (
    typeof target !== 'object' ||
    target === null ||
    typeof (target as { default?: unknown }).default !== 'string'
  ) {
    throw new Error(
      `Every exports entry must be { import: { types, default }, require: { types, default } }; got ${JSON.stringify(conditions)}`
    );
  }
  return conditions.import.default.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
};

const subpaths = Object.keys(pkg.exports).sort();

// Value exports first, then type-only ones; a merged symbol lists every kind.
const KINDS: Array<[ts.SymbolFlags, string]> = [
  [ts.SymbolFlags.Class, 'class'],
  [ts.SymbolFlags.Function, 'function'],
  [ts.SymbolFlags.Variable, 'variable'],
  [ts.SymbolFlags.RegularEnum, 'enum'],
  // esbuild (tsup, vitest) emits exported const enums as objects, so they
  // are runtime values.
  [ts.SymbolFlags.ConstEnum, 'const enum'],
  [ts.SymbolFlags.ValueModule, 'namespace'],
  [ts.SymbolFlags.Interface, 'interface'],
  [ts.SymbolFlags.TypeAlias, 'type'],
];
const VALUE_KINDS = new Set([
  'class',
  'function',
  'const',
  'let',
  'var',
  'enum',
  'const enum',
  'namespace',
]);

// 'const', 'let' or 'var', from the declaration.
function variableKind(symbol: ts.Symbol): string {
  let declaration = symbol.valueDeclaration;
  // `export const { a } = obj`: read the flags of the enclosing declaration.
  if (declaration && ts.isBindingElement(declaration)) {
    declaration = ts.walkUpBindingElementsAndPatterns(declaration);
  }
  if (!declaration || !ts.isVariableDeclaration(declaration)) return 'var';
  const flags = ts.getCombinedNodeFlags(declaration);
  if (flags & ts.NodeFlags.Const) return 'const';
  return flags & ts.NodeFlags.Let ? 'let' : 'var';
}

function kindsOf(symbol: ts.Symbol): string[] {
  const kinds = KINDS.filter(([flag]) => symbol.flags & flag).map(([, kind]) =>
    kind === 'variable' ? variableKind(symbol) : kind
  );
  // A namespace that holds only types has no runtime value.
  if (
    symbol.flags & ts.SymbolFlags.NamespaceModule &&
    !(symbol.flags & ts.SymbolFlags.ValueModule)
  ) {
    kinds.push('type namespace');
  }
  return kinds;
}

// True when any hop of the re-export chain is `export type` (or
// `export { type X }`): the name then exists only in the declarations.
function isTypeOnly(checker: ts.TypeChecker, symbol: ts.Symbol): boolean {
  for (let current: ts.Symbol | undefined = symbol; current;) {
    if (!(current.flags & ts.SymbolFlags.Alias)) return false;
    if (current.declarations?.some((d) => ts.isTypeOnlyImportOrExportDeclaration(d))) return true;
    const next = checker.getImmediateAliasedSymbol(current);
    current = next === current ? undefined : next;
  }
  return false;
}

type Entry = { name: string; kinds: string[] };

// Fixture for kinds the public API does not use today (type-only values,
// let, type-only namespaces), so their paths are still tested.
const TYPE_ONLY_FIXTURE = join(root, 'test', 'api', 'fixtures', 'type-only.ts');

/** Exports of each file, by file path, from one TypeScript program. */
function exportsOf(files: string[]): Map<string, Entry[]> {
  const configFile = ts.readConfigFile(join(root, 'tsconfig.json'), (path) =>
    ts.sys.readFile(path)
  );
  const { options } = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  const program = ts.createProgram(files, { ...options, noEmit: true });
  const checker = program.getTypeChecker();
  const result = new Map<string, Entry[]>();
  for (const file of files) {
    const source = program.getSourceFile(file);
    const moduleSymbol = source && checker.getSymbolAtLocation(source);
    if (!moduleSymbol) throw new Error(`Cannot load ${file}`);
    const entries = checker.getExportsOfModule(moduleSymbol).map((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      let kinds = kindsOf(target);
      // A value exported with `export type` is a type at runtime: 'type-only class'.
      if (isTypeOnly(checker, symbol)) {
        kinds = kinds.map((kind) => (VALUE_KINDS.has(kind) ? `type-only ${kind}` : kind));
      }
      return { name: symbol.name, kinds: kinds.length ? kinds : ['unknown'] };
    });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    result.set(file, entries);
  }
  return result;
}

describe('public API', () => {
  const declared = new Map<string, Entry[]>();
  let typeOnlyFixture: Entry[];
  beforeAll(() => {
    const files = subpaths.map((subpath) => join(root, sourceOf(pkg.exports[subpath])));
    const all = exportsOf([...files, TYPE_ONLY_FIXTURE]);
    subpaths.forEach((subpath, i) => declared.set(subpath, all.get(files[i])!));
    typeOnlyFixture = all.get(TYPE_ONLY_FIXTURE)!;
  });

  it('labels type-only values, let bindings and type-only namespaces', () => {
    expect(typeOnlyFixture).toEqual([
      { name: 'ConstEnumOnly', kinds: ['const enum'] },
      { name: 'ImportedTypeOnly', kinds: ['type-only class'] },
      { name: 'InlineTypeOnly', kinds: ['type-only class'] },
      { name: 'TypeNamespace', kinds: ['type namespace'] },
      { name: 'TypeOnlyClass', kinds: ['type-only class'] },
      { name: 'ValueFunction', kinds: ['function'] },
      { name: 'destructuredConst', kinds: ['const'] },
      { name: 'mutableBinding', kinds: ['let'] },
    ]);
  });

  it('matches the frozen export snapshot', async () => {
    const lines: string[] = [];
    for (const subpath of subpaths) {
      lines.push(`[${subpath}]`);
      for (const { name, kinds } of declared.get(subpath)!)
        lines.push(`${kinds.join('+')} ${name}`);
      lines.push('');
    }
    await expect(lines.join('\n')).toMatchFileSnapshot('./__snapshots__/public-api.txt');
  });

  it('has a known kind for every export', () => {
    for (const subpath of subpaths) {
      expect(declared.get(subpath)!.filter(({ kinds }) => kinds.includes('unknown'))).toEqual([]);
    }
  });

  it.each(subpaths)('exports the declared value names at runtime from %s', async (subpath) => {
    const mod = (await import(
      pathToFileURL(join(root, sourceOf(pkg.exports[subpath]))).href
    )) as Record<string, unknown>;
    const values = declared
      .get(subpath)!
      .filter(({ kinds }) => kinds.some((kind) => VALUE_KINDS.has(kind)))
      .map(({ name }) => name);
    expect(Object.keys(mod).sort()).toEqual(values);
  });

  it('builds exactly one tsup entry per sub-path, sharing code between them', () => {
    // tsup.config.ts is a single options object with an array of entries.
    const { entry, splitting } = tsupConfig as { entry: unknown; splitting?: boolean };
    expect(Array.isArray(entry)).toBe(true);
    expect([...(entry as string[])].sort()).toEqual(
      subpaths.map((s) => sourceOf(pkg.exports[s])).sort()
    );
    // Without splitting each entry bundles its own copy of every class, so an
    // error thrown by a scheme imported from a sub-path is not instanceof the
    // root's error class.
    expect(splitting).toBe(true);
  });

  it.each(subpaths)('types each condition of %s, types first', (subpath) => {
    const conditions = pkg.exports[subpath];
    const base = conditions.import.default.replace(/\.js$/, '');
    expect(Object.keys(conditions)).toEqual(['import', 'require']);
    expect(Object.entries(conditions.import)).toEqual([
      ['types', `${base}.d.ts`],
      ['default', `${base}.js`],
    ]);
    expect(Object.entries(conditions.require)).toEqual([
      ['types', `${base}.d.cts`],
      ['default', `${base}.cjs`],
    ]);
  });
});
