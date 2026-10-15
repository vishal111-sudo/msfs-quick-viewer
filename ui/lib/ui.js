// Small app-wide helpers that touch the page rather than data.

let toastElement = null;

/** Called once with the <Toast> element, so anything can raise a toast. */
export function bindToast(element) {
  toastElement = element;
}

export function toast(message, variant) {
  if (toastElement && toastElement.show) toastElement.show({ message, ...(variant ? { variant } : {}) });
}

const systemLight = window.matchMedia('(prefers-color-scheme: light)');

/**
 * Stamp the resolved theme on <html>, which is all ARC needs. "system" is
 * worked out here so the stylesheet declares each palette exactly once.
 */
export function applyTheme(preference) {
  const resolved = preference === 'system' ? (systemLight.matches ? 'light' : 'dark') : preference || 'dark';
  document.documentElement.dataset.theme = resolved;
}

/** Follow the OS live, but only while the preference is "system". */
export function followSystemTheme(getPreference) {
  const listener = () => {
    if (getPreference() === 'system') applyTheme('system');
  };
  systemLight.addEventListener('change', listener);
  return () => systemLight.removeEventListener('change', listener);
}

/** The text input inside an ARC search or input element. */
export function innerInput(host) {
  return host && host.shadowRoot ? host.shadowRoot.querySelector('input') : null;
}
