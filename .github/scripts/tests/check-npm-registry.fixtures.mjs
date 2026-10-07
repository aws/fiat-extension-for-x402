// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Fixtures for check-npm-registry.mjs. Run: node --test .github/scripts/tests/*.fixtures.mjs
// (Not *.test.mjs, so vitest does not collect them.)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'check-npm-registry.mjs');
const repoRoot = join(here, '..', '..', '..');
const R = 'https://registry.npmjs.org/';
// Built by concatenation so this file contains no internal host.
const MIRROR = 'https://example-123.d.code' + 'artifact.us-west-2.amazonaws.com/npm/shared/';

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const run = (dir) => {
  const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  return { code: result.status, out: result.stdout + result.stderr };
};

const entry = (name, version, extra = {}) => ({
  version,
  resolved: `${R}${name}/-/${name.split('/').pop()}-${version}.tgz`,
  integrity: 'sha512-AAAA',
  ...extra,
});

const goodPackages = () => ({
  '': { name: 'fixture', version: '1.0.0' },
  'node_modules/left-pad': entry('left-pad', '1.3.0'),
  'node_modules/@scope/pkg': entry('@scope/pkg', '2.0.0'),
  'node_modules/a/node_modules/@scope/b': entry('@scope/b', '0.1.0'),
  'node_modules/string-width-cjs': { ...entry('string-width', '4.2.3'), name: 'string-width' },
  'node_modules/local': { resolved: 'packages/local', link: true },
});

const fixture = ({ lock, packages, npmrc, raw } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'registry-guard-'));
  dirs.push(dir);
  if (raw !== undefined) writeFileSync(join(dir, 'package-lock.json'), raw);
  else if (lock !== null) {
    const body = lock ?? { name: 'fixture', lockfileVersion: 3, packages: packages ?? goodPackages() };
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify(body));
  }
  if (npmrc !== undefined) writeFileSync(join(dir, '.npmrc'), npmrc);
  return dir;
};

const withEntry = (path, value) => ({ ...goodPackages(), [path]: value });

const blocks = (dir, pattern) => {
  const { code, out } = run(dir);
  assert.equal(code, 1, out);
  assert.match(out, /::error file=/);
  if (pattern) assert.match(out, pattern);
};

describe('check-npm-registry: passes', () => {
  it('the repository lockfile', () => {
    const { code, out } = run(repoRoot);
    assert.equal(code, 0, out);
  });
  it('scoped, nested, aliased and linked entries', () => {
    const { code, out } = run(fixture());
    assert.equal(code, 0, out);
  });
  it('lockfileVersion 2', () => {
    const dir = fixture({ lock: { lockfileVersion: 2, packages: goodPackages(), dependencies: {} } });
    const { code, out } = run(dir);
    assert.equal(code, 0, out);
  });
  it('a bundled dependency, which has no resolved URL or integrity of its own', () => {
    const packages = withEntry('node_modules/parent/node_modules/bundled', { version: '1.0.0', inBundle: true });
    const dir = fixture({ packages });
    assert.equal(run(dir).code, 0, run(dir).out);
  });
  it('a benign .npmrc, with comments mentioning registry', () => {
    const npmrc = 'fund=false\n# registry=https://evil.example/\n; @x:registry=https://evil.example/\nengine-strict=true\n';
    const { code, out } = run(fixture({ npmrc }));
    assert.equal(code, 0, out);
  });
});

