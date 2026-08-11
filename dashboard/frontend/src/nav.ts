/**
 * The single source of truth for the sidebar destinations. `label` is the short
 * name shown in the nav; `title` is the longer heading the page renders. `icon`
 * keys into the inline SVG set in Sidebar. Order here is the order in the nav.
 */
export type IconKey = 'overview' | 'calls' | 'cost' | 'clients' | 'settings';

export interface NavItem {
  path: string;
  label: string;
  title: string;
  icon: IconKey;
  /** When true, the item is hidden in the static web-viewer build (no host = no API). */
  hostOnly?: boolean;
}

/**
 * True for the read-only static viewer build (`vite build --mode static`, see
 * .env.static), which is served by plain IIS with no .NET host. `hostOnly`
 * destinations — anything that needs the `/api` layer, i.e. Settings — are hidden
 * there, so a salesperson never sees the recipient editor. Read via a function so
 * tests can stub the env, and so the check reflects the build's mode at call time.
 */
export function isStatic(): boolean {
  return import.meta.env.VITE_STATIC === 'true';
}

export const NAV: NavItem[] = [
  { path: '/', label: 'After-Hours', title: 'After-Hours Conversion', icon: 'overview' },
  { path: '/all-calls', label: 'All Calls', title: 'All Calls', icon: 'calls' },
  { path: '/cost-volume', label: 'Cost & Volume', title: 'Cost & Volume', icon: 'cost' },
  { path: '/clients', label: 'Clients', title: 'Known Clients', icon: 'clients' },
  { path: '/settings', label: 'Settings', title: 'Alert Settings', icon: 'settings', hostOnly: true },
];

/** The nav items visible in the current build — drops host-only items when static. */
export function visibleNav(): NavItem[] {
  return isStatic() ? NAV.filter((n) => !n.hostOnly) : NAV;
}

/** Resolve a route path to its nav item, falling back to the first (overview). */
export function navItemFor(path: string): NavItem {
  return NAV.find((n) => n.path === path) ?? NAV[0];
}
