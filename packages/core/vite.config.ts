/// <reference types="vitest/config" />
import { cpSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import pkg from './package.json' with { type: 'json' };

const external = Object.keys(pkg.dependencies);

/**
 * Publish the stylesheets as they are, in dist/styles. They keep their @imports of the font and
 * ProseMirror packages, which the application's bundler resolves (the PDF export reads the font
 * files those rules point at).
 */
const copyStyles: Plugin = {
  name: 'marginline-copy-styles',
  writeBundle() {
    cpSync(new URL('./src/styles/', import.meta.url), new URL('./dist/styles/', import.meta.url), { recursive: true });
  },
};

export default defineConfig({
  plugins: [copyStyles],
  build: {
    lib: { entry: { index: 'src/index.ts', views: 'src/views.ts' }, formats: ['es'] },
    target: 'es2020',
    sourcemap: true,
    rollupOptions: { external: (id) => external.some((d) => id === d || id.startsWith(`${d}/`)) },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
  },
});
