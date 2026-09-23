import type { ModelCatalogModel } from "@openmeld/schemas/types";

export type ModelRetirementContext = {
  agentControllerRef: string;
  authType?: string | null;
  providerId?: string | null;
};

export type ModelAvailabilityDecision =
  | { available: true }
  | {
      available: false;
      reasonCode: "model.retired" | "model.unavailable";
      message: string;
    };

/** Unknown account/provider evidence cannot establish a scoped withdrawal. */
export function matchesModelRetirementScope(
  notice: NonNullable<ModelCatalogModel["retirement"]>,
  context: ModelRetirementContext
): boolean {
  return (
    notice.scope.controllerRef === context.agentControllerRef &&
    (!notice.scope.authType || notice.scope.authType === context.authType) &&
    (!notice.scope.providerId || notice.scope.providerId === context.providerId)
  );
}

/** Deliberately has no clock: only a reviewed withdrawal can block a model. */
export function resolveModelAvailability(
  model: ModelCatalogModel | null | undefined,
  context: ModelRetirementContext
): ModelAvailabilityDecision {
  if (
    model?.retirement?.status === "withdrawn" &&
    matchesModelRetirementScope(model.retirement, context)
  ) {
    return {
      available: false,
      reasonCode: "model.retired",
      message:
        "This model is no longer offered. Change this agent's model to continue.",
    };
  }
  if (!model || model.unavailable) {
    return {
      available: false,
      reasonCode: "model.unavailable",
      message: "This model is unavailable. Check this agent's model settings.",
    };
  }
  return { available: true };
}

/** Date-only facts are formatted in UTC, never shifted by the viewer's zone. */
export function formatModelRetirementNotice(
  notice: NonNullable<ModelCatalogModel["retirement"]>
): string {
  let scope = notice.scope.providerId
    ? ` through ${notice.scope.providerId}`
    : "";
  if (notice.scope.authType) {
    const label =
      notice.scope.authType === "chatgpt" ? "ChatGPT" : notice.scope.authType;
    scope += ` with ${label} sign-in`;
  }
  if (notice.status === "withdrawn") {
    return `No longer offered${scope}. Choose another model.`;
  }
  if (!notice.date) {
    return `Retirement announced${scope}. The date is not confirmed.`;
  }
  const date = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${notice.date.value}T00:00:00Z`));
  return notice.date.kind === "not_before"
    ? `Will not retire before ${date}${scope}. No stop date is confirmed.`
    : `Retirement announced for ${date}${scope}. Consider changing models.`;
}
