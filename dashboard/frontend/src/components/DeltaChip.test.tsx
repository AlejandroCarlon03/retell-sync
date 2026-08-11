/**
 * DeltaChip: the percentage branch is metric-agnostic and always wins; the
 * absolute-change fallback (shown when the prior period is zero, so no percentage
 * exists) must format through the caller's formatter rather than dumping a raw
 * float — otherwise a currency delta reads as "4379.3103".
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { formatCurrency } from '../lib/format';
import { DeltaChip } from './DeltaChip';

describe('DeltaChip', () => {
  it('shows the percentage when a prior exists, ignoring the formatter', () => {
    render(
      <DeltaChip delta={{ recent: 12, prior: 10, change: 2, pct: 0.2 }} format={formatCurrency} />,
    );
    expect(screen.getByText(/20\.0%/)).toBeInTheDocument();
    expect(screen.queryByText(/\$2/)).not.toBeInTheDocument();
  });

  it('formats the absolute-change fallback with the formatter when there is no prior', () => {
    render(
      <DeltaChip
        delta={{ recent: 4379.3103, prior: 0, change: 4379.3103, pct: null }}
        format={formatCurrency}
      />,
    );
    expect(screen.getByText(/\+\$4,379/)).toBeInTheDocument();
    expect(screen.queryByText(/4379\.3103/)).not.toBeInTheDocument();
  });

  it('falls back to a plain number when no formatter is given', () => {
    render(<DeltaChip delta={{ recent: 29, prior: 0, change: 29, pct: null }} />);
    expect(screen.getByText(/\+29/)).toBeInTheDocument();
  });

  it('renders nothing when neither period moved', () => {
    const { container } = render(
      <DeltaChip delta={{ recent: 0, prior: 0, change: 0, pct: null }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
