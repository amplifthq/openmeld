import type { WakeProgressItem } from "@openmeld/schemas/types";

/**
 * A Wake keeps reporting its pending request until the Agent actually
 * resumes. Once the owner's answer is sent, every Space surface (approval
 * tray, message status, composer status) should treat that request as
 * answered right away; a failed send removes the answer key again.
 */
export function resolveAgentInteractionAnswerKey(input: {
	interactionId: string;
	runtimeCoordinatorExecutionId: string;
}): string {
	return JSON.stringify([
		input.runtimeCoordinatorExecutionId,
		input.interactionId,
	]);
}

export function presentAnsweredAgentInteractions<T extends WakeProgressItem>(
	items: readonly T[],
	answeredKeys: ReadonlySet<string>
): readonly T[] {
	if (answeredKeys.size === 0) {
		return items;
	}
	let changed = false;
	const presented = items.map((item) => {
		const interactionId = item.pendingInteraction?.interactionId;
		if (
			!(
				interactionId &&
				item.runtimeCoordinatorExecutionId &&
				answeredKeys.has(
					resolveAgentInteractionAnswerKey({
						interactionId,
						runtimeCoordinatorExecutionId: item.runtimeCoordinatorExecutionId,
					})
				)
			)
		) {
			return item;
		}
		changed = true;
		return { ...item, pendingInteraction: null };
	});
	return changed ? presented : items;
}
