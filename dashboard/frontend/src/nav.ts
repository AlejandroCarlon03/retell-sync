/**
 * The single source of truth for the sidebar destinations. `label` is the short
 * name shown in the nav; `title` is the longer heading the page renders. `icon`
 * keys into the inline SVG set in Sidebar. Order here is the order in the nav.
 */
export type IconKey = 'overview' | 'calls' | 'cost' | 'clients';

export interface NavItem {
  path: string;
  label: string;
  title: string;
  icon: IconKey;
}

export const NAV: NavItem[] = [
  { path: '/', label: 'After-Hours', title: 'After-Hours Conversion', icon: 'overview' },
  { path: '/all-calls', label: 'All Calls', title: 'All Calls', icon: 'calls' },
  { path: '/cost-volume', label: 'Cost & Volume', title: 'Cost & Volume', icon: 'cost' },
  { path: '/clients', label: 'Clients', title: 'Known Clients', icon: 'clients' },
];

/** Resolve a route path to its nav item, falling back to the first (overview). */
export function navItemFor(path: string): NavItem {
  return NAV.find((n) => n.path === path) ?? NAV[0];
}
