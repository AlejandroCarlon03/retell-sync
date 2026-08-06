/**
 * Known-clients view. Caller KPIs, the after-hours known-vs-new breakdown
 * (ClientMatch), a matched-vs-unmatched call split, and repeat-caller detection —
 * all computed from the shared conversion payload. Every call is an after-hours
 * call (the Retell line), so these are "who is calling our after-hours line?".
 */
import { useMemo } from 'react';

import { ClientMatch } from '../components/ClientMatch';
import { useConversionData } from '../context/conversionContext';
import { formatCount, formatPercent } from '../lib/format';

export function ClientsPage() {
  const { data } = useConversionData();

  const derived = useMemo(() => {
    const calls = data?.by_call ?? [];
    const matched = calls.filter((c) => c.matched).length;
    const byPhone = new Map<string, number>();
    for (const c of calls) {
      if (!c.phone_key) continue;
      byPhone.set(c.phone_key, (byPhone.get(c.phone_key) ?? 0) + 1);
    }
    const repeatCallers = [...byPhone.values()].filter((n) => n > 1).length;
    const topRepeat = [...byPhone.entries()]
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);
    return { total: calls.length, matched, unmatched: calls.length - matched, repeatCallers, topRepeat };
  }, [data]);

  if (!data) return null;
  const k = data.kpis;
  const knownShare = k.unique_callers > 0 ? k.known_callers / k.unique_callers : 0;
  const matchShare = derived.total > 0 ? derived.matched / derived.total : 0;

  return (
    <>
      <section className="kpi-row" aria-label="Caller metrics">
        <div className="kpi-tile">
          <div className="kpi-label">Unique callers</div>
          <div className="kpi-value">{formatCount(k.unique_callers)}</div>
          <div className="kpi-sub">counted as people</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Known in CRM</div>
          <div className="kpi-value">{formatCount(k.known_callers)}</div>
          <div className="kpi-sub">{formatPercent(knownShare)} of callers</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">New from after-hours</div>
          <div className="kpi-value">{formatCount(k.after_hours_new_clients)}</div>
          <div className="kpi-sub">net-new leads the agent brought in</div>
        </div>
        <div className="kpi-tile">
          <div className="kpi-label">Repeat callers</div>
          <div className="kpi-value">{formatCount(derived.repeatCallers)}</div>
          <div className="kpi-sub">people who called more than once</div>
        </div>
      </section>

      <div className="grid-2">
        <ClientMatch kpis={k} />

        <section className="card" aria-label="Matched vs unmatched">
          <div className="card-head">
            <h2>Matched vs unmatched calls</h2>
          </div>
          <p className="card-note">
            Of {formatCount(derived.total)} calls, how many reached a caller already in your CRM.
          </p>
          <div className="stacked-meter" role="img" aria-label="Matched vs unmatched share">
            <span className="meter-seg seg-after" style={{ width: `${matchShare * 100}%` }} />
            <span
              className="meter-seg seg-business"
              style={{ width: `${(1 - matchShare) * 100}%` }}
            />
          </div>
          <div className="split-legend">
            <span>
              <span className="swatch swatch-after" /> {formatCount(derived.matched)} matched (
              {formatPercent(matchShare)})
            </span>
            <span>
              <span className="swatch swatch-business" /> {formatCount(derived.unmatched)} unmatched
            </span>
          </div>

          {derived.topRepeat.length > 0 && (
            <div className="split-block">
              <h3 className="clients-subhead">Top repeat callers</h3>
              <div className="table-scroll">
                <table className="calls-table">
                  <thead>
                    <tr>
                      <th>Phone</th>
                      <th className="num">Calls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {derived.topRepeat.map(([phone, n]) => (
                      <tr key={phone}>
                        <td className="mono">{phone}</td>
                        <td className="num">{formatCount(n)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
