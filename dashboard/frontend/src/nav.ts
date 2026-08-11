/**
 * The single source of truth for the sidebar destinations. `label` is the short
 * name shown in the nav; `title` is the longer heading the page renders. `icon`
 * keys into the inline SVG set in Sidebar. Order here is the order in the nav.
 */
export type IconKey =
  | 'overview'
  | 'summary'
  | 'calls'
  | 'gaps'
  | 'heatmap'
  | 'cost'
  | 'clients'
  | 'email'
  | 'settings';

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
  { path: '/', label: 'After-Hours', title: 'After-Hours Conversion', icon: 'overview' },
  { path: '/summary', label: 'Monthly Summary', title: 'Monthly Summary', icon: 'summary' },
  { path: '/all-calls', label: 'All Calls', title: 'All Calls', icon: 'calls' },
  { path: '/follow-up', label: 'Follow-ups', title: 'Follow-up Gaps', icon: 'gaps' },
  { path: '/cost-volume', label: 'Cost & Volume', title: 'Cost & Volume', icon: 'cost' },
  { path: '/heatmaps', label: 'Heatmaps', title: 'Heatmaps', icon: 'heatmap' },
  { path: '/clients', label: 'Clients', title: 'Known Clients', icon: 'clients' },
  {
    path: '/email-log',
    label: 'Email Log',
    title: 'Overdue-Lead Email Log',
    icon: 'email',
    hostOnly: true,
  },
  { path: '/settings', label: 'Settings', title: 'Settings', icon: 'settings' },
];

/** The nav items visible in the current build — drops host-only items when static. */
export function visibleNav(): NavItem[] {
  return isStatic() ? NAV.filter((n) => !n.hostOnly) : NAV;
}

/** Resolve a route path to its nav item, falling back to the first (overview). */
export function navItemFor(path: string): NavItem {
  return NAV.find((n) => n.path === path) ?? NAV[0];
}