describe('check-npm-registry: blocks', () => {
  it('a lookalike host', () =>
    blocks(fixture({ packages: withEntry('node_modules/x', { ...entry('x', '1.0.0'), resolved: 'https://registry.npmjs.org.evil.example/x/-/x-1.0.0.tgz' }) }), /node_modules\/x resolves to/));
  it('plain http', () =>
    blocks(fixture({ packages: withEntry('node_modules/x', { ...entry('x', '1.0.0'), resolved: 'http://registry.npmjs.org/x/-/x-1.0.0.tgz' }) })));
  it('an internal package mirror', () =>
    blocks(fixture({ packages: withEntry('node_modules/x', { ...entry('x', '1.0.0'), resolved: `${MIRROR}x/-/x-1.0.0.tgz` }) })));
  it('a missing resolved URL', () =>
    blocks(fixture({ packages: withEntry('node_modules/x', { version: '1.0.0', integrity: 'sha512-AAAA' }) }), /no resolved URL/));
  it('a non-node_modules entry without resolved (same scope as the inline guard)', () =>
    blocks(fixture({ packages: withEntry('packages/local', { version: '1.0.0' }) })));
  it('a missing integrity hash', () =>
    blocks(fixture({ packages: withEntry('node_modules/x', { ...entry('x', '1.0.0'), integrity: undefined }) }), /no integrity hash/));
  it('an empty integrity hash', () =>
    blocks(fixture({ packages: withEntry('node_modules/x', { ...entry('x', '1.0.0'), integrity: '' }) }), /no integrity hash/));
  it("another package's tarball", () =>
    blocks(fixture({ packages: withEntry('node_modules/x', { ...entry('evil', '1.0.0') }) }), /its name and version give/));
  it('a tarball of another version', () =>
    blocks(fixture({ packages: withEntry('node_modules/x', { ...entry('x', '1.0.0'), version: '1.0.1' }) }), /x-1\.0\.1\.tgz/));
  it('a scoped name with the wrong scope', () =>
    blocks(fixture({ packages: withEntry('node_modules/@scope/x', entry('@other/x', '1.0.0')) })));
  it('an alias whose name does not match its tarball', () =>
    blocks(fixture({ packages: withEntry('node_modules/y-cjs', { ...entry('y', '1.0.0'), name: 'z' }) })));
  it('a missing version', () =>
    blocks(fixture({ packages: withEntry('node_modules/x', { ...entry('x', '1.0.0'), version: undefined }) })));
  it('an entry that is not an object', () =>
    blocks(fixture({ packages: withEntry('node_modules/x', 'oops') }), /is not an object/));
  it('a v1 lockfile', () =>
    blocks(fixture({ lock: { lockfileVersion: 1, dependencies: {} } }), /lockfileVersion 2 or 3 required/));
  it('a lockfile with no packages map', () =>
    blocks(fixture({ lock: { lockfileVersion: 3 } }), /no "packages" map/));
  it('a lockfile whose packages is an array', () =>
    blocks(fixture({ lock: { lockfileVersion: 3, packages: [] } })));
  it('a lockfile that is not JSON', () => blocks(fixture({ raw: '{nope' }), /cannot read or parse/));
  it('a lockfile that is a JSON array', () => blocks(fixture({ raw: '[]' }), /not a JSON object/));
  it('a missing lockfile', () => blocks(fixture({ lock: null }), /cannot read or parse/));
  for (const npmrc of [
    `registry=${MIRROR}`,
    `registry=${R}`,
    '  registry = https://evil.example/',
    '"registry"=https://evil.example/',
    'Registry=https://evil.example/',
    '@aws:registry=https://evil.example/',
    'replace-registry-host=always',
    '${REG}=https://evil.example/',
    '${SCOPE}:registry=https://evil.example/',
  ]) {
    it(`.npmrc line ${JSON.stringify(npmrc)}`, () => blocks(fixture({ npmrc: `fund=false\n${npmrc}\n` }), /\.npmrc,line=2::/));
  }
});

describe('check-npm-registry: annotations', () => {
  it('escapes lockfile content so it cannot inject workflow commands', () => {
    const packages = withEntry('node_modules/x\n::warning::injected', { version: '1.0.0', resolved: 'http://e/%0A,:' });
    const { code, out } = run(fixture({ packages }));
    assert.equal(code, 1);
    assert.doesNotMatch(out, /^::warning::/m);
    assert.match(out, /x%0A::warning::injected/);
    assert.match(out, /http:\/\/e\/%250A,:/);
  });
});
