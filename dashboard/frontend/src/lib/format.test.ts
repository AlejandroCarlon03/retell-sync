import { describe, expect, it } from 'vitest';

import {
  EMPTY,
  afterHoursLabel,
  formatCount,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatPercent,
  outcomeLabel,
} from './format';

describe('formatCurrency', () => {
  it('formats whole dollars with separators', () => {
    expect(formatCurrency(3848.4848)).toBe('$3,848');
    expect(formatCurrency(0)).toBe('$0');
  });
  it('returns em dash for null/NaN', () => {
    expect(formatCurrency(null)).toBe(EMPTY);
    expect(formatCurrency(undefined)).toBe(EMPTY);
    expect(formatCurrency(Number.NaN)).toBe(EMPTY);
  });
});

describe('formatPercent', () => {
  it('renders a 0..1 fraction as a percent', () => {
    expect(formatPercent(0.121212)).toBe('12.1%');
    expect(formatPercent(1)).toBe('100.0%');
    expect(formatPercent(0)).toBe('0.0%');
  });
  it('returns em dash for null', () => {
    expect(formatPercent(null)).toBe(EMPTY);
  });
});

describe('formatCount', () => {
  it('rounds and separates', () => {
    expect(formatCount(1234)).toBe('1,234');
  });
  it('returns em dash for null', () => {
    expect(formatCount(null)).toBe(EMPTY);
  });
});

describe('formatDuration', () => {
  it('formats seconds as m:ss', () => {
    expect(formatDuration(125.4)).toBe('2:05');
    expect(formatDuration(9)).toBe('0:09');
  });
  it('returns em dash for null', () => {
    expect(formatDuration(null)).toBe(EMPTY);
  });
});

describe('formatDateTime', () => {
  it('returns em dash for empty', () => {
    expect(formatDateTime(null)).toBe(EMPTY);
    expect(formatDateTime('')).toBe(EMPTY);
  });
  it('passes through an unparseable string', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
  it('formats a valid ISO timestamp', () => {
    expect(formatDateTime('2026-08-04T12:00:00Z')).not.toBe(EMPTY);
  });
});

describe('afterHoursLabel (tri-state)', () => {
  it('distinguishes all three states', () => {
    expect(afterHoursLabel(true)).toBe('after-hours');
    expect(afterHoursLabel(false)).toBe('business');
    expect(afterHoursLabel(null)).toBe('unknown');
    expect(afterHoursLabel(undefined)).toBe('unknown');
  });
});

describe('outcomeLabel', () => {
  it('maps won/lost/open', () => {
    expect(outcomeLabel(true, false)).toBe('won');
    expect(outcomeLabel(false, true)).toBe('lost');
    expect(outcomeLabel(false, false)).toBe('open');
  });
});
