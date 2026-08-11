/**
 * Known-clients view. Caller KPIs, the after-hours known-vs-new breakdown
 * (ClientMatch), a matched-vs-unmatched call split, and repeat-caller detection —
 * all computed from the shared conversion payload. Every call is an after-hours
 * call (the Retell line), so these are "who is calling our after-hours line?".
 */
import { useMemo } from 'react';

import { ClientMatch } from '../components/ClientMatch';
import { PageFoot } from '../components/PageFoot';
import { SplitMeter } from '../components/SplitMeter';
import { useFilteredData } from '../hooks/useFilteredData';
import { fillTemplate, formatCount, formatPercent } from '../lib/format';

export function ClientsPage() {
  const { data } = useFilteredData();

  const derived = useMemo(() => {
    const calls = data?.by_call ?? [];
    const matched = calls.filter((c) => c.matched).length;
    // Tally calls per phone, keeping a representative lead name/id from any
    // matched call for that number so the table can show who's calling.
    const byPhone = new Map<
      string,
      { count: number; name: string | null; leadId: number | null }
    >();
    for (const c of calls) {
      if (!c.phone_key) continue;
      const prev = byPhone.get(c.phone_key) ?? { count: 0, name: null, leadId: null };
      byPhone.set(c.phone_key, {
        count: prev.count + 1,
        name: prev.name ?? (c.matched ? c.lead_name : null),
        leadId: prev.leadId ?? (c.matched ? c.lead_id : null),
      });
    }
    const repeatCallers = [...byPhone.values()].filter((v) => v.count > 1).length;
    const topRepeat = [...byPhone.entries()]
      .filter(([, v]) => v.count > 1)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([phone, v]) => ({ phone, count: v.count, name: v.name, leadId: v.leadId }));
    return { total: calls.length, matched, unmatched: calls.length - matched, repeatCallers, topRepeat };
  }, [data]);

  if (!data) return null;
  const k = data.kpis;
  const knownShare = k.unique_callers > 0 ? k.known_callers / k.unique_callers : 0;

  return (
    <>
      <section className="kpi-bench" aria-label="Caller metrics">
        <div className="kpi-cell">
          <div className="kpi-label">Unique callers</div>
          <div className="kpi-value">{formatCount(k.unique_callers)}</div>
          <div className="kpi-sub">counted as people</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Known in CRM</div>
          <div className="kpi-value">{formatCount(k.known_callers)}</div>
          <div className="kpi-sub">{formatPercent(knownShare)} of callers</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">New from after-hours</div>
          <div className="kpi-value">{formatCount(k.after_hours_new_clients)}</div>
          <div className="kpi-sub">net-new leads the agent brought in</div>
        </div>
        <div className="kpi-cell">
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
          <SplitMeter
            ariaLabel="Matched versus unmatched calls"
            after={{ label: 'Matched', value: derived.matched, hue: 'after' }}
            business={{ label: 'Unmatched', value: derived.unmatched, hue: 'business' }}
          />

          {derived.topRepeat.length > 0 && (
            <div className="split-block">
              <h3 className="clients-subhead">Top repeat callers</h3>
              <div className="table-scroll">
                <table className="calls-table">
                  <thead>
                    <tr>
                      <th>Caller</th>
                      <th className="num">Calls</th>
                      <th>Links</th>
                    </tr>
                  </thead>
                  <tbody>
                    {derived.topRepeat.map(({ phone, count, name, leadId }) => {
                      const odooUrl = fillTemplate(data.links?.odoo_lead, 'lead_id', leadId);
                      return (
                        <tr key={phone}>
                          <td>
                            {name ? (
                              <>
                                {name}
                                <span className="mono caller-phone" title={phone}>
                                  {phone}
                                </span>
                              </>
                            ) : (
                              <span className="mono">{phone}</span>
                            )}
                          </td>
                          <td className="num">{formatCount(count)}</td>
                          <td>
                            <span className="row-links">
                              {odooUrl ? (
                                <a
                                  className="link-btn"
                                  href={odooUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  title="Open this caller's lead in Odoo CRM"
                                >
                                  Odoo
                                </a>
                              ) : (
                                <span
                                  className="link-btn link-btn-disabled"
                                  title={
                                    leadId == null
                                      ? 'Caller is not in the CRM'
                                      : 'Odoo web URL not configured'
                                  }
                                >
                                  Odoo
                                </span>
                              )}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>

      <PageFoot />
    </>
  );
}
