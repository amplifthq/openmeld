import type { ProfileKind } from "@openmeld/protocol";

export function toProfileKind(value: unknown): ProfileKind | null {
  if (value === "human" || value === "agent" || value === "system") {
    return value;
  }
  return null;
}
