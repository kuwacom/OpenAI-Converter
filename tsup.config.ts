import { defineConfig } from 'tsup';

export default defineConfig({
  clean: true,
  entry: ['src/node.ts'],
  format: ['esm'],
  outDir: 'dist',
  platform: 'node',
  sourcemap: true,
  splitting: false,
  target: 'node22',
});
