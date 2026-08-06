/**
 * Left navigation rail. Brand at the top, the NAV destinations in the middle, and
 * the theme toggle pinned to the footer. Links are plain `#/path` anchors so the
 * hash router (useHashRoute) picks them up with no JS navigation handler. The
 * active item is derived from the current route.
 */
import { NAV, type IconKey } from '../nav';
import { useHashRoute } from '../hooks/useHashRoute';
import { useTheme, type ThemeChoice } from '../hooks/useTheme';

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/** Compact stroke icons — inherit `currentColor` so active/idle states just work. */
function Icon({ name }: { name: IconKey }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    case 'overview':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="9" rx="1.5" />
          <rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" />
          <rect x="3" y="16" width="7" height="5" rx="1.5" />
        </svg>
      );
    case 'calls':
      return (
        <svg {...common}>
          <line x1="8" y1="6" x2="21" y2="6" />
          <line x1="8" y1="12" x2="21" y2="12" />
          <line x1="8" y1="18" x2="21" y2="18" />
          <circle cx="3.5" cy="6" r="1" />
          <circle cx="3.5" cy="12" r="1" />
          <circle cx="3.5" cy="18" r="1" />
        </svg>
      );
    case 'cost':
      return (
        <svg {...common}>
          <line x1="4" y1="20" x2="20" y2="20" />
          <rect x="5" y="11" width="3.5" height="6" rx="1" />
          <rect x="10.25" y="7" width="3.5" height="10" rx="1" />
          <rect x="15.5" y="13" width="3.5" height="4" rx="1" />
        </svg>
      );
    case 'clients':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
          <path d="M16 5.2a3.2 3.2 0 0 1 0 5.9" />
          <path d="M17.5 14.6A5.5 5.5 0 0 1 20.5 20" />
        </svg>
      );
  }
}

export function Sidebar() {
  const route = useHashRoute();
  const { choice, cycle } = useTheme();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark" aria-hidden>
          R
        </span>
        <span className="brand-text">Retell Sync</span>
      </div>

      <nav className="sidebar-nav" aria-label="Primary">
        {NAV.map((item) => {
          const active = item.path === route || (item.path === '/' && route === '/');
          return (
            <a
              key={item.path}
              href={`#${item.path}`}
              className={`nav-link${active ? ' active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <button type="button" className="btn theme-btn" onClick={cycle}>
          <span className="theme-dot" aria-hidden />
          Theme: {THEME_LABEL[choice]}
        </button>
      </div>
    </aside>
  );
}
