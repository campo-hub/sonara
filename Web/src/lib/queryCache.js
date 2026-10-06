import { useCallback, useEffect, useSyncExternalStore } from 'react';

export function createQueryCache({ now = Date.now } = {}) {
  const entries = new Map();

  const getEntry = (key) => {
    if (!entries.has(key)) {
      entries.set(key, {
        invalidated: true,
        listeners: new Set(),
        promise: null,
        snapshot: { data: undefined, error: null, status: 'idle', updatedAt: 0, isFetching: false }
      });
    }
    return entries.get(key);
  };

  const notify = (entry) => {
    for (const listener of entry.listeners) listener();
  };

  return {
    getSnapshot(key) {
      return getEntry(key).snapshot;
    },

    subscribe(key, listener) {
      const entry = getEntry(key);
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },

    fetchQuery(key, fetcher, { staleTime = 0, force = false } = {}) {
      const entry = getEntry(key);
      if (entry.promise) return entry.promise;
      if (!force && !entry.invalidated && entry.snapshot.data !== undefined && now() - entry.snapshot.updatedAt < staleTime) {
        return Promise.resolve(entry.snapshot.data);
      }

      entry.snapshot = {
        ...entry.snapshot,
        error: null,
        status: entry.snapshot.data === undefined ? 'loading' : 'success',
        isFetching: true
      };
      notify(entry);

      entry.promise = Promise.resolve()
        .then(fetcher)
        .then((data) => {
          entry.invalidated = false;
          entry.snapshot = { data, error: null, status: 'success', updatedAt: now(), isFetching: false };
          return data;
        }, (error) => {
          entry.snapshot = {
            ...entry.snapshot,
            error,
            status: entry.snapshot.data === undefined ? 'error' : 'success',
            isFetching: false
          };
          throw error;
        })
        .finally(() => {
          entry.promise = null;
          notify(entry);
        });

      return entry.promise;
    },

    invalidate(key) {
      if (key === undefined) {
        for (const entry of entries.values()) {
          entry.invalidated = true;
          entry.snapshot = { ...entry.snapshot, updatedAt: 0 };
          notify(entry);
        }
        return;
      }
      const entry = getEntry(key);
      entry.invalidated = true;
      entry.snapshot = { ...entry.snapshot, updatedAt: 0 };
      notify(entry);
    },

    clear() {
      entries.clear();
    }
  };
}

export const queryCache = createQueryCache();

export function useCachedQuery(key, fetcher, { staleTime = 0, enabled = true } = {}) {
  const subscribe = useCallback((listener) => queryCache.subscribe(key, listener), [key]);
  const getSnapshot = useCallback(() => queryCache.getSnapshot(key), [key]);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (enabled) queryCache.fetchQuery(key, fetcher, { staleTime }).catch(() => {});
  }, [enabled, fetcher, key, staleTime]);

  const refetch = useCallback(() => queryCache.fetchQuery(key, fetcher, { staleTime, force: true }), [fetcher, key, staleTime]);
  return { ...snapshot, refetch };
}