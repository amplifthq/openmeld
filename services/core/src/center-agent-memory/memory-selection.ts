import type { CenterAgentMemoryRead } from "./contract";

/** Preserve rank within each scope without treating provider scores as comparable. */
export function interleaveMemoryScopes<T>(
  scopes: readonly (readonly T[])[]
): T[] {
  const result: T[] = [];
  const ranks = Math.max(0, ...scopes.map((scope) => scope.length));
  for (let rank = 0; rank < ranks; rank += 1) {
    for (const scope of scopes) {
      const item = scope[rank];
      if (item !== undefined) {
        result.push(item);
      }
    }
  }
  return result;
}

export function combineMemoryReadStatus(
  statuses: CenterAgentMemoryRead<unknown>["status"][]
): CenterAgentMemoryRead<unknown>["status"] {
  if (statuses.every((status) => status === "complete")) {
    return "complete";
  }
  return statuses.every((status) => status === "unavailable")
    ? "unavailable"
    : "partial";
}
