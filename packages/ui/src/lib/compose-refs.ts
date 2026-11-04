import type { Ref, RefObject } from "react";

/** Returns one callback ref that forwards the node to every provided ref. */
export function composeRefs<T>(...refs: (Ref<T> | undefined)[]): Ref<T> {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        (ref as RefObject<T | null>).current = node;
      }
    }
  };
}
