import {
	DEFAULT_WAKE_DEVICE_WAIT_MS,
	MAX_WAKE_DEVICE_WAIT_MS,
	normalizeMessageEnvelope,
} from "@openmeld/schemas";
import type {
	MessageEnvelope,
	SpaceMemberAgentSnapshot,
	WakeDeviceWait,
} from "@openmeld/schemas/types";

export type SpaceComposerSendOptions = {
	deviceWait?: WakeDeviceWait;
	/** Local UI notification after the exact outgoing message has been staged. */
	onMessageStaged?: (clientMessageId: string) => void;
};

type DeviceWaitMember = Pick<
	SpaceMemberAgentSnapshot,
	"profileId" | "deviceWaitTarget" | "agentWakeAvailability"
>;

export function createSpaceComposerDeviceWait(
	member: DeviceWaitMember
): WakeDeviceWait | undefined {
	if (!member.deviceWaitTarget) {
		return undefined;
	}
	const wait = {
		...member.deviceWaitTarget,
		targetProfileId: member.profileId,
		deadlineAtMs: Date.now() + DEFAULT_WAKE_DEVICE_WAIT_MS,
	};
	return canSubmitSpaceComposerDeviceWait(member, wait) ? wait : undefined;
}

export function isCurrentSpaceComposerDeviceWait(
	member: DeviceWaitMember | undefined,
	wait: WakeDeviceWait | undefined,
	nowMs = Date.now()
): boolean {
	return Boolean(
		wait &&
			member?.deviceWaitTarget &&
			member.profileId === wait.targetProfileId &&
			member.deviceWaitTarget.bindingId === wait.bindingId &&
			member.deviceWaitTarget.openMeldServiceRuntimeId ===
				wait.openMeldServiceRuntimeId &&
			wait.deadlineAtMs > nowMs &&
			wait.deadlineAtMs <= nowMs + MAX_WAKE_DEVICE_WAIT_MS
	);
}

export function canSubmitSpaceComposerDeviceWait(
	member: DeviceWaitMember | undefined,
	wait: WakeDeviceWait | undefined
): boolean {
	const availability = member?.agentWakeAvailability;
	return (
		isCurrentSpaceComposerDeviceWait(member, wait) &&
		((availability?.category === "offline" && !availability.isRefreshing) ||
			availability?.reasonCode === "local_service.reconnecting")
	);
}

export function applyDeviceWaitToSubmission<
	T extends {
		text: string;
		messageEnvelope: MessageEnvelope | null;
	},
>(submission: T, deviceWait?: WakeDeviceWait): T & SpaceComposerSendOptions {
	if (!deviceWait) {
		return submission;
	}
	const envelope = submission.messageEnvelope;
	if (envelope?.referenceTargets.includes(deviceWait.targetProfileId)) {
		throw new Error(
			"Choose Wake before sending a task that waits for a computer."
		);
	}
	return {
		...submission,
		deviceWait,
		messageEnvelope: normalizeMessageEnvelope({
			...envelope,
			text: submission.text,
			activationTargets: [
				...new Set([
					...(envelope?.activationTargets ?? []),
					deviceWait.targetProfileId,
				]),
			],
			referenceTargets: (envelope?.referenceTargets ?? []).filter(
				(id) => id !== deviceWait.targetProfileId
			),
			mentionTargets: envelope?.mentionTargets ?? [],
		}),
	};
}
