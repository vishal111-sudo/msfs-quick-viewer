// Fonts are bundled because the app runs offline and its CSP only allows
// fonts from 'self'. Static packages, not the variable ones: those register
// family names ("... Variable") that the theme never asks for, so the text
// silently fell back to the system font.
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

// Sonner and Vaul would add these at runtime in a <style> element, which the
// CSP refuses. vite.config.mjs turns that off; the same CSS loads as a file.
import 'sonner/dist/styles.css';
import '../node_modules/vaul/style.css';

import './theme.css';
import './app.css';

import React from 'react';
import { createRoot } from 'react-dom/client';

import { CSPProvider } from '@base-ui/react/csp-provider';

import { App } from './components/App.jsx';

createRoot(document.getElementById('root')).render(
  // Base UI would add a small <style> element of its own, which the CSP
  // refuses. Told not to, it relies on the same rule in app.css instead.
  <CSPProvider disableStyleElements>
    <App />
  </CSPProvider>,
);
