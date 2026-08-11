import {
	getAgentControllerPermissionModeDisplayMetadata,
	listAgentControllerPermissionModeOptions,
	resolveNativeAgentControllerPermissionModeForController,
} from "@openmeld/agent-runtime";
import type {
	AgentControllerPermissionMode,
	GetAgentProfilePrimaryBindingResponse,
} from "@openmeld/schemas/types";

export type WebAgentControllerPermissionModeDisplay = {
	description: string;
	fieldLabel: string;
	label: string;
	tone: "neutral" | "warning";
	value: AgentControllerPermissionMode;
};

export function resolveWebAgentControllerPermissionModeDisplay(input: {
	agentControllerPermissionMode?: AgentControllerPermissionMode | null;
	agentControllerRef?: string | null;
}): WebAgentControllerPermissionModeDisplay | null {
	if (!input.agentControllerRef) {
		return null;
	}
	const options = listAgentControllerPermissionModeOptions({
		agentControllerRef: input.agentControllerRef,
	});
	if (options.length === 0) {
		return null;
	}
	if (!input.agentControllerPermissionMode) {
		return null;
	}
	const value = resolveNativeAgentControllerPermissionModeForController(
		input.agentControllerPermissionMode,
		{ agentControllerRef: input.agentControllerRef }
	);
	if (!value) {
		return null;
	}
	const metadata = getAgentControllerPermissionModeDisplayMetadata(value, {
		agentControllerRef: input.agentControllerRef,
	});
	return {
		description: metadata.description,
		fieldLabel: metadata.fieldLabel,
		label: metadata.label,
		tone: metadata.tone,
		value,
	};
}

export function resolveWebAgentControllerPermissionModeDisplayFromBinding(
	binding: GetAgentProfilePrimaryBindingResponse["binding"] | null
): WebAgentControllerPermissionModeDisplay | null {
	return resolveWebAgentControllerPermissionModeDisplay({
		agentControllerPermissionMode:
			binding?.agentControllerPermissionMode ?? null,
		agentControllerRef: binding?.executionTarget?.agentControllerRef ?? null,
	});
}
