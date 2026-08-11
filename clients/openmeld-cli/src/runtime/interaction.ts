import type { RuntimeContext } from "./types";

export function canUseInteractivePrompts(context: RuntimeContext): boolean {
  return context.resolvedView === "human" && context.interactive;
}
