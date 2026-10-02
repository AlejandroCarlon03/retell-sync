/**
 * Call Quality — judges the after-hours agent itself, not the CRM outcome. Retell
 * records a `user_sentiment` and a `disconnection_reason` for every call; those
 * two signals are carried through the join (see `retell_sync/conversion.py`) but
 * were never surfaced. This page reads them off the same filtered `by_call` rows
 * the rest of the dashboard uses (via `summarizeQuality`, so the panels stay
 * consistent with the date range) and answers: how did callers feel, how did
 * calls end, and do unhappy calls convert worse?
 *
 * Colour never carries meaning alone (the bench's status rule): every sentiment
 * and outcome row pairs its hue with an icon and a word.
 */
import { useMemo } from 'react';

import { InfoTip } from '../components/InfoTip';
import { PageFoot } from '../components/PageFoot';
import { NO_CALLS, useFilteredData } from '../hooks/useFilteredData';
import { formatCount, formatPercent } from '../lib/format';
import {
  DISCONNECTION_BUCKETS,
  POOR_OUTCOME_BUCKETS,
  SENTIMENT_BUCKETS,
  summarizeQuality,
  type DisconnectionBucket,
  type SentimentBucket,
} from '../lib/quality';

/** Display label + token hue + glyph for each sentiment bucket. */
const SENTIMENT_META: Record<SentimentBucket, { label: string; hue: string; mark: 'up' | 'flat' | 'down' | 'q' }> = {
  positive: { label: 'Positive', hue: 'var(--good)', mark: 'up' },
  neutral: { label: 'Neutral', hue: 'var(--series-neutral)', mark: 'flat' },
  negative: { label: 'Negative', hue: 'var(--critical)', mark: 'down' },
  unknown: { label: 'Not analyzed', hue: 'var(--tick)', mark: 'q' },
};

/** Display label for each disconnection bucket. */
const DISCONNECTION_LABEL: Record<DisconnectionBucket, string> = {
  completed: 'Completed',
  caller_hangup: 'Caller hung up',
  agent_hangup: 'Agent wrapped up',
  transfer: 'Transferred to a person',
  voicemail: 'Voicemail / machine',
  no_answer: 'No answer / busy',
  error: 'Technical error',
  other: 'Other',
  unknown: 'Not recorded',
};

