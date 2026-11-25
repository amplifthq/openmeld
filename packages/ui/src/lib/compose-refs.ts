import type { Ref, RefObject } from "react";

/**
 * Returns one callback ref that forwards the node to every provided ref.
 *
 * The composed ref returns a cleanup, so React calls it instead of passing
 * `null` on detach. Cleanups returned by React 19 callback refs run then;
 * other callback refs receive `null` and object refs are reset.
 */
export function composeRefs<T>(...refs: (Ref<T> | undefined)[]): Ref<T> {
  return (node: T | null) => {
    const cleanups: (() => void)[] = [];
    for (const ref of refs) {
      if (typeof ref === "function") {
        const cleanup = ref(node);
        cleanups.push(
          typeof cleanup === "function" ? cleanup : () => ref(null)
        );
      } else if (ref) {
        (ref as RefObject<T | null>).current = node;
        cleanups.push(() => {
          (ref as RefObject<T | null>).current = null;
        });
      }
    }
    return () => {
      for (const cleanup of cleanups) {
        cleanup();
      }
    };
  };
}
