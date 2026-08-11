/**
 * Follow-up gap classification — the after-hours calls that need attention so
 * nothing falls through the cracks. Two buckets, derived purely from the `by_call`
 * rows:
 *
 *   • 'unmatched' — an after-hours call that never became a CRM lead at all (no
 *     `matched` lead). The caller reached the agent but nothing was logged in Odoo.
 *   • 'stalled'   — a matched after-hours lead still sitting at the funnel's entry
 *     stage (`funnel_position === 0`), not won and not lost: a lead nobody has
 *     advanced yet.
 *
 * Everything else is 'ok' (advanced, won, lost, or not an after-hours call).
 *
 * This is the client-side, config-free cousin of `retell_sync.sla.find_overdue`:
 * it has no SLA clock and no server `unactioned_stages` list, so "stalled" here is
 * the entry-stage subset — a visual "needs follow-up" view, not the authoritative
 * overdue set the email digest sends.
 */
import type { CallRow } from '../types/conversion';

export type GapKind = 'unmatched' | 'stalled' | 'ok';

/** Which follow-up gap (if any) a single call falls into. */
export function classifyGap(call: CallRow): GapKind {
  if (call.after_hours !== true) return 'ok';
  if (!call.matched) return 'unmatched';
  if (!call.is_won && !call.is_lost && call.funnel_position === 0) return 'stalled';
  return 'ok';
}

/** The calls in one gap bucket, order preserved. */
export function filterGap(calls: CallRow[], kind: 'unmatched' | 'stalled'): CallRow[] {
  return calls.filter((c) => classifyGap(c) === kind);
}

export interface GapCounts {
  /** Distinct callers (by phone) with an unmatched after-hours call. */
  unmatchedCallers: number;
  /** Unmatched after-hours calls (rows). */
  unmatchedCalls: number;
  /** Distinct stalled leads (by lead id). */
  stalledLeads: number;
  /**
   * Expected revenue sitting in stalled leads, deduped per lead — the value at
   * risk if these are never followed up. (Often understated: many entry-stage
   * Odoo leads carry an expected_revenue of 0 until they're qualified.)
   */
  stalledRevenue: number;
}

/** Summary counts for the two gap buckets, deduped to people / leads. */
export function gapCounts(calls: CallRow[]): GapCounts {
  const unmatchedPhones = new Set<string>();
  let unmatchedCalls = 0;
  const stalledLeadRevenue = new Map<number, number>();
  let stalledLeadless = 0;

  for (const c of calls) {
    const kind = classifyGap(c);
    if (kind === 'unmatched') {
      unmatchedCalls += 1;
      if (c.phone_key) unmatchedPhones.add(c.phone_key);
    } else if (kind === 'stalled') {
      if (c.lead_id != null) {
        if (!stalledLeadRevenue.has(c.lead_id)) {
          const rev =
            typeof c.expected_revenue === 'number' && Number.isFinite(c.expected_revenue)
              ? c.expected_revenue
              : 0;
          stalledLeadRevenue.set(c.lead_id, rev);
        }
      } else {
        stalledLeadless += 1; // stalled row with no lead id (rare) still counts as one
      }
    }
  }

  return {
    unmatchedCallers: unmatchedPhones.size,
    unmatchedCalls,
    stalledLeads: stalledLeadRevenue.size + stalledLeadless,
    stalledRevenue: [...stalledLeadRevenue.values()].reduce((a, b) => a + b, 0),
  };
}
