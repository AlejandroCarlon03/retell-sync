/**
 * Client-side call-quality aggregation — the Call Quality page's counterpart to
 * `lib/kpis.ts`. The dashboard recomputes per date-range from the `by_call` rows
 * (see `useFilteredData`), so sentiment and disconnection tallies must be derived
 * here from the same filtered rows rather than read off the whole-window
 * `kpis` block; otherwise the panels would disagree with the table as the range
 * narrows.
 *
 * The two classifiers are faithful ports of Python's `classify_sentiment` /
 * `classify_disconnection` in `retell_sync/conversion.py`. The disconnection
 * rule list mirrors `ConversionConfig.disconnection_rules`; keep the two in sync
 * if the CRM's reasons change (the Python side is the source of truth for the
 * JSON payload, this side for the live dashboard).
 */
import type { CallRow } from '../types/conversion';

/** Canonical sentiment buckets, in display order. Mirrors Python `SENTIMENT_BUCKETS`. */
export const SENTIMENT_BUCKETS = ['positive', 'neutral', 'negative', 'unknown'] as const;
export type SentimentBucket = (typeof SENTIMENT_BUCKETS)[number];

/** Canonical disconnection buckets, in display order. Mirrors Python `DISCONNECTION_BUCKETS`. */
export const DISCONNECTION_BUCKETS = [
  'completed',
  'caller_hangup',
  'agent_hangup',
  'transfer',
  'voicemail',
  'no_answer',
  'error',
  'other',
  'unknown',
] as const;
export type DisconnectionBucket = (typeof DISCONNECTION_BUCKETS)[number];

/**
 * The "never reached a person / technical failure" buckets the page highlights —
 * a rising share here is the earliest signal the after-hours agent is struggling.
 */
export const POOR_OUTCOME_BUCKETS: readonly DisconnectionBucket[] = [
  'voicemail',
  'no_answer',
  'error',
];

/** Ordered `[substring, bucket]` rules — mirrors `ConversionConfig.disconnection_rules`. */
const DISCONNECTION_RULES: readonly (readonly [string, DisconnectionBucket])[] = [
  ['voicemail', 'voicemail'],
  ['machine', 'voicemail'],
  ['no_answer', 'no_answer'],
  ['no answer', 'no_answer'],
  ['dial_busy', 'no_answer'],
  ['dial_failed', 'no_answer'],
  ['busy', 'no_answer'],
  ['user_hangup', 'caller_hangup'],
  ['user hangup', 'caller_hangup'],
  ['caller_hangup', 'caller_hangup'],
  ['agent_hangup', 'agent_hangup'],
  ['agent hangup', 'agent_hangup'],
  ['transfer', 'transfer'],
  ['error', 'error'],
  ['failed', 'error'],
  ['inactivity', 'error'],
];

/** Fold a raw Retell `user_sentiment` onto a bucket. Missing/unknown → "unknown". */
export function classifySentiment(value: string | null | undefined): SentimentBucket {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('positive')) return 'positive';
  if (text.includes('neutral')) return 'neutral';
  if (text.includes('negative')) return 'negative';
  return 'unknown';
}

/** Fold a raw Retell `disconnection_reason` onto a bucket. Present-but-unmatched → "other", missing → "unknown". */
export function classifyDisconnection(value: string | null | undefined): DisconnectionBucket {
  const text = (value ?? '').trim().toLowerCase();
  if (!text) return 'unknown';
  for (const [substring, bucket] of DISCONNECTION_RULES) {
    if (text.includes(substring)) return bucket;
  }
  return 'other';
}

export interface SentimentConversion {
  /** Calls with this sentiment. */
  calls: number;
  /** Of those, how many won. */
  won: number;
}

export interface QualitySummary {
  total: number;
  sentimentCounts: Record<SentimentBucket, number>;
  disconnectionCounts: Record<DisconnectionBucket, number>;
  /** Negative ÷ classified (non-unknown) sentiment, as a fraction 0..1. */
  negativeRate: number;
  /** Calls that never reached a person or failed (POOR_OUTCOME_BUCKETS), ÷ total. */
  poorOutcomeRate: number;
  /** Per-sentiment calls-and-wins, so the page can show a conversion rate per mood. */
  bySentiment: Record<SentimentBucket, SentimentConversion>;
}

function zeroSentiment(): Record<SentimentBucket, number> {
  return { positive: 0, neutral: 0, negative: 0, unknown: 0 };
}

function zeroDisconnection(): Record<DisconnectionBucket, number> {
  return {
    completed: 0,
    caller_hangup: 0,
    agent_hangup: 0,
    transfer: 0,
    voicemail: 0,
    no_answer: 0,
    error: 0,
    other: 0,
    unknown: 0,
  };
}

/**
 * Aggregate call-quality signal from a set of call rows. Counts calls (not leads):
 * sentiment and outcome describe the call, so a caller who rang three times
 * contributes three readings. Pure and total.
 */
export function summarizeQuality(calls: CallRow[]): QualitySummary {
  const sentimentCounts = zeroSentiment();
  const disconnectionCounts = zeroDisconnection();
  const bySentiment: Record<SentimentBucket, SentimentConversion> = {
    positive: { calls: 0, won: 0 },
    neutral: { calls: 0, won: 0 },
    negative: { calls: 0, won: 0 },
    unknown: { calls: 0, won: 0 },
  };

  let poorOutcome = 0;
  for (const c of calls) {
    const s = classifySentiment(c.sentiment);
    sentimentCounts[s] += 1;
    bySentiment[s].calls += 1;
    if (c.is_won) bySentiment[s].won += 1;

    const d = classifyDisconnection(c.disconnection_reason);
    disconnectionCounts[d] += 1;
    if (POOR_OUTCOME_BUCKETS.includes(d)) poorOutcome += 1;
  }

  const known = sentimentCounts.positive + sentimentCounts.neutral + sentimentCounts.negative;
  const total = calls.length;

  return {
    total,
    sentimentCounts,
    disconnectionCounts,
    negativeRate: known > 0 ? sentimentCounts.negative / known : 0,
    poorOutcomeRate: total > 0 ? poorOutcome / total : 0,
    bySentiment,
  };
}
