import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_THRESHOLDS,
  METRIC_KEYS,
  evaluateStatus,
  loadThresholds,
  saveThresholds,
  statusLabel,
  type ThresholdConfig,
  type ThresholdRule,
} from './thresholds';

const higher: ThresholdRule = { direction: 'higher-better', healthy: 50, warning: 20 };
const lower: ThresholdRule = { direction: 'lower-better', healthy: 5, warning: 15 };

describe('evaluateStatus (higher-better)', () => {
  it('is healthy at or above the healthy line', () => {
    expect(evaluateStatus(50, higher)).toBe('healthy');
    expect(evaluateStatus(80, higher)).toBe('healthy');
  });
  it('is warning between the two lines (inclusive of warning)', () => {
    expect(evaluateStatus(20, higher)).toBe('warning');
    expect(evaluateStatus(49.99, higher)).toBe('warning');
  });
  it('is critical below the warning line', () => {
    expect(evaluateStatus(19.99, higher)).toBe('critical');
    expect(evaluateStatus(0, higher)).toBe('critical');
  });
});

describe('evaluateStatus (lower-better)', () => {
  it('flips the comparisons', () => {
    expect(evaluateStatus(5, lower)).toBe('healthy');
    expect(evaluateStatus(0, lower)).toBe('healthy');
    expect(evaluateStatus(15, lower)).toBe('warning');
    expect(evaluateStatus(15.01, lower)).toBe('critical');
  });
});

describe('evaluateStatus (missing values)', () => {
  it('has no status for null/undefined/NaN', () => {
    expect(evaluateStatus(null, higher)).toBeNull();
    expect(evaluateStatus(undefined, higher)).toBeNull();
    expect(evaluateStatus(Number.NaN, higher)).toBeNull();
    expect(evaluateStatus(Infinity, lower)).toBeNull(); // non-finite is guarded out
  });
});

describe('statusLabel', () => {
  it('maps each status to a capitalised word', () => {
    expect(statusLabel('healthy')).toBe('Healthy');
    expect(statusLabel('warning')).toBe('Warning');
    expect(statusLabel('critical')).toBe('Critical');
  });
});

describe('persistence', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('returns defaults when nothing is stored', () => {
    expect(loadThresholds()).toEqual(DEFAULT_THRESHOLDS);
  });

  it('round-trips a saved config', () => {
    const custom: ThresholdConfig = {
      ...DEFAULT_THRESHOLDS,
      dollars_per_after_hours_call: { direction: 'higher-better', healthy: 99, warning: 42 },
    };
    saveThresholds(custom);
    expect(loadThresholds()).toEqual(custom);
  });

  it('merges a partial stored blob over the defaults', () => {
    localStorage.setItem(
      'retell-sync-thresholds',
      JSON.stringify({ after_hours_new_clients: { direction: 'higher-better', healthy: 7, warning: 2 } }),
    );
    const cfg = loadThresholds();
    expect(cfg.after_hours_new_clients).toEqual({ direction: 'higher-better', healthy: 7, warning: 2 });
    expect(cfg.dollars_per_after_hours_call).toEqual(DEFAULT_THRESHOLDS.dollars_per_after_hours_call);
  });

  it('ignores malformed rules and falls back to defaults', () => {
    localStorage.setItem(
      'retell-sync-thresholds',
      JSON.stringify({ dollars_per_after_hours_call: { direction: 'sideways', healthy: 'x' } }),
    );
    expect(loadThresholds().dollars_per_after_hours_call).toEqual(
      DEFAULT_THRESHOLDS.dollars_per_after_hours_call,
    );
  });

  it('survives corrupt JSON', () => {
    localStorage.setItem('retell-sync-thresholds', '{not json');
    expect(loadThresholds()).toEqual(DEFAULT_THRESHOLDS);
  });

  it('covers every metric key in the defaults', () => {
    for (const key of METRIC_KEYS) expect(DEFAULT_THRESHOLDS[key]).toBeDefined();
  });
});

describe('saveThresholds is non-fatal', () => {
  it('swallows a throwing setItem', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(() => saveThresholds(DEFAULT_THRESHOLDS)).not.toThrow();
    spy.mockRestore();
  });
});
