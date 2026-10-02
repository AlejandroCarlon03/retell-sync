/**
 * `useFilteredData` — the single seam every page reads instead of the raw
 * conversion context. It takes the loaded payload and the active date range,
 * filters `by_call` to the range, and recomputes `kpis` and `funnel` from that
 * subset (see `lib/kpis.ts`) so the tiles, executive summary, funnel and tables
 * all describe the same window. When the range is unbounded ("All time") the
 * server's own `kpis`/`funnel` are used as-is — no recompute, so the default view
 * is byte-for-byte what the Python pipeline wrote.
 *
 * The returned `data` keeps the `ConversionPayload` shape, so a page migrates
 * from `useConversionData()` to `useFilteredData()` by changing one import — no
 * prop plumbing.
 */
import { useMemo } from 'react';

import { useConversionData } from '../context/conversionContext';
import { useDateRange } from '../context/dateRangeContext';
import { filterCalls, isUnbounded } from '../lib/dateRange';
import { buildFunnel, computeKpis } from '../lib/kpis';
import type { CallRow, ConversionPayload } from '../types/conversion';
import type { DateRange } from '../lib/dateRange';

/**
 * Stable empty fallback for `data?.by_call ?? NO_CALLS`. A fresh `[]` literal is a
 * new array every render, which defeats any `useMemo` keyed on it before data loads.
 */
export const NO_CALLS: CallRow[] = [];

export interface FilteredData {
  /** The payload narrowed to `range`: filtered by_call, recomputed kpis + funnel. */
  data: ConversionPayload | null;
  /** The active resolved range, for headers/empty states. */
  range: DateRange;
  /** True when the active range yields no calls (page can show an empty note). */
  isEmpty: boolean;
}

export function useFilteredData(): FilteredData {
  const { data } = useConversionData();
  const { range } = useDateRange();

  return useMemo(() => {
    if (!data) return { data: null, range, isEmpty: true };
    if (isUnbounded(range)) {
      return { data, range, isEmpty: data.by_call.length === 0 };
    }

    const by_call = filterCalls(data.by_call, range);
    const order = data.funnel.map((s) => s.stage);
    const filtered: ConversionPayload = {
      ...data,
      by_call,
      kpis: computeKpis(by_call),
      funnel: buildFunnel(by_call, order),
    };
    return { data: filtered, range, isEmpty: by_call.length === 0 };
  }, [data, range]);
}
