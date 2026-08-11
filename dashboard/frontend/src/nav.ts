/**
 * The single source of truth for the sidebar destinations. `label` is the short
 * name shown in the nav; `title` is the longer heading the page renders. `icon`
 * keys into the inline SVG set in Sidebar. Order here is the order in the nav.
 *
 * Destinations are split into two groups (see `NAV_GROUPS`): the read-only
 * *Analysis* surfaces that answer "does after-hours pay?" — led by the home — and
 * the *Admin* tools (the email log, settings). The split keeps the answer surfaces
 * together and out of the same list as the plumbing.
 */
export type IconKey =
  | 'overview'
  | 'calls'
  | 'gaps'
  | 'heatmap'
  | 'cost'
  | 'clients'
  | 'email'
  | 'settings';

/** The nav sections, in display order. */
export type NavGroupId = 'analysis' | 'admin';

export interface NavGroup {
  id: NavGroupId;
  /** The engraved caption shown above the group's keys (hidden in the mobile top bar). */
  label: string;
}

export const NAV_GROUPS: NavGroup[] = [
  { id: 'analysis', label: 'Analysis' },
  { id: 'admin', label: 'Admin' },
];

export interface NavItem {
  path: string;
  label: string;
  title: string;
  icon: IconKey;
  /** The section this destination belongs to (see `NAV_GROUPS`). */
  group: NavGroupId;
  /** When true, the item is hidden in the static web-viewer build (no host = no API). */
  hostOnly?: boolean;
}

/**
 * True for the read-only static viewer build (`vite build --mode static`, see
 * .env.static), which is served by plain IIS with no .NET host. `hostOnly`
 * destinations — anything that needs the `/api` layer — are hidden there. Read via
 * a function so tests can stub the env, and so the check reflects the build's mode
 * at call time.
 *
 * Settings is *not* host-only: its Appearance and Display preferences are pure
 * browser (localStorage) settings that belong in every build. The alert-delivery
 * editor inside the page is the only host-only part, and it hides itself in the
 * static build (see SettingsPage), so a salesperson still gets theme + thresholds
 * but never the recipient editor.
 */
export function isStatic(): boolean {
  return import.meta.env.VITE_STATIC === 'true';
}

export const NAV: NavItem[] = [
  // Analysis — the read-only answer surfaces; the home leads, the caller-centric
  // views sit together, then the aggregate views.
  { path: '/', label: 'After-Hours', title: 'After-Hours Conversion', icon: 'overview', group: 'analysis' },
  { path: '/all-calls', label: 'All Calls', title: 'All Calls', icon: 'calls', group: 'analysis' },
  { path: '/clients', label: 'Clients', title: 'Known Clients', icon: 'clients', group: 'analysis' },
  { path: '/follow-up', label: 'Follow-ups', title: 'Follow-up Gaps', icon: 'gaps', group: 'analysis' },
  { path: '/cost-volume', label: 'Cost & Volume', title: 'Cost & Volume', icon: 'cost', group: 'analysis' },
  { path: '/heatmaps', label: 'Heatmaps', title: 'Heatmaps', icon: 'heatmap', group: 'analysis' },
  // Admin — the tools, not the answer.
  {
    path: '/email-log',
    label: 'Email Log',
    title: 'Overdue-Lead Email Log',
    icon: 'email',
    group: 'admin',
    hostOnly: true,
  },
  { path: '/settings', label: 'Settings', title: 'Settings', icon: 'settings', group: 'admin' },
];

/** The nav items visible in the current build — drops host-only items when static. */
export function visibleNav(): NavItem[] {
  return isStatic() ? NAV.filter((n) => !n.hostOnly) : NAV;
}

/** A nav group paired with the items visible in it for the current build. */
export interface VisibleNavGroup extends NavGroup {
  items: NavItem[];
}

/**
 * The visible destinations grouped for rendering: each group in `NAV_GROUPS` order,
 * carrying only its currently-visible items, with empty groups dropped (so the
 * static build never renders an Admin heading over nothing).
 */
export function visibleNavGroups(): VisibleNavGroup[] {
  const visible = visibleNav();
  return NAV_GROUPS.map((g) => ({
    ...g,
    items: visible.filter((n) => n.group === g.id),
  })).filter((g) => g.items.length > 0);
}

/** Resolve a route path to its nav item, falling back to the first (overview). */
export function navItemFor(path: string): NavItem {
  return NAV.find((n) => n.path === path) ?? NAV[0];
}
