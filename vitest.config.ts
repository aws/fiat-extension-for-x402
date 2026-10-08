// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'vitest/config';

export default defineConfig({
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
      // Coverage thresholds - set to current levels, improve over time.
      // Vitest 4 replaced v8-to-istanbul with AST-aware remapping, which
      // counts branches in files that are never loaded by a test (for
      // example src/signers/kms.ts, previously reported as 0/0 and
      // so as 100%). Measured branch coverage is therefore 74.6% where the
      // old, less accurate instrumentation reported 83.88%; the tests
      // themselves are unchanged.
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 74,
        statements: 70,
      },
      // Include all source files even if not imported in tests.
      // Vitest 4 removed `coverage.all`; setting `include` reports both
      // covered and uncovered files matching the pattern.
      include: ['src/**/*.ts'],
    },
  },
});
