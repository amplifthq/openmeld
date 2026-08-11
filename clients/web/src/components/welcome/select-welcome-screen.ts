import type { OnboardingPlan } from "@openmeld/schemas/types";

/**
 * Which first-run screen the org-scoped first-run flow shows, derived purely from
 * the shared onboarding plan. The plan is the single source of truth: first-run
 * never re-derives onboarding rules, it only reads the decisions the engine
 * already emitted.
 *
 * - "name": the account has no usable display name yet (`set_display_name`
 *   available) — the @-mention / addressing label must be set first.
 * - "space": the account is named but has no place to work yet (`enter_space`
 *   available) — choose where to work.
 * - "done": neither is actionable, so first-run has nothing to ask and the
 *   caller should leave the flow.
 *
 * Order matches the plan's own gate order (name is a blocker before space), so a
 * name-missing plan resolves to "name" even though `enter_space` is absent.
 */
export type WelcomeScreen = "name" | "space" | "done";

function isActionable(
	plan: OnboardingPlan,
	id: OnboardingPlan["decisions"][number]["id"]
): boolean {
	return plan.decisions.some(
		(decision) => decision.id === id && decision.status === "available"
	);
}

export function selectWelcomeScreen(plan: OnboardingPlan): WelcomeScreen {
	if (isActionable(plan, "set_display_name")) {
		return "name";
	}
	if (isActionable(plan, "enter_space")) {
		return "space";
	}
	return "done";
}
