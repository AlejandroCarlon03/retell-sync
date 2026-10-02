/**
 * Every call in the window — the page that answers "154 pulled but only 62?".
 * A segmented control filters between All / After-hours / Business-hours /
 * Unmatched, each showing its live count so the split is self-evident: nothing
 * is dropped, the calls are just classified. The After-Hours page's table hides
 * business-hours calls on purpose; this page shows them all.
 */
import { useMemo, useState } from 'react';

import { CallsTable, type CallsFilterMode } from '../components/CallsTable';
import { PageFoot } from '../components/PageFoot';
import { SegmentedControl } from '../components/SegmentedControl';
import { NO_CALLS, useFilteredData } from '../hooks/useFilteredData';

type Segment = 'all' | 'matched' | 'unmatched';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: 'Matched' },
  { key: 'unmatched', label: 'Unmatched' },
];

export function AllCallsPage() {
  const { data, range } = useFilteredData();
  const [mode, setMode] = useState<CallsFilterMode>('all');

  const calls = data?.by_call ?? NO_CALLS;
  const counts = useMemo(
    () => ({
      all: calls.length,
      matched: calls.filter((c) => c.matched).length,
      unmatched: calls.filter((c) => !c.matched).length,
    }),
    [calls],
  );

  if (!data) return null;

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h2>All calls in the window</h2>
        </div>
        <p className="card-note">
          Every call fetched from Retell is here — nothing is dropped for short duration or an
          “Unsuccessful” result. The Retell line is your after-hours line, so{' '}
          <strong>every call here is an after-hours call</strong>. Filter by whether the caller
          matched a lead already in your Odoo CRM.
        </p>
        <SegmentedControl
          ariaLabel="Filter calls"
          value={mode}
          onChange={setMode}
          options={SEGMENTS.map((s) => ({ ...s, count: counts[s.key] }))}
        />
      </section>

      <CallsTable
        calls={calls}
        links={data.links}
        mode={mode}
        heading="Calls"
        infoText="The current filter's calls, newest first. The Links column opens the call's transcript in Retell and, for callers already in our CRM, their lead in Odoo."
        range={range}
        exportName="calls"
      />
      <PageFoot />
    </>
  );
}
