/** A presentation-only selection, with notifications limited to changed items. */
export function createActiveItemStore<T>(initial: T | null = null) {
  let active = initial;
  const listeners = new Map<T, Set<() => void>>();
  return {
    isActive: (item: T | null) => item !== null && item === active,
    subscribe(item: T | null, callback: () => void) {
      if (item === null) {
        return () => undefined;
      }
      const subscribers = listeners.get(item) ?? new Set<() => void>();
      listeners.set(item, subscribers);
      subscribers.add(callback);
      return () => {
        subscribers.delete(callback);
        if (!subscribers.size) {
          listeners.delete(item);
        }
      };
    },
    set(item: T | null) {
      if (item === active) {
        return;
      }
      const previous = active;
      active = item;
      for (const target of [previous, item]) {
        if (target !== null) {
          for (const callback of listeners.get(target) ?? []) {
            callback();
          }
        }
      }
    },
  };
}
