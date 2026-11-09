import { collabRelay } from '@marginline/relay';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { assetLicenses } from '../web-shared/vite/assetLicenses';

export default defineConfig({
  // collabRelay serves real-time collaboration (Share) from `vite` and `vite preview`.
  plugins: [react(), collabRelay(), assetLicenses()],
  base: './',
  // The icons, manifest, service worker and examples, shared with the Vue app.
  publicDir: '../web-shared/public',
  build: {
    target: 'es2020',
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    // The licences of the bundled packages, icons and fonts, shipped with the built app.
    license: { fileName: 'THIRD-PARTY-LICENSES.md' },
  },
  // Listen on every interface so phones on the LAN can open the dev server.
  server: { host: true, port: 5177 },
  preview: { host: true, port: 4177 },
});
