/**
 * SegmentedControl — the dashboard's one segmented filter, so All Calls, Follow-up
 * Gaps, Heatmaps, and Settings all speak the same control instead of three
 * different (and incomplete) ARIA stories.
 *
 * Pattern: WAI-ARIA **toolbar** of toggle buttons. Each key is a `<button>` with
 * `aria-pressed` (exactly one pressed — these are single-select filters, but the
 * keys are honest toggle buttons, not radios or tabs, since there is no separate
 * tabpanel to own). Keyboard follows the toolbar spec: a single roving tabstop
 * (only the pressed key is Tab-reachable), then ArrowLeft/Right (and Up/Down)
 * move focus between keys, Home/End jump to the ends, and Enter/Space — native to
 * `<button>` — activate the focused key. `aria-orientation` is declared explicitly.
 */
import { useEffect, useRef, useState } from 'react';

import { formatCount } from '../lib/format';

export interface SegOption<T extends string> {
  key: T;
  label: string;
  /** Optional live tally rendered as a scribed figure beside the label. */
  count?: number;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: readonly SegOption<T>[];
  value: T;
  onChange: (key: T) => void;
  ariaLabel: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const selectedIdx = Math.max(
    0,
    options.findIndex((o) => o.key === value),
  );
  // The roving tabstop. Sits on the selected key, but arrow keys can move focus
  // to another key without yet activating it (toolbar semantics).
  const [focusIdx, setFocusIdx] = useState(selectedIdx);

  // Keep the tabstop anchored to the selection when it changes from elsewhere
  // (e.g. an external state reset), so Tab always lands on the active key.
  useEffect(() => {
    setFocusIdx(selectedIdx);
  }, [selectedIdx]);

  const moveFocus = (to: number) => {
    const n = options.length;
    const next = ((to % n) + n) % n;
    setFocusIdx(next);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        moveFocus(i + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        moveFocus(i - 1);
        break;
      case 'Home':
        e.preventDefault();
        moveFocus(0);
        break;
      case 'End':
        e.preventDefault();
        moveFocus(options.length - 1);
        break;
      default:
        break;
    }
  };

  return (
    <div className="segmented" role="toolbar" aria-label={ariaLabel} aria-orientation="horizontal">
      {options.map((o, i) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            aria-pressed={active}
            tabIndex={i === focusIdx ? 0 : -1}
            className={`seg${active ? ' active' : ''}`}
            onClick={() => onChange(o.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
          >
            {o.label}
            {o.count !== undefined && <span className="seg-count">{formatCount(o.count)}</span>}
          </button>
        );
      })}
    </div>
  );
}
