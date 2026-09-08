import { normalizeMessageEnvelope } from "@openmeld/schemas";
import type { MessageEnvelope, WakeDeviceWait } from "@openmeld/schemas/types";

export type SpaceComposerSendOptions = { deviceWait?: WakeDeviceWait };

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
