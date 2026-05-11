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
      // Coverage thresholds - set to current levels, improve over time
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 75,
        statements: 70,
      },
      // Include all source files even if not imported in tests
      all: true,
      include: ['src/**/*.ts'],
    },
  },
});
