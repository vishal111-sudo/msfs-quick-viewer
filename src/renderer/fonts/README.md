# Bundled typefaces

IBM Plex Sans (400/500/600) and IBM Plex Mono (400/500), latin subset, woff2.

Bundled rather than loaded from a CDN because the app runs offline and its
Content-Security-Policy allows `font-src 'self'` only. Roughly 104 KB total.

Licensed under the SIL Open Font License 1.1 — see `LICENSE.txt`. Files are the
unmodified `@fontsource/ibm-plex-sans` and `@fontsource/ibm-plex-mono` builds.
