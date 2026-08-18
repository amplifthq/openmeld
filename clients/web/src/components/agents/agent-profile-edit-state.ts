import {
	type AgentControllerCollaborationModeOption,
	type AgentControllerPermissionModeOption,
	type AgentProfileEditCapabilities,
	parseAgentControllerRef,
	resolveAgentControllerPermissionModeForController,
	resolveAgentProfileEditCapabilities,
	resolveNativeAgentControllerCollaborationModeForController,
} from "@openmeld/agent-runtime";
import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	GetAgentProfilePrimaryBindingResponse,
	LocalRuntimeExecutionTarget,
	ModelCatalog,
} from "@openmeld/schemas/types";
import { isOpenCodeAgentControllerRef } from "#/components/profiles/open-code-permissions-field";
import { bindableLocalAgentEntriesFromTarget } from "#/lib/profiles/profile-binding-target";

export type AgentProfileControllerPermissionModeEditState = {
	agentControllerRef: string;
	editable: boolean;
	options: AgentControllerPermissionModeOption[];
	value: AgentControllerPermissionMode | null;
};

export type AgentProfileControllerCollaborationModeEditState = {
	agentControllerRef: string;
	editable: boolean;
	options: AgentControllerCollaborationModeOption[];
	value: AgentControllerCollaborationMode | null;
};

export type AgentProfileModelSelectionEditState = {
	agentControllerId: string;
	agentControllerRef: string;
	modelId: string;
	reasoningLevel: string;
};

export type AgentProfileOpenCodePermissionEditState = {
	agentControllerRef: string;
	value: AgentProfileBindingOpenCodePermission | null;
};

export type AgentProfileEditState = {
	agentControllerId: string;
	agentControllerRef: string;
	capabilities: AgentProfileEditCapabilities;
	controllerCollaborationMode: AgentProfileControllerCollaborationModeEditState | null;
	controllerPermissionMode: AgentProfileControllerPermissionModeEditState | null;
	modelSelection: AgentProfileModelSelectionEditState | null;
	openCodePermission: AgentProfileOpenCodePermissionEditState | null;
};

export type AgentProfileControllerChangeOption = {
	agentControllerRef: string;
	label: string;
};

type DeviceAgentCatalogEntry =
	LocalRuntimeExecutionTarget["localAgentCatalog"]["entries"][number];

export function resolveLocalAgentEntryControllerRef(
	localAgentEntry: DeviceAgentCatalogEntry | null
): string | null {
	if (!localAgentEntry) {
		return null;
	}
	return `${localAgentEntry.targetKind}:${localAgentEntry.agentId}`;
}

export function resolveAgentProfileControllerChangeOptions(
	executionTarget: LocalRuntimeExecutionTarget | null
): readonly AgentProfileControllerChangeOption[] {
	const options = new Map<string, AgentProfileControllerChangeOption>();
	for (const entry of bindableLocalAgentEntriesFromTarget(executionTarget)) {
		const agentControllerRef = resolveLocalAgentEntryControllerRef(entry);
		if (!agentControllerRef || options.has(agentControllerRef)) {
			continue;
		}
		options.set(agentControllerRef, {
			agentControllerRef,
			label: entry.displayName || entry.agentId,
		});
	}
	return [...options.values()];
}

export function resolveAgentProfileEditState(input: {
	binding: GetAgentProfilePrimaryBindingResponse["binding"] | null;
	modelCatalog: ModelCatalog | null;
}): AgentProfileEditState | null {
	const agentControllerRef =
		input.binding?.executionTarget?.agentControllerRef ?? null;
	if (!agentControllerRef) {
		return null;
	}
	const parsedAgentControllerRef = parseAgentControllerRef(agentControllerRef);
	if (!parsedAgentControllerRef) {
		return null;
	}
	const capabilities = resolveAgentProfileEditCapabilities({
		agentControllerRef,
		modelCatalog: input.modelCatalog,
	});
	const controllerCollaborationMode = {
		agentControllerRef,
		editable: capabilities.collaborationMode.editable,
		options: capabilities.collaborationMode.options,
		value: capabilities.collaborationMode.editable
			? (resolveNativeAgentControllerCollaborationModeForController(
					input.binding?.agentControllerCollaborationMode,
					{ agentControllerRef }
				) ?? null)
			: null,
	};
	const controllerPermissionMode = {
		agentControllerRef,
		editable: capabilities.permissionMode.editable,
		options: capabilities.permissionMode.options,
		value: capabilities.permissionMode.editable
			? resolveAgentControllerPermissionModeForController(
					input.binding?.agentControllerPermissionMode,
					{ agentControllerRef }
				)
			: null,
	};
	const modelSelection = capabilities.modelSelection.editable
		? {
				agentControllerId: parsedAgentControllerRef.id,
				agentControllerRef,
				modelId: input.binding?.modelSelection?.modelId ?? "",
				reasoningLevel: input.binding?.modelSelection?.reasoningLevel ?? "",
			}
		: null;
	const openCodePermission = isOpenCodeAgentControllerRef(agentControllerRef)
		? {
				agentControllerRef,
				value: input.binding?.openCodePermission ?? null,
			}
		: null;
	return {
		agentControllerId: parsedAgentControllerRef.id,
		agentControllerRef,
		capabilities,
		controllerCollaborationMode,
		controllerPermissionMode,
		modelSelection,
		openCodePermission,
	};
}
