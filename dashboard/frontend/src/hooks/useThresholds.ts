/**
 * Live KPI-threshold state: loads the persisted config on mount and writes any
 * edit straight back to localStorage, so changing a boundary re-renders every
 * badge immediately and the tuned set survives a reopen. Mirrors `useTheme`.
 */
import { useCallback, useState } from 'react';

import {
  DEFAULT_THRESHOLDS,
  loadThresholds,
  saveThresholds,
  type KpiMetricKey,
  type ThresholdConfig,
  type ThresholdRule,
} from '../lib/thresholds';

export interface UseThresholdsState {
  config: ThresholdConfig;
  /** Replace one metric's rule (e.g. from the editor). Persists immediately. */
  setRule: (key: KpiMetricKey, rule: ThresholdRule) => void;
  /** Restore the shipped defaults. */
  reset: () => void;
}

export function useThresholds(): UseThresholdsState {
  const [config, setConfig] = useState<ThresholdConfig>(loadThresholds);

  const persist = useCallback((next: ThresholdConfig) => {
    setConfig(next);
    saveThresholds(next);
  }, []);

  const setRule = useCallback(
    (key: KpiMetricKey, rule: ThresholdRule) => {
      persist({ ...config, [key]: rule });
    },
    [config, persist],
  );

  const reset = useCallback(() => {
    persist({ ...DEFAULT_THRESHOLDS });
  }, [persist]);

  return { config, setRule, reset };
}
