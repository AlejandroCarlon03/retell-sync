/**
 * Theme selection: 'system' (follow the OS via prefers-color-scheme), 'light',
 * or 'dark'. A non-system choice stamps `data-theme` on <html>, which the token
 * CSS honours over the media query. Persisted so the window reopens as chosen.
 */
import { useCallback, useEffect, useState } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const STORAGE_KEY = 'retell-sync-theme';

function readStored(): ThemeChoice {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

function apply(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') {
    root.removeAttribute('data-theme');
  } else {
    root.setAttribute('data-theme', choice);
  }
}

export function useTheme(): {
  choice: ThemeChoice;
  cycle: () => void;
  set: (choice: ThemeChoice) => void;
} {
  const [choice, setChoice] = useState<ThemeChoice>(readStored);

  useEffect(() => {
    apply(choice);
    localStorage.setItem(STORAGE_KEY, choice);
  }, [choice]);

  const cycle = useCallback(() => {
    setChoice((c) => (c === 'system' ? 'light' : c === 'light' ? 'dark' : 'system'));
  }, []);

  const set = useCallback((next: ThemeChoice) => setChoice(next), []);

  return { choice, cycle, set };
}
