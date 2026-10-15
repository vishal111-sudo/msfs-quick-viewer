import '@arclux/arc-ui/base.css';

// Fonts are bundled because the app runs offline and its CSP only allows
// fonts from 'self'. Static packages, not the variable ones: those register
// family names ("... Variable") that the theme's tokens never ask for, so the
// text silently fell back to the system font.
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/600.css';
import '@fontsource/open-sans/700.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';

import './theme.css';
import './app.css';

import React from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './components/App.jsx';

createRoot(document.getElementById('root')).render(<App />);
