import { MAX_WAKE_DEVICE_WAIT_MS } from "@openmeld/schemas";
import type {
	SpaceMembersSnapshot,
	WakeDeviceWait,
} from "@openmeld/schemas/types";
import {
	createSpaceTargetCatalog,
	SpaceComposerSubmissionError,
} from "@openmeld/space";

const WAKEABILITY_CHECK_FAILED_MESSAGE =
	"OpenMeld couldn't confirm that this agent can reply right now. Try again.";

export async function requireCurrentSpaceComposerWakeAdmission(input: {
	agentProfileIds: readonly string[];
	deviceWait?: WakeDeviceWait;
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
	if (input.deviceWait) {
		const wait = input.deviceWait;
		const member = membersSnapshot.agents.find(
			(candidate) => candidate.profileId === wait.targetProfileId
		);
		if (
			!(
				agentProfileIds.includes(wait.targetProfileId) &&
				member?.deviceWaitTarget
			) ||
			member.deviceWaitTarget.bindingId !== wait.bindingId ||
			member.deviceWaitTarget.openMeldServiceRuntimeId !==
				wait.openMeldServiceRuntimeId ||
			wait.deadlineAtMs <= Date.now() ||
			wait.deadlineAtMs > Date.now() + MAX_WAKE_DEVICE_WAIT_MS
		) {
			throw createWakeBlockedError(
				"The selected computer or deadline changed. Choose the waiting option again.",
				wait.targetProfileId
			);
		}
	}

	for (const agentProfileId of agentProfileIds) {
		const target = targetCatalog.byProfileId.get(agentProfileId);
		if (!target || target.profileKind !== "agent") {
			throw createWakeBlockedError(WAKEABILITY_CHECK_FAILED_MESSAGE);
		}
		if (
			target.wakeAvailability.status === "ready" ||
			target.wakeAvailability.status === "preparing"
		) {
			continue;
		}
		const member = membersSnapshot.agents.find(
			(candidate) => candidate.profileId === agentProfileId
		);
		if (
			input.deviceWait?.targetProfileId === agentProfileId &&
			((member?.agentWakeAvailability?.category === "offline" &&
				!member.agentWakeAvailability.isRefreshing) ||
				member?.agentWakeAvailability?.reasonCode ===
					"local_service.reconnecting")
		) {
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
