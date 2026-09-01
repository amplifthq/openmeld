import type { AgentControllerInterfaceAuthSnapshot } from "@openmeld/schemas/types";

const CONTROLLER_SIGN_IN_REASON_CODES = new Set([
  "controller.auth.unauthenticated",
  "provider_account.access_required",
]);

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

export function hasOnlyAgentControllerSignInReasonCodes(
  reasonCodes: readonly string[]
): boolean {
  return (
    reasonCodes.includes("controller.auth.unauthenticated") &&
    reasonCodes.every((reasonCode) =>
      CONTROLLER_SIGN_IN_REASON_CODES.has(reasonCode)
    )
  );
}

function normalizeProviderAccountEmail(
  value: string | undefined
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}
