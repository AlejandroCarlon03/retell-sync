/**
 * Left navigation rail — the bench's control panel. A nameplate at the top, the
 * indexed instrument keys (NAV destinations) in the middle, and the theme switch
 * in its own bay at the footer. Links are plain `#/path` anchors so the hash
 * router (useHashRoute) picks them up with no JS navigation handler. The active
 * item is derived from the current route and seats a scribe-red witness tick.
 */
import { visibleNav, type IconKey } from '../nav';
import { useHashRoute } from '../hooks/useHashRoute';
import { useTheme, type ThemeChoice } from '../hooks/useTheme';

const THEME_LABEL: Record<ThemeChoice, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

/**
 * Nav glyphs — one consistent stroke and weight, drawn in the bench's grammar:
 * a dial gauge, a ruled log, measured columns on a baseline, surveyed figures.
 * They inherit `currentColor`, so active/idle colouring just works.
 */
function Icon({ name }: { name: IconKey }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (name) {
    // After-Hours — the dial gauge, the surface's signature instrument.
    case 'overview':
      return (
        <svg {...common}>
          <path d="M4 16.5a8 8 0 0 1 16 0" />
          <line x1="4" y1="16.5" x2="20" y2="16.5" />
          <line x1="6.4" y1="13.4" x2="7.4" y2="13.9" />
          <line x1="16.6" y1="13.4" x2="15.6" y2="13.9" />
          <line x1="12" y1="16.5" x2="15" y2="10.9" />
          <circle cx="12" cy="16.5" r="1.15" fill="currentColor" stroke="none" />
        </svg>
      );
    // All Calls — a surveyor's ruled log: index ticks in the margin, ruled rows.
    case 'calls':
      return (
        <svg {...common}>
          <line x1="9" y1="6.5" x2="20" y2="6.5" />
          <line x1="9" y1="12" x2="20" y2="12" />
          <line x1="9" y1="17.5" x2="20" y2="17.5" />
          <line x1="4" y1="6.5" x2="6" y2="6.5" />
          <line x1="4" y1="12" x2="6" y2="12" />
          <line x1="4" y1="17.5" x2="6" y2="17.5" />
        </svg>
      );
    // Follow-ups — a surveyor's flag planted on the baseline: work still to mark off.
    case 'gaps':
      return (
        <svg {...common}>
          <line x1="6.5" y1="3.5" x2="6.5" y2="20.5" />
          <path d="M6.5 4.2h11l-2.6 3.4 2.6 3.4h-11z" />
        </svg>
      );
    // Heatmaps — a gridded plate, the instrument's shaded reading field.
    case 'heatmap':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="1.6" />
          <line x1="4" y1="9.3" x2="20" y2="9.3" />
          <line x1="4" y1="14.6" x2="20" y2="14.6" />
          <line x1="9.3" y1="4" x2="9.3" y2="20" />
          <line x1="14.6" y1="4" x2="14.6" y2="20" />
          <rect x="14.6" y="9.3" width="5.4" height="5.3" fill="currentColor" stroke="none" opacity="0.55" />
        </svg>
      );
    // Cost & Volume — measured columns dimensioned off a baseline rule.
    case 'cost':
      return (
        <svg {...common}>
          <line x1="4" y1="19.5" x2="20" y2="19.5" />
          <rect x="5.6" y="11" width="3.1" height="8.5" rx="0.6" />
          <rect x="10.45" y="6.5" width="3.1" height="13" rx="0.6" />
          <rect x="15.3" y="14" width="3.1" height="5.5" rx="0.6" />
        </svg>
      );
    // Clients — surveyed figures, crisp and single-weight.
    case 'clients':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.1" />
          <path d="M3.6 19.4a5.4 5.4 0 0 1 10.8 0" />
          <path d="M16 5.4a3.1 3.1 0 0 1 0 5.7" />
          <path d="M17.4 14.8a5.4 5.4 0 0 1 2.9 4.6" />
        </svg>
      );
    // Email Log — a sealed dispatch: an envelope with its ruled flap.
    case 'email':
      return (
        <svg {...common}>
          <rect x="3.5" y="5.5" width="17" height="13" rx="1.6" />
          <path d="M4 7l8 6 8-6" />
        </svg>
      );
    // Settings — a calibration dial: the bench's adjustable set-screw.
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.1" />
          <path d="M12 3.4v2.4M12 18.2v2.4M4.6 7.8l2.1 1.2M17.3 15l2.1 1.2M4.6 16.2l2.1-1.2M17.3 9l2.1-1.2" />
        </svg>
      );
  }
}

/** Theme-state glyph — names the current choice (system / light / dark) so the
 *  switch reads without colour. Replaces the old scribe-red dot, which competed
 *  with the active-nav witness tick for the screen's single red. */
function ThemeGlyph({ choice }: { choice: ThemeChoice }) {
  const common = {
    width: 15,
    height: 15,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (choice === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4.2" />
        <line x1="12" y1="3.2" x2="12" y2="5.4" />
        <line x1="12" y1="18.6" x2="12" y2="20.8" />
        <line x1="3.2" y1="12" x2="5.4" y2="12" />
        <line x1="18.6" y1="12" x2="20.8" y2="12" />
        <line x1="5.9" y1="5.9" x2="7.5" y2="7.5" />
        <line x1="16.5" y1="16.5" x2="18.1" y2="18.1" />
        <line x1="5.9" y1="18.1" x2="7.5" y2="16.5" />
        <line x1="16.5" y1="7.5" x2="18.1" y2="5.9" />
      </svg>
    );
  }
  if (choice === 'dark') {
    return (
      <svg {...common}>
        <path d="M20 14.2A8 8 0 1 1 9.8 4a6.4 6.4 0 0 0 10.2 10.2z" />
      </svg>
    );
  }
  // system — a half-shaded disc reading as "match the surroundings".
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 3.8a8.2 8.2 0 0 1 0 16.4z" fill="currentColor" stroke="none" />
    </svg>
  );
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
        <span className="brand-plate">
          <span className="brand-text">Retell Sync</span>
          <span className="brand-caption">Retell × Odoo</span>
        </span>
      </div>

      <nav className="sidebar-nav" aria-label="Primary">
        {visibleNav().map((item) => {
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
        <button
          type="button"
          className="btn theme-btn"
          onClick={cycle}
          aria-label={`Theme: ${THEME_LABEL[choice]}. Activate to switch.`}
        >
          <ThemeGlyph choice={choice} />
          <span className="theme-btn-key">Theme</span>
          <span className="theme-btn-value">{THEME_LABEL[choice]}</span>
        </button>
      </div>
    </aside>
  );
}