function Mark({ kind }: { kind: 'up' | 'flat' | 'down' | 'q' | 'warn' | 'ok' }) {
  const common = {
    width: 13,
    height: 13,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  switch (kind) {
    case 'up':
      return (
        <svg {...common}>
          <path d="M5 12l4 4 10-10" />
        </svg>
      );
    case 'down':
      return (
        <svg {...common}>
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="18" y1="6" x2="6" y2="18" />
        </svg>
      );
    case 'flat':
      return (
        <svg {...common}>
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case 'warn':
      return (
        <svg {...common}>
          <path d="M12 4.5 21 19H3z" />
          <line x1="12" y1="10" x2="12" y2="14" />
          <line x1="12" y1="16.5" x2="12" y2="16.6" />
        </svg>
      );
    case 'ok':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="7.5" />
        </svg>
      );
    default: // 'q'
      return (
        <svg {...common}>
          <path d="M9.2 9a2.8 2.8 0 1 1 4 2.5c-.9.5-1.6 1.1-1.6 2.2" />
          <line x1="11.6" y1="17.5" x2="11.6" y2="17.6" />
        </svg>
      );
  }
}

interface BarRow {
  key: string;
  label: string;
  count: number;
  hue: string;
  mark: 'up' | 'flat' | 'down' | 'q' | 'warn' | 'ok';
}

/** A labelled distribution: icon + word + a proportional bar + count/share. */
function Distribution({ rows, total, ariaLabel }: { rows: BarRow[]; total: number; ariaLabel: string }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <ul className="qual-list" aria-label={ariaLabel}>
      {rows.map((r) => (
        <li className="qual-row" key={r.key}>
          <span className="qual-mark" style={{ color: r.hue }}>
            <Mark kind={r.mark} />
          </span>
          <span className="qual-label">{r.label}</span>
          <span className="qual-track" aria-hidden="true">
            <span
              className="qual-fill"
              style={{ width: `${(r.count / max) * 100}%`, background: r.hue }}
            />
          </span>
          <span className="qual-count">
            {formatCount(r.count)}
            <span className="qual-share">{total > 0 ? formatPercent(r.count / total) : formatPercent(0)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function CallQualityPage() {
  const { data } = useFilteredData();
  const calls = data?.by_call ?? NO_CALLS;
  const q = useMemo(() => summarizeQuality(calls), [calls]);

  const sentimentRows: BarRow[] = SENTIMENT_BUCKETS.map((b) => ({
    key: b,
    label: SENTIMENT_META[b].label,
    count: q.sentimentCounts[b],
    hue: SENTIMENT_META[b].hue,
    mark: SENTIMENT_META[b].mark,
  }));

  const disconnectionRows: BarRow[] = DISCONNECTION_BUCKETS.map((b): BarRow => {
    const poor = POOR_OUTCOME_BUCKETS.includes(b);
    return {
      key: b,
      label: DISCONNECTION_LABEL[b],
      count: q.disconnectionCounts[b],
      hue: b === 'error' ? 'var(--critical)' : poor ? 'var(--warning)' : b === 'unknown' || b === 'other' ? 'var(--tick)' : 'var(--series-after)',
      mark: poor ? 'warn' : b === 'unknown' || b === 'other' ? 'q' : 'ok',
    };
    // Only non-empty buckets are rendered below, so a clean window stays uncluttered.
  }).filter((r) => r.count > 0);

  if (!data) return null;

  return (
    <>
      <section className="kpi-bench" aria-label="Call quality summary">
        <div className="kpi-cell">
          <div className="kpi-label">Calls analyzed</div>
          <div className="kpi-value">{formatCount(q.total)}</div>
          <div className="kpi-sub">
            {formatCount(q.sentimentCounts.unknown)} without a sentiment read
          </div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Negative sentiment</div>
          <div className="kpi-value">{formatPercent(q.negativeRate)}</div>
          <div className="kpi-sub">of calls with a sentiment read</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Never reached a person</div>
          <div className="kpi-value">{formatPercent(q.poorOutcomeRate)}</div>
          <div className="kpi-sub">voicemail, no-answer, or error</div>
        </div>
        <div className="kpi-cell">
          <div className="kpi-label">Positive sentiment</div>
          <div className="kpi-value">{formatCount(q.sentimentCounts.positive)}</div>
          <div className="kpi-sub">
            {formatCount(q.sentimentCounts.negative)} negative · {formatCount(q.sentimentCounts.neutral)} neutral
          </div>
        </div>
      </section>

      <div className="quality-grid">
        <section className="card" aria-label="Sentiment mix">
          <div className="card-head">
            <h2>Caller sentiment</h2>
            <div className="card-head-right">
              <InfoTip text="Retell's user-sentiment read for each call. 'Not analyzed' means the call had no sentiment on record — it is kept separate so it never reads as neutral." />
            </div>
          </div>
          <p className="card-note">How callers sounded, across every call in the window.</p>
          <Distribution rows={sentimentRows} total={q.total} ariaLabel="Sentiment distribution" />
        </section>

        <section className="card" aria-label="How calls ended">
          <div className="card-head">
            <h2>How calls ended</h2>
            <div className="card-head-right">
              <InfoTip text="Retell's disconnection reason, bucketed. Voicemail, no-answer, and technical errors are flagged — a rising share there is the earliest sign the agent is struggling to connect." />
            </div>
          </div>
          <p className="card-note">Only outcomes that occurred in the window are listed.</p>
          {disconnectionRows.length > 0 ? (
            <Distribution rows={disconnectionRows} total={q.total} ariaLabel="Disconnection distribution" />
          ) : (
            <p className="settings-hint">No disconnection reasons recorded for these calls.</p>
          )}
        </section>
      </div>

      <section className="card" aria-label="Conversion by sentiment">
        <div className="card-head">
          <h2>Do unhappy calls convert worse?</h2>
          <div className="card-head-right">
            <InfoTip text="Win rate is won calls ÷ calls for each sentiment. A low win rate on negative calls, or a high one on positive, tells you sentiment is a real signal worth acting on." />
          </div>
        </div>
        <div className="table-scroll" tabIndex={0} role="group" aria-label="Sentiment vs outcome — scrollable table">
          <table className="calls-table">
            <thead>
              <tr>
                <th>Sentiment</th>
                <th className="num">Calls</th>
                <th className="num">Won</th>
                <th className="num">Win rate</th>
              </tr>
            </thead>
            <tbody>
              {SENTIMENT_BUCKETS.map((b) => {
                const row = q.bySentiment[b];
                return (
                  <tr key={b}>
                    <td>
                      <span className="qual-inline" style={{ color: SENTIMENT_META[b].hue }}>
                        <Mark kind={SENTIMENT_META[b].mark} />
                      </span>
                      {SENTIMENT_META[b].label}
                    </td>
                    <td className="num">{formatCount(row.calls)}</td>
                    <td className="num">{formatCount(row.won)}</td>
                    <td className="num">{row.calls > 0 ? formatPercent(row.won / row.calls) : formatPercent(0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <PageFoot />
    </>
  );
}
