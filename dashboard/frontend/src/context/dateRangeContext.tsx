/**
 * Holds the dashboard-wide date-range selection (the preset plus, for the custom
 * preset, the picked from/to dates) and resolves it into a concrete interval
 * against the loaded report's `generated_at`. One provider, so every page and the
 * header filter read and write the same selection — switching the range on any
 * page refreshes the whole dashboard consistently.
 *
 * This provider sits *inside* ConversionProvider so it can anchor relative ranges
 * to the report timestamp (see `lib/dateRange.ts`). It only stores the selection;
 * turning it into filtered data + recomputed KPIs is `useFilteredData`'s job.
 */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

import { useConversionData } from './conversionContext';
import {
  resolveRange,
  type CustomBounds,
  type DateRange,
  type RangePreset,
} from '../lib/dateRange';

interface DateRangeState {
  preset: RangePreset;
  setPreset: (preset: RangePreset) => void;
  custom: CustomBounds;
  setCustom: (custom: CustomBounds) => void;
  /** The selection resolved to an absolute `[from, to)` interval. */
  range: DateRange;
}

const DateRangeContext = createContext<DateRangeState | null>(null);

export function DateRangeProvider({ children }: { children: ReactNode }) {
  const { data } = useConversionData();
  const [preset, setPreset] = useState<RangePreset>('all');
  const [custom, setCustom] = useState<CustomBounds>({});

  const range = useMemo(
    () => resolveRange(preset, data?.generated_at, custom),
    [preset, data?.generated_at, custom],
  );

  const value = useMemo(
    () => ({ preset, setPreset, custom, setCustom, range }),
    [preset, custom, range],
  );

  return <DateRangeContext.Provider value={value}>{children}</DateRangeContext.Provider>;
}

/** Read the shared date-range selection. Throws if used outside the provider. */
export function useDateRange(): DateRangeState {
  const ctx = useContext(DateRangeContext);
  if (!ctx) throw new Error('useDateRange must be used within a DateRangeProvider');
  return ctx;
}
