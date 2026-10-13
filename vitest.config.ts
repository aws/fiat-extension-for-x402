// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // The examples import the package by name, as a seller would; the smoke
    // test runs them against the source.
    alias: [
      {
        find: /^@aws\/fiat-extension-for-x402$/,
        replacement: fileURLToPath(new URL('./src/index.ts', import.meta.url)),
      },
      {
        find: /^@aws\/fiat-extension-for-x402\/agentic-commerce\/exact$/,
        replacement: fileURLToPath(
          new URL('./src/agentic-commerce/exact/index.ts', import.meta.url)
        ),
      },
    ],
  },
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      exclude: [
        'node_modules/',
        'dist/',
        'test/',
        'examples/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/index.ts',
      ],
      // Coverage thresholds: never lower them. Vitest 4's AST-aware
      // remapping also counts branches in files that no test loads, which
      // briefly put branches at 74.6% (the gate was 74). With the signer
      // tests the branch gate is back at 75.
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 75,
        statements: 70,
      },
      // Include all source files even if not imported in tests.
      // Vitest 4 removed `coverage.all`; setting `include` reports both
      // covered and uncovered files matching the pattern.
      include: ['src/**/*.ts'],
    },
  },
});
