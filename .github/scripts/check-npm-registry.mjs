// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// CI guard: every install must come from the public npm registry.
// - package-lock.json must be lockfileVersion 2 or 3 with a "packages" map.
// - Every non-root entry that is not a link must have:
//   - a `resolved` URL on https://registry.npmjs.org/ that is exactly the
//     registry tarball for that entry's own name and version, so a lockfile
//     entry cannot point at another package's tarball;
//   - an `integrity` hash, so npm ci verifies what it downloads.
// - A committed .npmrc must not set `registry`, a scoped `@scope:registry` or
//   `replace-registry-host`: npm would otherwise rewrite registry.npmjs.org
//   URLs to that host during npm ci.
//
// Plain Node, no dependencies, so it runs before `npm ci`.
// Usage: node .github/scripts/check-npm-registry.mjs [project-dir]
// Exits 1 with GitHub error annotations on any violation, and 0 otherwise.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { report } from './lib/annotations.mjs';

const PREFIX = 'https://registry.npmjs.org/';
const dir = process.argv[2] ?? '.';
const problems = [];

// Annotation paths are relative to the working directory (the repo root in CI).
const shown = (file) => relative(process.cwd(), join(dir, file)) || file;
// npm's ini parser drops surrounding quotes from keys.
const unquote = (text) => text.trim().replace(/^(["'])(.*)\1$/, '$2');
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// The tarball URL npm records for `name@version` on the public registry.
// Scoped names keep the scope in the path but not in the file name:
// @scope/pkg -> https://registry.npmjs.org/@scope/pkg/-/pkg-1.0.0.tgz
const expectedTarball = (name, version) =>
  `${PREFIX}${name}/-/${name.split('/').pop()}-${version}.tgz`;

const npmrcPath = join(dir, '.npmrc');
if (existsSync(npmrcPath)) {
  readFileSync(npmrcPath, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const text = line.trim();
      if (text === '' || text.startsWith('#') || text.startsWith(';') || !text.includes('=')) return;
      const key = unquote(text.slice(0, text.indexOf('='))).toLowerCase();
      // npm expands ${VAR} in .npmrc, so an indirect key could set the registry
      // at install time. Reject those outright rather than guess the value.
      if (key.includes('${')) {
        problems.push({
          file: shown('.npmrc'),
          line: index + 1,
          message: `.npmrc key ${key} is environment-expanded, so it could set the registry at install time`,
        });
      } else if (key === 'registry' || key === 'replace-registry-host' || /^@[^:=]+:registry$/.test(key)) {
        problems.push({
          file: shown('.npmrc'),
          line: index + 1,
          message: `.npmrc must not set ${key} (registry, a scoped registry or replace-registry-host)`,
        });
      }
    });
}

const lockFile = shown('package-lock.json');
let lock;
try {
  lock = JSON.parse(readFileSync(join(dir, 'package-lock.json'), 'utf8'));
  if (!isObject(lock)) throw new Error('top level is not a JSON object');
} catch (error) {
  problems.push({ file: lockFile, message: `cannot read or parse: ${error.message}` });
  lock = undefined;
}

if (lock) {
  if (!(lock.lockfileVersion >= 2) || !isObject(lock.packages)) {
    problems.push({
      file: lockFile,
      message: `lockfileVersion ${lock.lockfileVersion} has no "packages" map (lockfileVersion 2 or 3 required)`,
    });
  } else {
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (path === '') continue;
      if (!isObject(entry)) {
        problems.push({ file: lockFile, message: `${path} is not an object` });
        continue;
      }
      // Links are not downloaded, and bundled dependencies arrive inside their
      // parent's tarball, which is itself checked, so neither has a resolved
      // URL or an integrity hash of its own.
      if (entry.link || entry.inBundle) continue;
      const { resolved, integrity, version } = entry;
      if (typeof resolved !== 'string' || !resolved.startsWith(PREFIX)) {
        problems.push({
          file: lockFile,
          message: `${path} resolves to ${resolved ?? '(no resolved URL)'}, not ${PREFIX}`,
        });
      } else {
        // An npm alias (e.g. "x-cjs": "npm:x@4") records the real name in `name`.
        const marker = path.lastIndexOf('node_modules/');
        const name = entry.name ?? (marker >= 0 ? path.slice(marker + 'node_modules/'.length) : '');
        const expected = expectedTarball(name, version);
        if (!name || typeof version !== 'string' || resolved !== expected) {
          problems.push({
            file: lockFile,
            message: `${path} resolves to ${resolved}, but its name and version give ${expected}`,
          });
        }
      }
      if (typeof integrity !== 'string' || integrity === '') {
        problems.push({
          file: lockFile,
          message: `${path} has no integrity hash, so npm ci cannot verify the download`,
        });
      }
    }
  }
}

if (report(problems) > 0) {
  console.log(`${problems.length} registry problem(s); every install must come from ${PREFIX}`);
  process.exit(1);
}
console.log(
  `OK: every lockfile entry is the ${PREFIX} tarball for its own name and version, with an integrity hash, and .npmrc does not redirect the registry`,
);
