/**
 * Nav visibility. Settings is now available in every build — its Appearance and
 * Display preferences are pure browser settings — so it appears in the static
 * viewer too (the host-only alert editor inside the page hides itself there).
 * `visibleNav` still drops any item flagged `hostOnly` when the build is static.
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

  it('still includes Settings in the static build (prefs work without a host)', () => {
    vi.stubEnv('VITE_STATIC', 'true');
    const paths = visibleNav().map((n) => n.path);
    expect(paths).toContain('/settings');
    // The read-only report pages are present too.
    expect(paths).toContain('/');
    expect(paths).toContain('/all-calls');
  });

  it('drops any hostOnly item in the static build', () => {
    vi.stubEnv('VITE_STATIC', 'true');
    const visible = visibleNav();
    expect(visible.every((n) => !n.hostOnly)).toBe(true);
  });

  it('Settings is no longer marked hostOnly', () => {
    const settings = NAV.find((n) => n.path === '/settings');
    expect(settings?.hostOnly).toBeFalsy();
  });

  it('Email Log is host-only: present in the host build, hidden in the static viewer', () => {
    vi.stubEnv('VITE_STATIC', '');
    expect(visibleNav().map((n) => n.path)).toContain('/email-log');

    vi.stubEnv('VITE_STATIC', 'true');
    expect(visibleNav().map((n) => n.path)).not.toContain('/email-log');
  });
});
