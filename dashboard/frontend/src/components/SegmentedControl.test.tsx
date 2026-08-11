/**
 * SegmentedControl — the toolbar-pattern segmented filter. These cover the ARIA
 * shape (toolbar + aria-pressed + orientation) and, above all, the keyboard
 * contract: a single roving tabstop, arrow/Home/End focus movement, and
 * Enter/Space activation. That keyboard behaviour is the whole reason the control
 * was consolidated, so it is what we guard.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SegmentedControl, type SegOption } from './SegmentedControl';

type Key = 'all' | 'matched' | 'unmatched';
const OPTIONS: SegOption<Key>[] = [
  { key: 'all', label: 'All', count: 154 },
  { key: 'matched', label: 'Matched', count: 62 },
  { key: 'unmatched', label: 'Unmatched', count: 92 },
];

/** A controlled harness so the buttons actually flip pressed state on change. */
function Harness({ onChange }: { onChange?: (k: Key) => void }) {
  const [value, setValue] = useState<Key>('all');
  return (
    <SegmentedControl
      ariaLabel="Filter calls"
      value={value}
      onChange={(k) => {
        setValue(k);
        onChange?.(k);
      }}
      options={OPTIONS}
    />
  );
}

describe('SegmentedControl — ARIA shape', () => {
  it('is a horizontal toolbar of toggle buttons, one pressed', () => {
    render(<Harness />);
    const toolbar = screen.getByRole('toolbar', { name: 'Filter calls' });
    expect(toolbar).toHaveAttribute('aria-orientation', 'horizontal');

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    // Exactly the selected key is pressed; none use tab/radio semantics.
    expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Matched/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('renders each option count', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /All/ })).toHaveTextContent('154');
  });
});

describe('SegmentedControl — roving tabindex', () => {
  it('makes only the selected key Tab-reachable', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /All/ })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('button', { name: /Matched/ })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('button', { name: /Unmatched/ })).toHaveAttribute('tabindex', '-1');
  });
});

describe('SegmentedControl — keyboard', () => {
  it('ArrowRight/ArrowLeft move focus and wrap around', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const all = screen.getByRole('button', { name: /All/ });
    const matched = screen.getByRole('button', { name: /Matched/ });
    const unmatched = screen.getByRole('button', { name: /Unmatched/ });

    all.focus();
    await user.keyboard('{ArrowRight}');
    expect(matched).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(unmatched).toHaveFocus();
    // wraps forward...
    await user.keyboard('{ArrowRight}');
    expect(all).toHaveFocus();
    // ...and backward.
    await user.keyboard('{ArrowLeft}');
    expect(unmatched).toHaveFocus();
  });

  it('Home and End jump to the ends', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const all = screen.getByRole('button', { name: /All/ });
    const unmatched = screen.getByRole('button', { name: /Unmatched/ });

    all.focus();
    await user.keyboard('{End}');
    expect(unmatched).toHaveFocus();
    await user.keyboard('{Home}');
    expect(all).toHaveFocus();
  });

  it('moving focus does not select; Enter/Space activates the focused key', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const all = screen.getByRole('button', { name: /All/ });
    const matched = screen.getByRole('button', { name: /Matched/ });

    all.focus();
    await user.keyboard('{ArrowRight}');
    // Arrowing alone must not change the selection (toolbar, not radiogroup).
    expect(onChange).not.toHaveBeenCalled();
    expect(all).toHaveAttribute('aria-pressed', 'true');

    await user.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith('matched');
    expect(matched).toHaveAttribute('aria-pressed', 'true');

    // And Space works the same on the newly focused key.
    await user.keyboard('{ArrowLeft}{ }');
    expect(onChange).toHaveBeenLastCalledWith('all');
  });

  it('clicking a key selects it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: /Unmatched/ }));
    expect(onChange).toHaveBeenLastCalledWith('unmatched');
    expect(screen.getByRole('button', { name: /Unmatched/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
