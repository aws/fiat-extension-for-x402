// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// Fixtures for check-oss-hygiene.mjs. Run: node --test .github/scripts/tests/*.fixtures.mjs
// (Not *.test.mjs, so vitest does not collect them.)
// Internal hosts below are built by concatenation so this file does not
// trip the check it tests.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'check-oss-hygiene.mjs');
const repoRoot = join(here, '..', '..', '..');
const HEADER = '// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.\n// SPDX-License-Identifier: Apache-2.0\n';
const ALLOWLIST = '.github/scripts/internal-hosts-allowlist.txt';
const AMZ = 'amazon';

// Escapes every RegExp metacharacter, so a path or token can be matched
// literally inside a built pattern.
const escapeRegExp = (text) => text.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const run = (dir) => {
  const result = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  return { code: result.status, out: result.stdout + result.stderr };
};

// A git repo with the given files tracked; `untracked` files are written only.
const repo = (files, untracked = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'oss-hygiene-'));
  dirs.push(dir);
  execFileSync('git', ['init', '-q', dir]);
  const write = (name, body) => {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  };
  for (const [name, body] of Object.entries(files)) write(name, body);
  if (Object.keys(files).length) execFileSync('git', ['-C', dir, 'add', '--', ...Object.keys(files)]);
  for (const [name, body] of Object.entries(untracked)) write(name, body);
  return dir;
};

const passes = (files, untracked) => {
  const { code, out } = run(repo(files, untracked));
  assert.equal(code, 0, out);
};
const fails = (files, pattern) => {
  const { code, out } = run(repo(files));
  assert.equal(code, 1, out);
  assert.match(out, /::error file=/);
  if (pattern) assert.match(out, pattern);
  return out;
};

describe('check-oss-hygiene: SPDX header', () => {
  it('passes the repository itself', () => {
    const { code, out } = run(repoRoot);
    assert.equal(code, 0, out);
  });
  it('passes headed .ts, .js, .mjs, .cjs, .mts and .cts files', () =>
    passes(Object.fromEntries(['a.ts', 'b.js', 'c.mjs', 'd.cjs', 'e.mts', 'f.cts'].map((f) => [`src/${f}`, `${HEADER}export {};\n`]))));
  it('passes a shebang followed by the header', () => passes({ 'bin/cli.mjs': `#!/usr/bin/env node\n${HEADER}` }));
  it('does not require a header in non-source files', () => passes({ 'README.md': '# hi\n', 'package.json': '{}\n' }));
  for (const name of ['src/a.ts', 'test/b.test.ts', 'examples/c.ts', 'eslint.config.js', 'x.mjs', 'y.cjs']) {
    it(`fails ${name} with no header`, () => fails({ [name]: 'export {};\n' }, new RegExp(`file=${escapeRegExp(name)},line=1::missing SPDX header`)));
  }
  it('fails a shebang with no header', () => fails({ 'bin/cli.mjs': '#!/usr/bin/env node\nexport {};\n' }, /line=2::missing SPDX header/));
  it('fails a header that is not first', () => fails({ 'a.ts': `// @ts-check\n${HEADER}` }));
  it('fails a header with only the SPDX line', () => fails({ 'a.ts': '// SPDX-License-Identifier: Apache-2.0\n' }));
  it('fails a header with another licence', () =>
    fails({ 'a.ts': HEADER.replace('Apache-2.0', 'MIT') }));
});

