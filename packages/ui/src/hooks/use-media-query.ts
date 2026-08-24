import { useCallback, useSyncExternalStore } from "react";

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => subscribeMediaQuery(query, onStoreChange),
    [query]
  );
  const getSnapshot = useCallback(() => getMediaQuerySnapshot(query), [query]);

  return useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerMediaQuerySnapshot
  );
}

function subscribeMediaQuery(
  query: string,
  onStoreChange: () => void
): () => void {
  const mediaQuery = window.matchMedia?.(query);
  if (!mediaQuery) {
    return () => undefined;
  }
  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", onStoreChange);
    return () => mediaQuery.removeEventListener("change", onStoreChange);
  }

  mediaQuery.addListener(onStoreChange);
  return () => mediaQuery.removeListener(onStoreChange);
}

function getMediaQuerySnapshot(query: string): boolean {
  return window.matchMedia?.(query).matches ?? false;
}

function getServerMediaQuerySnapshot(): boolean {
  return false;
}
