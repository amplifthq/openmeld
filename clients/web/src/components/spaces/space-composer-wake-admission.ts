import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
	createSpaceTargetCatalog,
	SpaceComposerSubmissionError,
} from "@openmeld/space";

const WAKEABILITY_CHECK_FAILED_MESSAGE =
	"OpenMeld couldn't confirm that this agent can reply right now. Try again.";

export async function requireCurrentSpaceComposerWakeAdmission(input: {
	agentProfileIds: readonly string[];
	readCurrentMembers: () => Promise<SpaceMembersSnapshot | null>;
}): Promise<void> {
	const agentProfileIds = normalizeAgentProfileIds(input.agentProfileIds);
	if (agentProfileIds.length === 0) {
		return;
	}

	let membersSnapshot: SpaceMembersSnapshot | null;
	try {
		membersSnapshot = await input.readCurrentMembers();
	} catch {
		throw createWakeBlockedError(WAKEABILITY_CHECK_FAILED_MESSAGE);
	}
	if (!membersSnapshot) {
		throw createWakeBlockedError(WAKEABILITY_CHECK_FAILED_MESSAGE);
	}
	const targetCatalog = createSpaceTargetCatalog(membersSnapshot);

	for (const agentProfileId of agentProfileIds) {
		const target = targetCatalog.byProfileId.get(agentProfileId);
		if (!target || target.profileKind !== "agent") {
			throw createWakeBlockedError(WAKEABILITY_CHECK_FAILED_MESSAGE);
		}
		if (target.wakeAvailability.status === "ready") {
			continue;
		}

		throw createWakeBlockedError(
			normalizeMessage(target.wakeAvailability.reasonText) ??
				WAKEABILITY_CHECK_FAILED_MESSAGE,
			agentProfileId
		);
	}
}

function normalizeAgentProfileIds(profileIds: readonly string[]): string[] {
	const normalizedProfileIds = new Set<string>();
	for (const profileId of profileIds) {
		const normalizedProfileId = profileId.trim();
		if (normalizedProfileId) {
			normalizedProfileIds.add(normalizedProfileId);
		}
	}
	return [...normalizedProfileIds];
}

function normalizeMessage(value: string | null | undefined): string | null {
	const normalized = value?.trim() ?? "";
	return normalized.length > 0 ? normalized : null;
}

function createWakeBlockedError(
	message: string,
	targetProfileId?: string
): SpaceComposerSubmissionError {
	return new SpaceComposerSubmissionError({
		code: "addressing.wake_blocked",
		message,
		targetProfileId,
	});
}