describe('check-oss-hygiene: internal hosts and identifiers', () => {
  const bad = [
    `https://code.${AMZ}.com/packages/X`,
    `ssh://git.${AMZ}.com/pkg/X`,
    `https://w.${AMZ}.com/bin/view/X`,
    `https://p` + `ay.aws.${AMZ}.com`,
    `someone@${AMZ}.com`,
    `https://docs.hub.${AMZ}.dev/x`,
    `https://taskei.${AMZ}.dev/tasks/P1`,
    `https://midway.a2z` + '.com/',
    'https://agentpay.marketplace.aws' + '.dev',
    `https://t.corp.${AMZ}.com/V1`,
    `npmpm.corp.${AMZ}`,
    `code.${AMZ}/x`,
    `quip-${AMZ}.com/abc`,
    'https://x.d.code' + 'artifact.us-west-2.amazonaws.com/npm/',
    'account 14912218' + '3214',
    'https://d3aeb2cjjowogc.cloud' + 'front.net',
    'https://prod' + '.agentpay.example',
    'beta' + '.agentpay',
    "'agentpay-test-" + "2026'",
    'iseng' + 'ard console',
    'CR-2930' + '43500',
    'cr-2930' + '43501',
  ];
  for (const text of bad) {
    it(`fails ${JSON.stringify(text)}`, () => fails({ 'docs/a.md': `line one\nsee ${text} here\n` }, /docs\/a\.md,line=2::/));
  }
  it('passes the public addresses used by the AWS open-source templates', () =>
    passes({
      'CONTRIBUTING.md': `https://aws.${AMZ}.com/security/ and opensource-codeofconduct@${AMZ}.com\n`,
      'SECURITY.md': `https://docs.aws.${AMZ}.com/ aws-security@${AMZ}.com\n`,
      'NOTICE': `Copyright Amazon.com, Inc. or its affiliates.\n`,
      'src/a.ts': `${HEADER}const kms = 'kms.us-east-1.amazonaws.com';\n`,
    }));
  it('fails a made-up label under console.aws.amazon.com', () =>
    fails({ 'a.md': `https://internal-tool.console.aws.${AMZ}.com/\n` }, /internal Amazon host/));
  it('passes public hosts written in capitals (tokens are compared lower-cased)', () =>
    passes({ 'a.md': `https://US-EAST-1.console.aws.${AMZ.toUpperCase()}.com/ https://Docs.aws.${AMZ}.com/\n` }));
  it('passes regional and service console URLs', () =>
    passes({ 'a.md': `https://us-east-1.console.aws.${AMZ}.com/marketplace/home https://s3.console.aws.${AMZ}.com/s3/home\n` }));
  it('passes the real public AWS hosts', () =>
    passes({ 'a.md': `https://console.aws.${AMZ}.com/marketplace https://repost.aws.${AMZ}.com\n` }));
  it('fails a host that only looks like a public AWS subdomain', () =>
    fails({ 'a.md': `https://pay.aws.${AMZ}.com\n` }, /internal Amazon host/));
  it('fails it percent-encoded too, reporting the host and not the encoding', () => {
    const out = fails({ 'a.md': `redirect=https%3A%2F%2Fpay.aws.${AMZ}.com%2Fx\n` });
    assert.doesNotMatch(out, /%252F/);
  });
  it('scans every tracked file, including the lockfile and workflows', () => {
    fails({ 'package-lock.json': `{"resolved":"https://x.d.code` + `artifact.us-west-2.amazonaws.com/a.tgz"}\n` });
    fails({ '.github/workflows/ci.yml': `env:\n  URL: https://build.${AMZ}.com\n` }, /ci\.yml,line=2/);
  });
  it('ignores a tracked symlink to a directory', () => {
    const dir = repo({ 'a.md': 'clean\n' });
    mkdirSync(join(dir, 'real'));
    writeFileSync(join(dir, 'real', 'x.md'), `code.${AMZ}.com\n`);
    symlinkSync('real', join(dir, 'link'));
    execFileSync('git', ['-C', dir, 'add', 'link']);
    const { code, out } = run(dir);
    assert.equal(code, 0, out);
  });
  it('ignores untracked and binary files', () =>
    passes({ 'bin.dat': Buffer.from([0, 1, 2, ...Buffer.from(`code.${AMZ}.com`)]) }, { 'notes.md': `code.${AMZ}.com\n` }));
  it('reports one problem per token per line', () => {
    const out = fails({ 'a.md': 'https://prod' + '.agentpay.marketplace.aws' + '.dev\n' });
    assert.equal(out.match(/::error /g).length, 1, out);
  });
});

