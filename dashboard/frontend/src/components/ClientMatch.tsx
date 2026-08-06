/**
 * Known-clients panel — of the distinct people who called the after-hours agent,
 * how many are already in our Odoo CRM (matched to a lead by phone). This is the
 * "are our callers existing clients?" question, counted as *people* (deduped by
 * phone), not calls. A single meter plus the raw counts; the all-hours figure
 * sits underneath as context.
 */
import type { ConversionKpis } from '../types/conversion';
import { formatCount, formatCurrency, formatPercent } from '../lib/format';
import { InfoTip } from './InfoTip';

function share(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

export function ClientMatch({ kpis }: { kpis: ConversionKpis }) {
  const known = kpis.after_hours_known_callers;
  const total = kpis.after_hours_unique_callers;
  const frac = share(known, total);
  const widthPct = Math.min(100, Math.max(0, frac * 100));

  return (
    <section className="card" aria-label="Known clients">
      <div className="card-head">
        <h2>Known clients</h2>
        <InfoTip text="After-hours callers who were already leads in our Odoo CRM before they called, matched by phone number. Counts people, not calls. The 'all hours' bar is the same idea across every call, day or night." />
      </div>
      <p className="card-note">
        After-hours callers already in the CRM, matched by phone (counting people, not calls).
      </p>

      <div className="clients-headline">
        <span className="clients-big">{formatCount(known)}</span>
        <span className="clients-of">of {formatCount(total)} after-hours callers</span>
      </div>

      <div className="single-meter clients-meter">
        <span className="meter-fill fill-after" style={{ width: `${widthPct}%` }} />
      </div>
      <div className="split-legend">
        <span>{formatPercent(frac)} are existing clients</span>
        <span>{formatCount(Math.max(0, total - known))} new / unknown</span>
      </div>

      <div className="split-block">
        <div className="meter-row">
          <span className="meter-label">All hours</span>
          <span className="single-meter">
            <span
              className="meter-fill fill-after"
              style={{ width: `${Math.min(100, share(kpis.known_callers, kpis.unique_callers) * 100)}%` }}
            />
          </span>
          <span className="meter-value">
            {formatCount(kpis.known_callers)}/{formatCount(kpis.unique_callers)}
          </span>
        </div>
      </div>

      <div className="split-block">
        <div className="card-head">
          <h3 className="clients-subhead">New from after-hours</h3>
          <InfoTip text="Callers who were strangers — no lead in Odoo before they rang the after-hours line — and became a lead because of that call. These are net-new customers the after-hours agent brought in, counted as people. Won revenue is what we've already closed from them; pipeline is the weighted value still open." />
        </div>
        <div className="clients-headline">
          <span className="clients-big">{formatCount(kpis.after_hours_new_clients)}</span>
          <span className="clients-of">
            net-new clients · {formatCount(kpis.after_hours_new_client_won_deals)} won
          </span>
        </div>
        <div className="split-legend">
          <span>{formatCurrency(kpis.after_hours_new_client_won_revenue)} won revenue</span>
          <span>{formatCurrency(kpis.after_hours_new_client_pipeline)} open pipeline</span>
        </div>
      </div>
    </section>
  );
}
