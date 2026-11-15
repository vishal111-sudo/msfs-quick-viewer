// Small app-wide helpers that touch the page rather than data.

import { toast as sonner } from 'sonner';

/** Raise a toast. Sonner stacks them, so several in a row stay readable. */
export function toast(message, variant) {
  if (variant === 'error') sonner.error(message);
  else sonner(message);
}

const systemLight = window.matchMedia('(prefers-color-scheme: light)');
const themeListeners = new Set();

export function resolvedTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

/**
 * Stamp the resolved theme on <html>, which is all the stylesheet needs.
 * "system" is worked out here so each palette is declared exactly once.
 */
export function applyTheme(preference) {
  const resolved = preference === 'system' ? (systemLight.matches ? 'light' : 'dark') : preference || 'dark';
  document.documentElement.dataset.theme = resolved;
  for (const listener of themeListeners) listener();
}

/** For the few components (toasts) that take the theme as a prop. */
export function subscribeTheme(listener) {
  themeListeners.add(listener);
  return () => themeListeners.delete(listener);
}

/** Follow the OS live, but only while the preference is "system". */
export function followSystemTheme(getPreference) {
  const listener = () => {
    if (getPreference() === 'system') applyTheme('system');
  };
  systemLight.addEventListener('change', listener);
  return () => systemLight.removeEventListener('change', listener);
}
