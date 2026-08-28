/**
 * The callers behind the After-Hours dial's `$ / unique after-hours call`.
 *
 * That headline divides `after_hours_new_client_won_revenue` (won expected
 * revenue from callers the after-hours agent first brought into the CRM) by
 * `after_hours_new_clients`. This selects the rows that make up the numerator:
 * net-new after-hours clients with a won opportunity and non-zero expected
 * revenue — deduped to one row per lead, since many calls can hit the same
 * opportunity — sorted largest deal first. Rows with no lead, no win, or
 * zero/blank revenue are excluded; they add nothing to the dollars.
 */
import type { CallRow } from '../types/conversion';

export function revenueDrivers(calls: CallRow[]): CallRow[] {
  const seen = new Set<number>();
  const out: CallRow[] = [];
  for (const c of calls) {
    if (
      c.new_after_hours_client &&
      c.is_won &&
      c.lead_id != null &&
      !seen.has(c.lead_id) &&
      (c.expected_revenue ?? 0) > 0
    ) {
      seen.add(c.lead_id);
      out.push(c);
    }
  }
  return out.sort((a, b) => (b.expected_revenue ?? 0) - (a.expected_revenue ?? 0));
}
