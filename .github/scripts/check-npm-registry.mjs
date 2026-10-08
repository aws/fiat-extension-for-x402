// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// CI guard: every install must come from the public npm registry.
// - package-lock.json must be lockfileVersion 2 or 3 with a "packages" map,
//   and there must be no npm-shrinkwrap.json (npm ci would install from it).
// - Every non-root entry that npm downloads must have:
//   - a `resolved` URL on https://registry.npmjs.org/ that is exactly the
//     registry tarball for that entry's own name and version, so a lockfile
//     entry cannot point at another package's tarball;
//   - an `integrity` hash, so npm ci verifies what it downloads.
//   Links are not downloaded. A bundled entry is skipped only when a checked
//   ancestor in the lockfile ships it in its own tarball.
// - An entry's `name` field (an npm: alias) must be a string, and must be
//   declared as an alias by a package that npm would resolve to that entry.
// - A committed .npmrc must not set `registry`, a scoped `@scope:registry` or
//   `replace-registry-host`, or use an environment-expanded key: npm would
//   otherwise rewrite registry.npmjs.org URLs to another host during npm ci.
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

// npm ci installs from npm-shrinkwrap.json when it exists, ignoring
// package-lock.json, so a shrinkwrap would bypass every check below.
if (existsSync(join(dir, 'npm-shrinkwrap.json'))) {
  problems.push({
    file: shown('npm-shrinkwrap.json'),
    message: 'npm-shrinkwrap.json takes precedence over package-lock.json in npm ci and is not checked; remove it',
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
    const NM = 'node_modules/';
    // "node_modules/a/node_modules/b" -> installed name "b", parent location
    // "node_modules/a"; a top-level entry's parent is the root, "".
    const locate = (path) => {
      const marker = path.lastIndexOf(NM);
      if (marker < 0) return { installed: '', parent: '' };
      return { installed: path.slice(marker + NM.length), parent: path.slice(0, marker).replace(/\/$/, '') };
    };
    const DEPENDENCY_FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
    // True when some package outside `path`'s own subtree declares
    // "<installed>": "npm:<realName>@..." and npm would resolve that dependency
    // to `path`: the declarer sits at the parent location or below it (npm
    // resolves a dependency by walking up from the declarer). This catches an
    // entry relabelled by hand; it cannot prove a lockfile was not forged as a
    // whole, since the declarer's dependency map is lockfile content too. What
    // it guarantees either way is the rest of this script's contract: every
    // tarball is a real registry.npmjs.org tarball with an integrity hash.
    const aliasDeclared = (path, installed, parent, realName) =>
      Object.entries(lock.packages).some(([declarer, declaring]) => {
        // Neither the entry nor anything installed under it can vouch for it.
        if (declarer === path || declarer.startsWith(`${path}/`) || !isObject(declaring)) return false;
        const inScope = parent === '' || declarer === parent || declarer.startsWith(`${parent}/`);
        if (!inScope) return false;
        return DEPENDENCY_FIELDS.some((field) => {
          const spec = isObject(declaring[field]) ? declaring[field][installed] : undefined;
          const alias = /^npm:((?:@[^/@]+\/)?[^@]+)(?:@|$)/.exec(String(spec ?? ''));
          return alias !== null && alias[1] === realName;
        });
      });
    // The names a bundling package ships inside its own tarball: its
    // bundleDependencies (every dependency when it is `true`), plus everything
    // those reach through the dependency maps of the entries installed under
    // it, because npm flattens a bundled package's own dependencies into the
    // bundler's node_modules.
    const bundledNames = new Map();
    const bundledUnder = (bundler, entry) => {
      if (bundledNames.has(bundler)) return bundledNames.get(bundler);
      const list = entry.bundleDependencies ?? entry.bundledDependencies;
      const names = new Set();
      const queue =
        list === true
          ? Object.keys(isObject(entry.dependencies) ? entry.dependencies : {})
          : Array.isArray(list) ? list.filter((n) => typeof n === 'string') : [];
      while (queue.length > 0) {
        const name = queue.shift();
        if (names.has(name)) continue;
        names.add(name);
        const installedAt = lock.packages[`${bundler}/${NM}${name}`];
        if (isObject(installedAt) && isObject(installedAt.dependencies)) {
          queue.push(...Object.keys(installedAt.dependencies));
        }
      }
      bundledNames.set(bundler, names);
      return names;
    };
    // True when the nearest ancestor location (not the root) that is not
    // itself bundled exists and ships this entry in its tarball (see
    // bundledUnder). That ancestor's tarball, which is checked, is where a
    // bundled entry comes from.
    const hasBundlingAncestor = (path) => {
      let { parent } = locate(path);
      while (parent !== '') {
        const ancestor = lock.packages[parent];
        if (isObject(ancestor) && !ancestor.inBundle) {
          const below = path.slice(parent.length + 1 + NM.length).split(`/${NM}`)[0];
          return bundledUnder(parent, ancestor).has(below);
        }
        parent = locate(parent).parent;
      }
      return false;
    };
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (path === '') continue;
      if (!isObject(entry)) {
        problems.push({ file: lockFile, message: `${path} is not an object` });
        continue;
      }
      // Links are not downloaded, and a bundled dependency arrives inside a
      // checked ancestor's tarball, so neither has a resolved URL or an
      // integrity hash of its own. `inBundle` is honoured only when such a
      // bundling ancestor is present in the lockfile: npm downloads any other
      // entry from its resolved URL even when it carries the flag.
      if (entry.link || (entry.inBundle && hasBundlingAncestor(path))) continue;
      // Any other inBundle entry (e.g. one the root project bundles) is checked
      // as a normal download; the note explains a failure if it has no URL.
      const bundleNote = entry.inBundle
        ? ' (it is flagged inBundle, but no non-bundled ancestor in the lockfile bundles it, so npm downloads it)'
        : '';
      const { resolved, integrity, version } = entry;
      const { installed, parent } = locate(path);
      if (typeof resolved !== 'string' || !resolved.startsWith(PREFIX)) {
        problems.push({
          file: lockFile,
          message: `${path} resolves to ${resolved ?? '(no resolved URL)'}, not ${PREFIX}${bundleNote}`,
        });
      } else if (entry.name !== undefined && typeof entry.name !== 'string') {
        problems.push({ file: lockFile, message: `${path} has a name field that is not a string` });
      } else {
        // An npm alias records the real name in `name`; see aliasDeclared.
        if (entry.name !== undefined && entry.name !== installed && !aliasDeclared(path, installed, parent, entry.name)) {
          problems.push({
            file: lockFile,
            message: `${path} claims the name ${entry.name}, but no package that resolves to it declares an npm: alias`,
          });
        }
        const name = entry.name ?? installed;
        const expected = name ? expectedTarball(name, version) : '(no package name)';
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
