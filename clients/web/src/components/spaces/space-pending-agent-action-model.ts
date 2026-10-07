import {
	listAgentControllerPermissionModeOptions,
	parseAgentControllerRef,
	resolveAgentProfileEditApplicationTiming,
} from "@openmeld/agent-runtime";
import type {
	AgentControllerPermissionMode,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import type { SpaceAgentPermissionModeOption } from "./space-agent-interaction-card";

const LOW_INTERRUPTION_PERMISSION_MODE_BY_CONTROLLER_ID: Readonly<
	Record<string, AgentControllerPermissionMode>
> = {
	"claude-code": "claude-code:auto",
	codex: "codex:approveForMe",
	cursor: "cursor:autoReview",
	"grok-build": "grok-build:auto",
};

export function listActionablePendingAgentInteractions(
	items: readonly WakeProgressItem[]
): WakeProgressItem[] {
	const byInteractionIdentity = new Map<string, WakeProgressItem>();
	for (const item of items) {
		const pendingInteraction = item.pendingInteraction;
		if (!(pendingInteraction?.canRespond && pendingInteraction.request)) {
			continue;
		}
		byInteractionIdentity.set(
			resolveSpacePendingAgentActionIdentity(item),
			item
		);
	}
	return [...byInteractionIdentity.values()].sort(
		(left, right) =>
			(left.pendingInteraction?.requestedAtMs ?? left.updatedAtMs) -
			(right.pendingInteraction?.requestedAtMs ?? right.updatedAtMs)
	);
}

export function resolveSpacePendingAgentActionIdentity(
	item: WakeProgressItem
): string {
	return JSON.stringify([
		item.runtimeCoordinatorExecutionId,
		item.pendingInteraction?.interactionId ?? null,
	]);
}

export function partitionSpacePendingAgentActions(
	items: readonly WakeProgressItem[],
	activeThreadId: string | null
): { conversation: WakeProgressItem[]; thread: WakeProgressItem[] } {
	const conversation: WakeProgressItem[] = [];
	const thread: WakeProgressItem[] = [];
	for (const item of listActionablePendingAgentInteractions(items)) {
		if (activeThreadId && item.sourceContext?.threadId === activeThreadId) {
			thread.push(item);
		} else {
			conversation.push(item);
		}
	}
	return { conversation, thread };
}

export function resolveSpacePermissionModeOptions(input: {
	agentControllerPermissionMode?: AgentControllerPermissionMode | null;
	agentControllerRef: string | null;
}): SpaceAgentPermissionModeOption[] {
	const controller = parseAgentControllerRef(input.agentControllerRef);
	if (controller?.kind !== "builtin") {
		return [];
	}
	const permissionMode =
		LOW_INTERRUPTION_PERMISSION_MODE_BY_CONTROLLER_ID[controller.id];
	const options = listAgentControllerPermissionModeOptions({
		agentControllerRef: controller.ref,
	}).filter(
		(option) =>
			option.value !== input.agentControllerPermissionMode &&
			(controller.id === "codex" ||
				(option.value === permissionMode &&
					!option.requiresExplicitConfirmation))
	);
	return options.map((option) => {
		const timing = resolveAgentProfileEditApplicationTiming({
			agentControllerRef: controller.ref,
			field: "permission_mode",
			currentPermissionMode: input.agentControllerPermissionMode,
			nextPermissionMode: option.value,
		});
		return {
			description: `${option.description} ${timing === "applies_now" ? "OpenMeld will try to apply this to later actions in the current task." : "Applies to the next task. This task keeps its current permissions."}`,
			label: option.label,
			permissionMode: option.value,
			requiresExplicitConfirmation: option.requiresExplicitConfirmation,
		};
	});
}
