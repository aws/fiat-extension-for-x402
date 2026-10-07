// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
//
// CI check for a public repository, over every file tracked by git:
// - Every .ts/.js/.mjs/.cjs/.mts/.cts file starts with the SPDX header
//   (after an optional shebang line).
// - No file contains an internal hostname or identifier (see RULES), unless
//   .github/scripts/internal-hosts-allowlist.txt lists that exact file and
//   token. Each allowlist entry must name the PR that removes it, and an entry
//   that no longer matches anything is an error, so the list only shrinks.
//
// Plain Node, no dependencies. Needs git on PATH.
// Usage: node .github/scripts/check-oss-hygiene.mjs [repo-dir]
// Exits 1 with GitHub error annotations on any violation, and 0 otherwise.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { report } from './lib/annotations.mjs';

const HEADER = [
  '// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.',
  '// SPDX-License-Identifier: Apache-2.0',
];
const SOURCE = /\.(?:[cm]?js|[cm]?ts)$/;
const ALLOWLIST = '.github/scripts/internal-hosts-allowlist.txt';

// Each rule's match is widened to the whole host-like token around it before
// it is reported or compared with the allowlist.
const RULES = [
  ['internal Amazon host', /\b(?:[a-z0-9-]+\.)+amazon\.com\b/gi],
  ['internal Amazon email', /\b[a-z0-9._%+-]+@amazon\.com\b/gi],
  ['internal developer host', /\bamazon\.dev\b/gi],
  ['internal A-to-Z host', /\ba2z\.com\b/gi],
  ['internal AWS dev host', /\baws\.dev\b/gi],
  ['internal corp host', /\bcorp\.amazon\b/gi],
  ['internal code host', /\b(?:code|git)\.amazon\b/gi],
  ['internal Quip host', /\bquip-amazon\.com\b/gi],
  // Character classes such as [a] keep this file from matching its own rules.
  ['AWS package mirror host', /code[a]rtifact/gi],
  ['AWS package mirror account', /\b14912218321[4]\b/g],
  ['CloudFront distribution', /\b[a-z0-9]+\.cloudfront\.net\b/gi],
  ['Agent Pay stage host', /\b(?:prod|beta|gamma)\.agentpay\b/gi],
  ['JWKS WAF access key', /\bagentpay-test-[0-9]{4}\b/gi],
  ['internal tool', /\b(?:iseng[a]rd|midway-[a]uth|phonet[o]ol)\b/gi],
  ['internal code review id', /\bCR-[0-9]{8,}\b/gi],
];
// Real public AWS and Amazon addresses: these are not leaks. Add a pattern
// here when a doc legitimately links one. Each pattern is anchored on purpose:
// a bare suffix rule would also pass a fictional host such as
// "pay.aws.<amazon>.com".
const PUBLIC = [
  /^aws\.amazon\.com$/,
  /^(?:docs|signin|repost|status|health|portal|calculator|pages\.awscloud)\.aws\.amazon\.com$/,
  // console.aws.amazon.com and its regional forms, e.g. us-east-1.console...
  /^(?:[a-z0-9-]+\.)?console\.aws\.amazon\.com$/,
  /^opensource-codeofconduct@amazon\.com$/,
  /^aws-security@amazon\.com$/,
];
const isPublic = (token) => PUBLIC.some((pattern) => pattern.test(token));
// Host and address characters only. `%` and `+` are left out so a
// percent-encoded URL does not widen the token past the host.
const TOKEN_CHAR = /[A-Za-z0-9._@-]/;

const dir = process.argv[2] ?? '.';
const problems = [];

const widen = (text, start, end) => {
  while (start > 0 && TOKEN_CHAR.test(text[start - 1])) start--;
  while (end < text.length && TOKEN_CHAR.test(text[end])) end++;
  return text.slice(start, end).replace(/^[.-]+|[.-]+$/g, '');
};

// Allowlist lines: <path> <token> # <reason naming "PR <n>">
const allowed = new Map();

// ALLOWLIST line number -> the "<path> <token>" prefix length. Those two
// fields legitimately name the token they exempt; the reason text after them
// is scanned like any other file content.
const allowlistEntryPrefix = new Map();
const allowFile = join(dir, ALLOWLIST);
if (existsSync(allowFile)) {
  readFileSync(allowFile, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (/^\s*(#|$)/.test(line)) return;
      const match = /^(\S+)\s+(\S+)\s+#(.*)$/.exec(line.trim());
      const where = { file: ALLOWLIST, line: index + 1 };
      if (!match) {
        problems.push({ ...where, message: 'allowlist entry must be "<path> <token> # PR <n>: <reason>"' });
        return;
      }
      const [, path, token, comment] = match;
      allowlistEntryPrefix.set(index + 1, line.indexOf(token) + token.length);
      if (!/\bPR #?\d+\b/.test(comment)) {
        problems.push({ ...where, message: `allowlist entry for ${path} must name the PR that removes it` });
        return;
      }
      const key = `${path}\0${token.toLowerCase()}`;
      if (allowed.has(key)) {
        problems.push({ ...where, message: `duplicate allowlist entry for ${path} ${token}` });
        return;
      }
      allowed.set(key, { ...where, path, token, used: false });
    });
}

const files = execFileSync('git', ['-C', dir, 'ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

for (const file of files) {
  const path = join(dir, file);
  if (!existsSync(path)) continue; // deleted in the working tree but not yet staged
  // A tracked symlink or a submodule gitlink is not a readable regular file.
  if (!lstatSync(path).isFile()) continue;
  const buffer = readFileSync(path);
  if (buffer.includes(0)) continue; // binary
  const text = buffer.toString('utf8');
  const lines = text.split(/\r?\n/);

  if (SOURCE.test(file)) {
    const start = lines[0]?.startsWith('#!') ? 1 : 0;
    if (lines[start] !== HEADER[0] || lines[start + 1] !== HEADER[1]) {
      problems.push({
        file,
        line: start + 1,
        message: `missing SPDX header; the first lines${start ? ' after the shebang' : ''} must be:\n${HEADER.join('\n')}`,
      });
    }
  }

  lines.forEach((rawLine, index) => {
    let content = rawLine;
    // Mask the path and token fields of an allowlist entry, keeping the
    // column count so the rest of the line is still scanned.
    if (file === ALLOWLIST) {
      const prefix = allowlistEntryPrefix.get(index + 1);
      if (prefix !== undefined) content = ' '.repeat(prefix) + content.slice(prefix);
    }
    const seen = new Set();
    for (const [rule, pattern] of RULES) {
      for (const match of content.matchAll(pattern)) {
        const token = widen(content, match.index, match.index + match[0].length);
        const lower = token.toLowerCase();
        if (isPublic(lower) || seen.has(lower)) continue;
        seen.add(lower);
        const entry = allowed.get(`${file}\0${lower}`);
        if (entry) {
          entry.used = true;
          continue;
        }
        problems.push({ file, line: index + 1, message: `${rule}: ${token} must not be committed to a public repository` });
      }
    }
  });
}

for (const entry of allowed.values()) {
  if (!entry.used) {
    problems.push({
      file: entry.file,
      line: entry.line,
      message: `stale allowlist entry: ${entry.token} no longer appears in ${entry.path}; delete the entry`,
    });
  }
}

if (report(problems) > 0) {
  console.log(`${problems.length} problem(s) in ${files.length} tracked files`);
  process.exit(1);
}
console.log(
  `OK: ${files.length} tracked files; every source file has the SPDX header, and no internal host or identifier appears outside ${ALLOWLIST}`,
);
