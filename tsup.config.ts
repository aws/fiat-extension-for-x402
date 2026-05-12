import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/client.ts',
    'src/server.ts',
    'src/facilitator.ts',
    'src/agentic-pay/client/index.ts',
    'src/agentic-pay/server/index.ts',
    'src/agentic-pay/facilitator/index.ts',
  ],
  format: ['cjs', 'esm'],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  treeshake: true,
  minify: false,
});
