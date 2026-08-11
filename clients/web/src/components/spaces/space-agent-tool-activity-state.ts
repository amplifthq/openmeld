import { isAgentWorkActivityPresentable } from "@openmeld/schemas";
import type {
	AgentStreamToolPart,
	AgentWorkActivity,
} from "@openmeld/schemas/types";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

const NO_WORK_STEPS: readonly SpaceAgentWorkStep[] = [];

export type SpaceAgentWorkStep = {
	count: number;
	id: string;
	state: AgentStreamToolPart["state"];
	work: AgentWorkActivity;
};

export function hasLiveSpaceAgentToolActivity(
	item: Pick<SpaceTimelineItem, "agentStreamState">
): boolean {
	return (
		item.agentStreamState?.status === "streaming" &&
		resolveVisibleSpaceAgentWorkSteps(item).length > 0
	);
}

export function resolveVisibleSpaceAgentWorkSteps(
	item: Pick<SpaceTimelineItem, "agentActivity" | "agentStreamState">
): readonly SpaceAgentWorkStep[] {
	const state = item.agentStreamState;
	if (state?.status === "streaming") {
		return groupAgentWorkParts(state.toolParts ?? []);
	}
	return groupAgentWorkParts(
		item.agentActivity?.steps.map((step, index) => ({
			type: "tool" as const,
			toolCallId: `durable-activity:${index}:${step.toolName}`,
			toolName: step.toolName,
			state: step.state,
			work: step.work,
		})) ?? []
	);
}

export function groupAgentWorkParts(
	parts: readonly AgentStreamToolPart[]
): readonly SpaceAgentWorkStep[] {
	const calls = resolveAgentWorkCalls(parts);
	const steps: SpaceAgentWorkStep[] = [];
	for (const call of calls) {
		const previous = steps.at(-1);
		if (
			previous &&
			previous.state === call.state &&
			hasSameWork(previous.work, call.work)
		) {
			previous.count += 1;
			continue;
		}
		steps.push({ ...call });
	}
	return steps.length > 0 ? steps : NO_WORK_STEPS;
}

function resolveAgentWorkCalls(
	parts: readonly AgentStreamToolPart[]
): SpaceAgentWorkStep[] {
	const calls: SpaceAgentWorkStep[] = [];
	const indexByToolCallId = new Map<string, number>();
	for (const part of parts) {
		if (!(part.work && isAgentWorkActivityPresentable(part.work))) {
			continue;
		}
		const existingIndex = indexByToolCallId.get(part.toolCallId);
		if (existingIndex !== undefined) {
			const existing = calls[existingIndex];
			if (existing) {
				existing.state = part.state;
			}
			continue;
		}
		indexByToolCallId.set(part.toolCallId, calls.length);
		calls.push({
			count: 1,
			id: part.toolCallId,
			state: part.state,
			work: part.work,
		});
	}
	return calls;
}

function hasSameWork(
	left: AgentWorkActivity,
	right: AgentWorkActivity
): boolean {
	return (
		left.key === right.key &&
		left.subject?.kind === right.subject?.kind &&
		left.subject?.label === right.subject?.label
	);
}
