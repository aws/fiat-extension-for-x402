// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: Apache-2.0
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/agentic-commerce/exact/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  // Both entries share one copy of each module (one chunk per format), so,
  // within one format (ESM or CJS), a class imported from a sub-path is the
  // same class as the root export and instanceof works across entry points.
  splitting: true,
  treeshake: true,
  minify: false,
});
