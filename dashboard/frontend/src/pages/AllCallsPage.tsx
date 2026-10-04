/**
 * Every call in the window — the page that answers "154 pulled but only 62?".
 * A segmented control filters between All / After-hours / Business-hours /
 * Unmatched, each showing its live count so the split is self-evident: nothing
 * is dropped, the calls are just classified. The After-Hours page's table hides
 * business-hours calls on purpose; this page shows them all.
 *
 * It also carries the revenue-driver drill-down: the callers whose won deals add
 * up to the After-Hours dial's `$ / unique after-hours call`. The callout names
 * them, and its button focuses the table on just those rows so the headline
 * dollar figure is traceable to real people.
 */
import { useMemo, useState } from 'react';

import { CallsTable, type CallsFilterMode } from '../components/CallsTable';
import { PageFoot } from '../components/PageFoot';
import { RevenueDrivers } from '../components/RevenueDrivers';
import { SegmentedControl } from '../components/SegmentedControl';
import { NO_CALLS, useFilteredData } from '../hooks/useFilteredData';
import { computeKpis } from '../lib/kpis';
import { revenueDrivers } from '../lib/revenueDrivers';

type Segment = 'all' | 'matched' | 'unmatched';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'matched', label: 'In CRM' },
  { key: 'unmatched', label: 'Not in CRM' },
];

export function AllCallsPage() {
  const { data, range } = useFilteredData();
  const [mode, setMode] = useState<CallsFilterMode>('all');
  const [driverFocus, setDriverFocus] = useState(false);

  const calls = data?.by_call ?? NO_CALLS;
  const counts = useMemo(
    () => ({
      all: calls.length,
      matched: calls.filter((c) => c.matched).length,
      unmatched: calls.filter((c) => !c.matched).length,
    }),
    [calls],
  );

  // The dollar figure the After-Hours dial shows, recomputed over the active
  // window so this drill-down always matches the dial for the same range.
  const kpis = useMemo(() => computeKpis(calls), [calls]);
  const drivers = useMemo(() => revenueDrivers(calls), [calls]);
  // Mirror of AfterHoursPage's `dollarsPerUnique`: won revenue from net-new
  // after-hours clients ÷ every net-new client (0 when there are none, so an
  // empty window reads as $0 rather than NaN).
  const dollarsPer =
    kpis.after_hours_new_clients > 0
      ? kpis.after_hours_new_client_won_revenue / kpis.after_hours_new_clients
      : 0;

  if (!data) return null;

  const tableCalls = driverFocus ? drivers : calls;

  return (
    <>
      <p className="page-intro">
        Every call Retell logged in this window, newest first. Nothing is dropped for being short
        or unsuccessful.
      </p>

      <RevenueDrivers
        drivers={drivers}
        wonRevenue={kpis.after_hours_new_client_won_revenue}
        newClients={kpis.after_hours_new_clients}
        dollarsPer={dollarsPer}
        links={data.links}
        focused={driverFocus}
        onToggle={() => setDriverFocus((v) => !v)}
      />

      <CallsTable
        calls={tableCalls}
        links={data.links}
        mode={driverFocus ? 'all' : mode}
        heading={driverFocus ? 'Callers who made you money' : 'Calls'}
        infoText={
          driverFocus
            ? 'The new leads from after-hours calls whose deals are won. Use “Show all calls again” to clear this filter.'
            : "In CRM callers are already a lead in Odoo; the rest aren't. The Links column opens the call's transcript in Retell and, for callers in the CRM, their lead in Odoo."
        }
        range={range}
        exportName={driverFocus ? 'revenue-drivers' : 'calls'}
        filters={
          driverFocus ? undefined : (
            <SegmentedControl
              ariaLabel="Filter calls"
              value={mode}
              onChange={setMode}
              options={SEGMENTS.map((s) => ({ ...s, count: counts[s.key] }))}
            />
          )
        }
      />
      <PageFoot />
    </>
  );
}
