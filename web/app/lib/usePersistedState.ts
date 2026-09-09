"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * UI-state persistence: a localStorage-backed useState.
 *
 * - SSR-safe: the server render and the first client render both use
 *   `initial`; the persisted value is hydrated in an effect afterwards,
 *   so hydration never mismatches.
 * - Validates what it reads: a `validate` type-guard discards corrupted or
 *   stale entries (e.g. a saved tab that no longer exists) instead of
 *   crashing the dashboard.
 * - Cross-tab sync: two open dashboards stay in step via the `storage` event.
 */
const PREFIX = "fabrich.ui.";

export function usePersistedState<T>(
  key: string,
  initial: T,
  validate?: (value: unknown) => value is T,
): [T, (value: T | ((prev: T) => T)) => void] {
  const fullKey = PREFIX + key;
  const [value, setValue] = useState<T>(initial);

  // Keep the validator in a ref so callers can pass inline lambdas without
  // re-triggering the hydration effect every render.
  const validateRef = useRef(validate);
  validateRef.current = validate;

  const accept = useCallback(
    (raw: string | null): T | null => {
      if (raw == null) return null;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (validateRef.current) {
          return validateRef.current(parsed) ? (parsed as T) : null;
        }
        return parsed === null || parsed === undefined ? null : (parsed as T);
      } catch {
        return null; // corrupted entry — fall back to initial
      }
    },
    [],
  );

  // Hydrate after mount (SSR-safe).
  useEffect(() => {
    const hydrated = accept(window.localStorage.getItem(fullKey));
    if (hydrated !== null) setValue(hydrated);
  }, [fullKey, accept]);

  // Sync when another tab changes the value.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== fullKey) return;
      if (e.newValue == null) {
        setValue(initial); // cleared elsewhere — follow suit
        return;
      }
      const synced = accept(e.newValue);
      if (synced !== null) setValue(synced);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey, accept]);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(fullKey, JSON.stringify(resolved));
        } catch {
          /* storage full / private mode — state still works in-memory */
        }
        return resolved;
      });
    },
    [fullKey],
  );

  return [value, set];
}

export default usePersistedState;