describe('check-oss-hygiene: allowlist', () => {
  const host = `pay.aws.${AMZ}.com`;
  it('exempts the listed token in the listed file only', () => {
    passes({ 'a.md': `${host}\n${host}\n`, [ALLOWLIST]: `# header\n\na.md ${host} # PR 5: buyer side\n` });
    fails({ 'a.md': `${host}\n`, 'b.md': `${host}\n`, [ALLOWLIST]: `a.md ${host} # PR 5: x\n` }, /file=b\.md/);
  });
  it('exempts an entry whose path also contains the token', () => {
    const file = `docs/${host}-notes.md`;
    passes({ [file]: `${host}\n`, [ALLOWLIST]: `${file} ${host} # PR 5: x\n` });
  });
  it('compares tokens case-insensitively', () =>
    passes({ 'a.md': `${host.toUpperCase()}\n`, [ALLOWLIST]: `a.md ${host} # PR 5: x\n` }));
  it('does not exempt a different token in the listed file', () =>
    fails({ 'a.md': `${host}\ncode.${AMZ}.com\n`, [ALLOWLIST]: `a.md ${host} # PR 5: x\n` }, /line=2::internal Amazon host: code/));
  it('scans the reason text of an entry line', () =>
    fails({ 'a.md': `${host}\n`, [ALLOWLIST]: `a.md ${host} # PR 5: see https://code.${AMZ}.com/packages/Foo\n` }, /internal Amazon host: code/));
  it('exempts its entry lines but still scans its comments', () =>
    fails({ 'a.md': `${host}\n`, [ALLOWLIST]: `# e.g. ${host}\na.md ${host} # PR 5: x\n` }, new RegExp(`${escapeRegExp(ALLOWLIST)},line=1::`)));
  it('fails an entry that does not name a PR', () =>
    fails({ 'a.md': `${host}\n`, [ALLOWLIST]: `a.md ${host} # later\n` }, /must name the PR/));
  it('fails an entry with no comment', () =>
    fails({ 'a.md': `${host}\n`, [ALLOWLIST]: `a.md ${host}\n` }, /allowlist entry must be/));
  it('fails a stale entry', () =>
    fails({ 'a.md': 'clean\n', [ALLOWLIST]: `a.md ${host} # PR 5: x\n` }, /stale allowlist entry/));
  it('fails a duplicate entry', () =>
    fails({ 'a.md': `${host}\n`, [ALLOWLIST]: `a.md ${host} # PR 5: x\na.md ${host} # PR 6: y\n` }, /duplicate allowlist entry/));
});

describe('fixture helper: escapeRegExp', () => {
  for (const text of ['a\\b.md', 'C:\\path\\x.ts', 'a.b', 'a/b', '^$*+?()[]{}|-']) {
    it(`matches ${JSON.stringify(text)} literally and nothing else`, () => {
      const pattern = new RegExp(`^${escapeRegExp(text)}$`);
      assert.ok(pattern.test(text), `${pattern} should match ${text}`);
      assert.ok(!pattern.test(`${text}x`), `${pattern} should not match ${text}x`);
    });
  }
});

describe('check-oss-hygiene: annotations', () => {
  // A backslash is a path separator on Windows, so the file name cannot be made there.
  it('reports a tracked file whose name contains a backslash', { skip: process.platform === 'win32' }, () => {
    const name = 'dir\\x.md';
    const out = fails({ [name]: `code.${AMZ}.com\n` });
    assert.match(out, new RegExp(`file=${escapeRegExp(name)},line=1::internal Amazon host`));
  });
  it('escapes file names so they cannot inject workflow commands', () => {
    const out = fails({ 'a,b:c%.ts': 'export {};\n' });
    assert.match(out, /file=a%2Cb%3Ac%25\.ts,line=1::/);
  });
  it('escapes newlines in message text', () => {
    // The missing-header message spans three lines; unescaped, its second and
    // third lines would print as separate (and injectable) output lines.
    const out = fails({ 'a.ts': 'export {};\n' });
    assert.match(out, /must be:%0A\/\/ Copyright .*%0A\/\/ SPDX-License-Identifier/);
    assert.doesNotMatch(out, /^\/\/ /m);
  });
});
