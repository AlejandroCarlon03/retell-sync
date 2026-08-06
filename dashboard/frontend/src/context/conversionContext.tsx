/**
 * Shares one `useConversion()` load across every page. Without this, each routed
 * page would mount its own hook and refetch `/api/conversion` on navigation; the
 * provider fetches once and all pages read the same `{ data, loading, error,
 * reload }` state.
 */
import { createContext, useContext, type ReactNode } from 'react';

import { useConversion, type UseConversionState } from '../hooks/useConversion';

const ConversionContext = createContext<UseConversionState | null>(null);

export function ConversionProvider({ children }: { children: ReactNode }) {
  const state = useConversion();
  return <ConversionContext.Provider value={state}>{children}</ConversionContext.Provider>;
}

/** Read the shared conversion state. Throws if used outside the provider. */
export function useConversionData(): UseConversionState {
  const ctx = useContext(ConversionContext);
  if (!ctx) throw new Error('useConversionData must be used within a ConversionProvider');
  return ctx;
}
