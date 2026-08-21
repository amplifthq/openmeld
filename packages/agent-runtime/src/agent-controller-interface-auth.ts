import type { AgentControllerInterfaceAuthSnapshot } from "@openmeld/schemas/types";

export function areAgentControllerInterfaceAccountsSame(
  current: AgentControllerInterfaceAuthSnapshot | null | undefined,
  next: AgentControllerInterfaceAuthSnapshot | null | undefined
): boolean {
  if (current?.status !== "authenticated" || next?.status !== "authenticated") {
    return false;
  }

  const currentEmail = normalizeProviderAccountEmail(current.email);
  const nextEmail = normalizeProviderAccountEmail(next.email);
  return currentEmail !== null && currentEmail === nextEmail;
}

function normalizeProviderAccountEmail(
  value: string | undefined
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}
