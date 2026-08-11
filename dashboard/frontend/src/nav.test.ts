/**
 * Nav visibility. Settings is now available in every build — its Appearance and
 * Display preferences are pure browser settings — so it appears in the static
 * viewer too (the host-only alert editor inside the page hides itself there).
 * `visibleNav` still drops any item flagged `hostOnly` when the build is static.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NAV, NAV_GROUPS, visibleNav, visibleNavGroups } from './nav';

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

describe('visibleNavGroups', () => {
  it('every destination is assigned to a declared group', () => {
    const ids = new Set(NAV_GROUPS.map((g) => g.id));
    expect(NAV.every((n) => ids.has(n.group))).toBe(true);
  });

  it('returns the groups in NAV_GROUPS order with the home leading Analysis', () => {
    vi.stubEnv('VITE_STATIC', '');
    const groups = visibleNavGroups();
    expect(groups.map((g) => g.id)).toEqual(['analysis', 'admin']);
    expect(groups[0].items[0].path).toBe('/');
    expect(groups[1].items.map((n) => n.path)).toContain('/settings');
  });

  it('drops a group that has no visible items in the static build (Admin keeps Settings)', () => {
    vi.stubEnv('VITE_STATIC', 'true');
    const groups = visibleNavGroups();
    // Admin survives on Settings alone; its host-only Email Log is gone.
    const admin = groups.find((g) => g.id === 'admin');
    expect(admin?.items.map((n) => n.path)).toEqual(['/settings']);
    expect(groups.flatMap((g) => g.items).map((n) => n.path)).not.toContain('/email-log');
  });

  it('never emits an empty group', () => {
    vi.stubEnv('VITE_STATIC', 'true');
    expect(visibleNavGroups().every((g) => g.items.length > 0)).toBe(true);
  });
});
