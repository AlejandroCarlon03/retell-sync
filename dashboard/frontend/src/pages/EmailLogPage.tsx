/**
 * Email Log — an admin-only record of every overdue-lead digest the alert path
 * actually sent: which salesperson (or manager / scorecard) was emailed, on what
 * day, and — expanded inline — the exact message body. It reads the persisted
 * send-log (`retell_sync/sendlog.py`) via `GET /api/email-log`, so it surfaces the
 * otherwise-invisible per-salesperson digests from PR #51.
 *
 * Host-only: the nav item is hidden in the static viewer (see `nav.ts` hostOnly),
 * so this page is only reached inside the Photino desktop app. Sends are grouped by
 * UTC day, newest first; the stored HTML renders in a sandboxed, script-less frame.
 */
import { useEffect, useMemo, useState } from 'react';

import { ApiError, fetchEmailLog } from '../api/client';
import { isStatic } from '../nav';
import { formatCount, formatDateTime, formatUtcDay } from '../lib/format';
import type { EmailLogRecord } from '../types/emailLog';

/** Human label + short tag for each send kind. */
function kindLabel(rec: EmailLogRecord): string {
  switch (rec.kind) {
    case 'per_rep':
      return rec.rep?.trim() || 'Salesperson';
    case 'manager':
      return 'Manager digest';
    case 'scorecard':
      return 'Weekly scorecard';
    default:
      return rec.kind;
  }
}

function kindTag(kind: string): string {
  switch (kind) {
    case 'per_rep':
      return 'Per-rep';
    case 'manager':
      return 'Manager';
    case 'scorecard':
      return 'Scorecard';
    default:
      return kind;
  }
}

interface DayGroup {
  day: string; // YYYY-MM-DD (UTC)
  records: { rec: EmailLogRecord; key: string }[];
}

/** Group records by UTC send-day, newest day and newest record first. */
function groupByDay(records: EmailLogRecord[]): DayGroup[] {
  const withKeys = records.map((rec, i) => ({ rec, key: `${rec.sent_at}#${i}` }));
  withKeys.sort((a, b) => b.rec.sent_at.localeCompare(a.rec.sent_at));
  const byDay = new Map<string, { rec: EmailLogRecord; key: string }[]>();
  for (const item of withKeys) {
    const day = item.rec.sent_at.slice(0, 10);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(item);
    else byDay.set(day, [item]);
  }
  return [...byDay.entries()].map(([day, recs]) => ({ day, records: recs }));
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; records: EmailLogRecord[] };

export function EmailLogPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isStatic()) return; // no host in the static viewer; nothing to fetch
    let alive = true;
    fetchEmailLog()
      .then((records) => alive && setState({ kind: 'ready', records }))
      .catch((err: unknown) => {
        if (!alive) return;
        setState({
          kind: 'error',
          message: err instanceof ApiError ? err.message : 'Could not load the email log.',
        });
      });
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(
    () => (state.kind === 'ready' ? groupByDay(state.records) : []),
    [state],
  );

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (isStatic()) {
    return (
      <section className="card settings-card">
        <div className="card-head">
          <h2>Email log</h2>
        </div>
        <p className="state-body">The email log is available only in the desktop app.</p>
      </section>
    );
  }

  if (state.kind === 'loading') {
    return (
      <section className="card settings-card" aria-label="Email log">
        <div className="card-head">
          <h2>Email log</h2>
        </div>
        <p className="state-msg" role="status" aria-live="polite">
          Loading email log…
        </p>
      </section>
    );
  }

  if (state.kind === 'error') {
    return (
      <section className="card settings-card state-error" aria-label="Email log" role="alert">
        <div className="card-head">
          <h2>Email log</h2>
        </div>
        <p className="state-body">Couldn’t load the email log. {state.message}</p>
      </section>
    );
  }

  if (state.records.length === 0) {
    return (
      <section className="card settings-card" aria-label="Email log">
        <div className="card-head">
          <h2>No digests sent yet</h2>
        </div>
        <p className="card-note">
          Every overdue-lead digest that goes out — the manager digest, each
          salesperson’s own digest, and the weekly scorecard — is recorded here with
          the exact message that was sent.
        </p>
        <p className="settings-hint">
          Per-salesperson digests are off until <code>RETELL_ALERT_PER_REP=true</code> is
          set on the server (see SETUP.md). Until a scheduled run sends a digest, this
          log stays empty.
        </p>
      </section>
    );
  }

  return (
    <>
      <section className="card settings-card" aria-label="Email log">
        <div className="card-head">
          <h2>Sent digests</h2>
        </div>
        <p className="card-note">
          Every overdue-lead digest that was delivered, newest first. Open a row to see
          the exact email that was sent.
        </p>
      </section>

      {groups.map((group) => (
        <section className="card emaillog-day" key={group.day} aria-label={formatUtcDay(group.day)}>
          <h3 className="emaillog-dayhead">{formatUtcDay(group.day)}</h3>
          <ul className="emaillog-list">
            {group.records.map(({ rec, key }) => {
              const open = expanded.has(key);
              return (
                <li className="emaillog-item" key={key}>
                  <button
                    type="button"
                    className="emaillog-toggle"
                    aria-expanded={open}
                    onClick={() => toggle(key)}
                  >
                    <span className={`emaillog-tag emaillog-tag-${rec.kind}`}>
                      {kindTag(rec.kind)}
                    </span>
                    <span className="emaillog-who">{kindLabel(rec)}</span>
                    <span className="emaillog-subject" title={rec.subject}>
                      {rec.subject}
                    </span>
                    <span className="emaillog-count">
                      {formatCount(rec.lead_count)} {rec.lead_count === 1 ? 'row' : 'rows'}
                    </span>
                    <span className="emaillog-time">{formatDateTime(rec.sent_at)}</span>
                    <span className="emaillog-chevron" aria-hidden>
                      {open ? '▾' : '▸'}
                    </span>
                  </button>
                  {open && (
                    <div className="emaillog-detail">
                      <p className="emaillog-meta">
                        To: {rec.recipients.length > 0 ? rec.recipients.join(', ') : '—'}
                      </p>
                      <iframe
                        className="emaillog-frame"
                        title={`Email sent ${formatDateTime(rec.sent_at)}`}
                        sandbox=""
                        srcDoc={rec.html}
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
