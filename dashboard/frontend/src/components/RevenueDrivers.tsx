/**
 * "Where the $X per new customer comes from" — the drill-down behind the
 * After-Hours page's `$ / unique after-hours call` dial. That headline is
 * `after_hours_new_client_won_revenue ÷ after_hours_new_clients`: won revenue
 * from callers the after-hours agent brought into the CRM, spread across every
 * net-new caller. On a small window the dollars can trace to a single deal, and
 * "who actually made us money?" is otherwise invisible in a 100-plus-row table.
 *
 * This callout names the exact callers whose won deals make up that numerator —
 * net-new after-hours clients with a won opportunity and non-zero expected
 * revenue, one row per lead, largest first — with a Retell/Odoo deep link on
 * each, and a button that filters the calls table below to just them.
 */
import type { CSSProperties } from 'react';
import type { CallRow, ConversionLinks } from '../types/conversion';
import { fillTemplate, formatCount, formatCurrency } from '../lib/format';

export function RevenueDrivers({
  drivers,
  wonRevenue,
  newClients,
  dollarsPer,
  links,
  focused,
  onToggle,
}: {
  drivers: CallRow[];
  /** `after_hours_new_client_won_revenue` over the active window. */
  wonRevenue: number;
  /** `after_hours_new_clients` over the active window (the divisor). */
  newClients: number;
  /** `after_hours_new_client_won_revenue ÷ after_hours_new_clients`. */
  dollarsPer: number;
  links?: ConversionLinks;
  /** Whether the table below is currently filtered to these callers. */
  focused: boolean;
  onToggle: () => void;
}) {
  if (drivers.length === 0) return null;

  // Dimension every driver's measure bar off the largest won deal in the window,
  // so the sorted-largest-first rows read as a descending scribed staircase.
  const topRevenue = Math.max(...drivers.map((c) => c.expected_revenue ?? 0), 0);

  return (
    <section className="card revdrv" aria-label="Where the revenue per new customer comes from">
      <div className="card-head">
        <h2>
          Where your {formatCurrency(dollarsPer)} per new customer comes from
        </h2>
      </div>
      <p className="card-note">
        {formatCount(newClients)} first-time after-hours callers became customers in this window.{' '}
        <strong>
          {formatCount(drivers.length)} of them{' '}
          {drivers.length === 1 ? 'brought in' : 'brought in a combined'}{' '}
          {formatCurrency(wonRevenue)}
        </strong>{' '}
        in won revenue — divided across all {formatCount(newClients)}, that&apos;s{' '}
        {formatCurrency(dollarsPer)} per new customer.
      </p>

      <ul className="revdrv-list">
        {drivers.map((c) => {
          const retellUrl = fillTemplate(links?.retell_call, 'call_id', c.call_id);
          const odooUrl = fillTemplate(links?.odoo_lead, 'lead_id', c.lead_id);
          const fill = topRevenue > 0 ? `${((c.expected_revenue ?? 0) / topRevenue) * 100}%` : '0%';
          return (
            <li
              key={c.call_id}
              className="revdrv-row"
              style={{ '--fill': fill } as CSSProperties}
            >
              <div className="revdrv-who">
                <span className="revdrv-name">{c.lead_name ?? 'Unnamed lead'}</span>
                {c.phone_key && <span className="revdrv-phone mono">{c.phone_key}</span>}
              </div>
              <span className="revdrv-amount">{formatCurrency(c.expected_revenue)}</span>
              <span className="row-links">
                {retellUrl && (
                  <a
                    className="link-btn"
                    href={retellUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open this call's transcript in Retell"
                  >
                    Retell
                  </a>
                )}
                {odooUrl && (
                  <a
                    className="link-btn"
                    href={odooUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Open this caller's lead in Odoo CRM"
                  >
                    Odoo
                  </a>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <button type="button" className="btn revdrv-toggle" onClick={onToggle} aria-pressed={focused}>
        {focused
          ? 'Show all calls again'
          : `Show ${drivers.length === 1 ? 'this caller' : 'these callers'} in the table below`}
      </button>
    </section>
  );
}
