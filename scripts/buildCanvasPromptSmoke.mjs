import { build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
await build({ configFile: false, root: path.resolve('__tests__/fixtures/canvas-prompt-ui'), publicDir: false, base: './', plugins: [react()], css: { postcss: path.resolve('postcss.config.cjs') }, worker: { format: 'es' }, build: { outDir: path.resolve('dist/canvas-prompt-smoke'), emptyOutDir: true } });
