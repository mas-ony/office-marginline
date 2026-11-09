import { collabRelay } from '@marginline/relay';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { assetLicenses } from '../web-shared/vite/assetLicenses';

export default defineConfig({
  plugins: [vue(), collabRelay(), assetLicenses()],
  base: './',
  // The icons, manifest, service worker and examples, shared with the React app.
  publicDir: '../web-shared/public',
  build: {
    target: 'es2020',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    license: { fileName: 'THIRD-PARTY-LICENSES.md' },
  },
  server: { host: true, port: 5181 },
  preview: { host: true, port: 4181 },
});
