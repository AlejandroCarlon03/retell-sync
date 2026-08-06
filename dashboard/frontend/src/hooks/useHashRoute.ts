/**
 * Minimal hash-based router. Hash routing (no dependency, no server rewrites) is
 * the right fit for the Photino desktop host: the app is served from a file-ish
 * origin with `base: './'`, so real-path deep links would 404 on reload — a
 * `#/path` fragment never hits the server. Returns the current path (default '/').
 */
import { useSyncExternalStore } from 'react';

function currentPath(): string {
  const raw = window.location.hash.replace(/^#/, '');
  return raw.length > 0 ? raw : '/';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

/** The active route path, e.g. '/', '/all-calls'. Re-renders on hash change. */
export function useHashRoute(): string {
  // Server snapshot is '/' — jsdom/SSR has no hash; the client snapshot reads it.
  return useSyncExternalStore(subscribe, currentPath, () => '/');
}
