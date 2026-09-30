import type {
	LocalCliComponentUpdateProjection,
	LocalServiceComponentUpdateProjection,
} from "@openmeld/schemas/types";
import type { SetupFlowMode } from "@openmeld/start";
import { isOpenMeldToolsComponentUpdateActionable } from "#/lib/openmeld-tools-update";

export const SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE =
	"Couldn't verify the update";

export type ServiceUpdateVerificationStatus =
	| "confirmed"
	| "confirming"
	| "not_applicable"
	| "timed_out";

export type ServiceUpdateVerificationState = {
	cli: LocalCliComponentUpdateProjection | null;
	service: LocalServiceComponentUpdateProjection | null;
	status: ServiceUpdateVerificationStatus;
};

// update_service completion must mean more than "the terminal session
// reported the setup steps finished" -- that only proves the CLI ran to
// completion, not that the daemon actually reconnected and reported the
// current OpenMeld Service/CLI version. This combines the terminal-complete
// signal with the same local-components update projection Settings Computers
// reads, so a stale release channel cannot present a false "Update complete"
// checkmark. Non-update_service setup is always "not_applicable" and keeps
// its existing terminal-complete-only behavior unchanged.
export function resolveServiceUpdateVerificationState(input: {
	cli: LocalCliComponentUpdateProjection | null | undefined;
	elapsedSinceCompletionMs: number | null;
	mode: SetupFlowMode;
	service: LocalServiceComponentUpdateProjection | null | undefined;
	timeoutMs: number;
}): ServiceUpdateVerificationState {
	const cli = input.cli ?? null;
	const service = input.service ?? null;
	if (
		input.mode !== "update_service" ||
		input.elapsedSinceCompletionMs === null
	) {
		return { cli, service, status: "not_applicable" };
	}

	// A readiness projection that has never arrived (cold-loaded page, the
	// query still has no data) must not be mistaken for one that proves the
	// update landed. isServiceUpdateStillRequired treats missing cli/service
	// data the same as "still required" so it falls through to the same
	// confirming/timed_out timeout logic below instead of defaulting to a
	// false "confirmed".
	if (!isServiceUpdateStillRequired(cli, service)) {
		return { cli, service, status: "confirmed" };
	}
	if (input.elapsedSinceCompletionMs >= input.timeoutMs) {
		return { cli, service, status: "timed_out" };
	}
	return { cli, service, status: "confirming" };
}

// Single source of truth for "does this update still need to be verified,"
// shared by the pure state resolver above and the
// useServiceUpdateVerification hook in start-bring-agents-setup-page.tsx,
// which uses it to decide whether to arm the refetch-interval/timeout
// watchdog. A readiness projection that has never arrived (cli or service
// still null/undefined), an optional update, or an unknown version counts
// as unresolved, exactly like update_required. Each must
// keep the watchdog running instead of quietly doing nothing forever.
export function isServiceUpdateStillRequired(
	cli: LocalCliComponentUpdateProjection | null | undefined,
	service: LocalServiceComponentUpdateProjection | null | undefined
): boolean {
	return (
		cli?.status !== "current" ||
		service?.status !== "current" ||
		cli.wakeBlocked ||
		service.wakeBlocked ||
		!cli.installedPackageVersion?.trim() ||
		!service.installedVersion?.trim()
	);
}

export function formatServiceUpdateVerificationFailureDetail(
	input: ServiceUpdateVerificationState
): string {
	const outdatedComponentSentences = [
		formatOutdatedComponentSentence({
			installedVersion: input.service?.installedVersion ?? null,
			isOutdated: isOpenMeldToolsComponentUpdateActionable(input.service),
			label: "OpenMeld Service",
			requiredVersion:
				input.service?.latestVersion ?? input.service?.requiredVersion ?? null,
		}),
		formatOutdatedComponentSentence({
			installedVersion: input.cli?.installedPackageVersion ?? null,
			isOutdated: isOpenMeldToolsComponentUpdateActionable(input.cli),
			label: "OpenMeld CLI",
			requiredVersion: input.cli?.latestPackageVersion ?? null,
		}),
	].filter((sentence): sentence is string => sentence !== null);
	const versionSentence =
		outdatedComponentSentences.length > 0
			? outdatedComponentSentences.join(" ")
			: "Could not confirm the installed OpenMeld Service and CLI versions.";

	return `${versionSentence} Check this computer's connection and update status before trying again.`;
}

export function formatServiceUpdateVerificationSuccessDetail(
	input: ServiceUpdateVerificationState
): string | null {
	if (
		input.status !== "confirmed" ||
		isServiceUpdateStillRequired(input.cli, input.service)
	) {
		return null;
	}
	return `Update complete. This computer now reports v${input.service?.installedVersion}.`;
}

function formatOutdatedComponentSentence(input: {
	installedVersion: string | null;
	isOutdated: boolean;
	label: string;
	requiredVersion: string | null;
}): string | null {
	if (!input.isOutdated) {
		return null;
	}
	const installed = input.installedVersion
		? `v${input.installedVersion}`
		: "an unreported version";
	const required = input.requiredVersion
		? `v${input.requiredVersion}`
		: "a newer version";
	return `This computer reports ${input.label} ${installed}; its update status still calls for ${required}.`;
}

