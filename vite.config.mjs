import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The React renderer lives in ui/ and builds into src/renderer/, which
// is what Electron loads and what electron-builder packages. React, Lit and
// ARC UI are bundled here, so none of them ship as loose node_modules.
export default defineConfig({
  root: 'ui',
  // Electron loads the page from file://, so asset URLs must be relative.
  base: './',
  plugins: [react()],
  build: {
    outDir: '../src/renderer',
    emptyOutDir: true,
    // Electron 44's Chromium; no need to transpile for anything older.
    target: 'chrome140',
    // Never inline assets as data: URLs. The CSP allows fonts from 'self'
    // only, and refused the small font files Vite inlined by default.
    // Relaxing the CSP to allow data: would be the wrong fix.
    assetsInlineLimit: 0,
  },
});
