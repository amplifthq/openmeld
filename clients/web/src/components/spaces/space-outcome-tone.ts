import type { StatusTone } from "@openmeld/ui/lib/status-tone";

export type SpaceOutcomeRowTone = "destructive" | "muted" | "warning";

export type SpaceOutcomeToneInput = {
	failureStage?: "execution" | "publication" | null;
	noticeType: string | null;
	reasonCode?: string | null;
};

/**
 * The shared semantic tone decision for every Space outcome surface:
 * - `wake_stopped` is muted because a stop is not a failure.
 * - Organization Wake-access failures are warning configuration outcomes.
 * - Publication failures are warnings because execution already completed.
 * - Every other terminal failure is a destructive execution failure.
 */
export function resolveSpaceOutcomeRowTone(
	input: SpaceOutcomeToneInput
): SpaceOutcomeRowTone {
	if (input.noticeType === "wake_stopped") {
		return "muted";
	}
	if (input.reasonCode?.startsWith("organization_binding_authorization.")) {
		return "warning";
	}
	return input.failureStage === "publication" ? "warning" : "destructive";
}

export function resolveSpaceOutcomeStatusTone(
	input: SpaceOutcomeToneInput
): StatusTone {
	const tone = resolveSpaceOutcomeRowTone(input);
	return tone === "destructive" ? "danger" : tone;
}
