/**
 * Nav visibility: the Settings destination is host-only and must disappear from
 * the read-only static viewer build (VITE_STATIC=true), so a salesperson viewing
 * the static export never reaches the recipient editor.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NAV, visibleNav } from './nav';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('visibleNav', () => {
  it('includes Settings in the normal (host) build', () => {
    vi.stubEnv('VITE_STATIC', '');
    const paths = visibleNav().map((n) => n.path);
    expect(paths).toContain('/settings');
  });

  it('hides host-only Settings in the static build', () => {
    vi.stubEnv('VITE_STATIC', 'true');
    const paths = visibleNav().map((n) => n.path);
    expect(paths).not.toContain('/settings');
    // The read-only report pages are still present.
    expect(paths).toContain('/');
    expect(paths).toContain('/all-calls');
  });

  it('marks Settings as hostOnly in the canonical NAV', () => {
    const settings = NAV.find((n) => n.path === '/settings');
    expect(settings?.hostOnly).toBe(true);
  });
});
