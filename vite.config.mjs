import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { buildStyles } from 'number-flow/csp';

const here = path.dirname(fileURLToPath(import.meta.url));

// Runtime <style> injection to switch off, by the file that does it.
const INJECTORS = [
  { file: 'node_modules/sonner/dist/index.mjs', marker: 'function __insertCSS(code) {', stop: 'return;' },
  { file: 'node_modules/vaul/dist/index.mjs', marker: 'function __insertCSS(code) {', stop: 'return;' },
  { file: 'node_modules/react-style-singleton/dist/es2015/singleton.js', marker: 'function makeStyleTag() {', stop: 'return null;' },
];

/**
 * The page's CSP allows stylesheets from 'self' only, and several libraries
 * want to add a <style> element at runtime. Rather than loosen the policy:
 *
 * - Sonner and Vaul each ship the same CSS as a file. Their runtime injection
 *   is switched off here and the file is imported in ui/main.jsx instead.
 * - Vaul's dialog locks page scrolling with an injected rule. The page never
 *   scrolls (body is overflow: hidden in app.css), so that is switched off.
 * - NumberFlow styles its shadow root, which a file cannot reach. It
 *   publishes the exact strings for this purpose, so their hashes are added
 *   to the policy. Nothing else inline is allowed.
 *
 * Base UI is told the same thing through its own CSPProvider (ui/main.jsx).
 * The smoke test fails on any CSP error, so a library update that starts
 * injecting again is caught there.
 */
function cspSafeStyles() {
  const hashes = buildStyles('-react').map(
    (css) => `'sha256-${createHash('sha256').update(css).digest('base64')}'`,
  );
  return {
    name: 'csp-safe-styles',
    enforce: 'pre',
    transform(code, id) {
      const file = id.split('?')[0].replaceAll('\\', '/');
      // Vaul 1.1.2 ships one malformed selector. A browser skips it; the CSS
      // minifier refuses the whole file.
      if (file.endsWith('node_modules/vaul/style.css')) {
        return { code: code.replace('[data-vaul-handle-hitarea]: {', '[data-vaul-handle-hitarea] {'), map: null };
      }
      const injector = INJECTORS.find((entry) => file.endsWith(entry.file));
      if (!injector) return null;
      const { marker, stop } = injector;
      if (!code.includes(marker)) this.error(`${id}: style injection not found; the CSP workaround needs updating`);
      return { code: code.replace(marker, `${marker}\n  ${stop}`), map: null };
    },
    transformIndexHtml(html) {
      const marker = "style-src 'self'";
      if (!html.includes(marker)) this.error('index.html: style-src not found');
      return html.replace(marker, `${marker} ${hashes.join(' ')}`);
    },
  };
}

// The React renderer lives in ui/ and builds into src/renderer/, which is
// what Electron loads and what electron-builder packages. React and every UI
// library are bundled here, so none of them ship as loose node_modules.
export default defineConfig({
  root: 'ui',
  // Electron loads the page from file://, so asset URLs must be relative.
  base: './',
  plugins: [cspSafeStyles(), react(), tailwindcss()],
  resolve: {
    alias: { '@': path.join(here, 'ui') },
  },
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
