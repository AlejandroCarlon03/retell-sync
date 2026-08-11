/**
 * TypeScript model of `email_log.json` — the append-only send-log the Python alert
 * path writes (`retell_sync/sendlog.py`) and the host serves at `GET /api/email-log`.
 * One record per digest email that was actually delivered, newest last.
 */

/** One delivered digest email. */
export interface EmailLogRecord {
  /** ISO-8601 UTC timestamp of when the send succeeded. */
  sent_at: string;
  /** Which digest this was. `per_rep` carries a `rep`; the others don't. */
  kind: 'manager' | 'per_rep' | 'scorecard' | string;
  /** The salesperson for a `per_rep` send; `null` for manager / scorecard. */
  rep: string | null;
  /** The address(es) the message went to. */
  recipients: string[];
  /** The email subject line. */
  subject: string;
  /** Rows the message covered — overdue leads, or ranked reps for the scorecard. */
  lead_count: number;
  /** The exact HTML body that was sent, rendered read-only in a sandboxed frame. */
  html: string;
}
