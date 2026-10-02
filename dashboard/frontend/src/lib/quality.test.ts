/**
 * Tests for the client-side call-quality classifiers and aggregation — the
 * counterpart to `lib/kpis.ts`, and the port that must stay faithful to Python's
 * `classify_sentiment` / `classify_disconnection` so the dashboard and the JSON
 * payload agree.
 */
import { describe, expect, it } from 'vitest';

import {
  classifyDisconnection,
  classifySentiment,
  summarizeQuality,
} from './quality';
import type { CallRow } from '../types/conversion';

function call(over: Partial<CallRow>): CallRow {
  return {
    call_id: 'c1',
    phone_key: '6024481574',
    ts: '2026-08-01T04:00:00+00:00',
    after_hours: true,
    duration: 60,
    cost: 0,
    matched: false,
    lead_id: null,
    lead_name: null,
    lead_created: null,
    new_after_hours_client: false,
    stage_label: null,
    sales_rep: null,
    funnel_stage: null,
    funnel_position: null,
    probability: null,
    expected_revenue: null,
    weighted_value: null,
    is_won: false,
    is_lost: false,
    ...over,
  };
}

describe('classifySentiment', () => {
  it('folds known values, and unknown/missing to "unknown"', () => {
    expect(classifySentiment('Positive')).toBe('positive');
    expect(classifySentiment('very NEGATIVE')).toBe('negative');
    expect(classifySentiment('Neutral')).toBe('neutral');
    expect(classifySentiment(null)).toBe('unknown');
    expect(classifySentiment('')).toBe('unknown');
    expect(classifySentiment('mixed')).toBe('unknown');
  });
});

describe('classifyDisconnection', () => {
  it('buckets real Retell reasons; unmatched → other, missing → unknown', () => {
    expect(classifyDisconnection('voicemail_reached')).toBe('voicemail');
    expect(classifyDisconnection('machine_detected')).toBe('voicemail');
    expect(classifyDisconnection('user_hangup')).toBe('caller_hangup');
    expect(classifyDisconnection('agent_hangup')).toBe('agent_hangup');
    expect(classifyDisconnection('dial_no_answer')).toBe('no_answer');
    expect(classifyDisconnection('call_transfer')).toBe('transfer');
    expect(classifyDisconnection('error_llm_websocket_open')).toBe('error');
    expect(classifyDisconnection('brand_new_reason')).toBe('other');
    expect(classifyDisconnection(null)).toBe('unknown');
  });
});

describe('summarizeQuality', () => {
  it('counts calls per bucket and computes rates from the rows', () => {
    const calls = [
      call({ sentiment: 'Positive', disconnection_reason: 'agent_hangup', is_won: true }),
      call({ sentiment: 'Negative', disconnection_reason: 'voicemail_reached' }),
      call({ sentiment: null, disconnection_reason: null }),
    ];
    const q = summarizeQuality(calls);

    expect(q.total).toBe(3);
    expect(q.sentimentCounts).toEqual({ positive: 1, neutral: 0, negative: 1, unknown: 1 });
    expect(q.disconnectionCounts.voicemail).toBe(1);
    expect(q.disconnectionCounts.agent_hangup).toBe(1);
    expect(q.disconnectionCounts.unknown).toBe(1);

    // 1 negative of 2 known-sentiment calls.
    expect(q.negativeRate).toBeCloseTo(0.5);
    // voicemail is the one "never reached a person" outcome of 3 calls.
    expect(q.poorOutcomeRate).toBeCloseTo(1 / 3);
    // The positive call is the winner.
    expect(q.bySentiment.positive).toEqual({ calls: 1, won: 1 });
    expect(q.bySentiment.negative).toEqual({ calls: 1, won: 0 });
  });

  it('is all-zero and rate-safe on empty input', () => {
    const q = summarizeQuality([]);
    expect(q.total).toBe(0);
    expect(q.negativeRate).toBe(0);
    expect(q.poorOutcomeRate).toBe(0);
    expect(q.sentimentCounts.unknown).toBe(0);
  });
});
