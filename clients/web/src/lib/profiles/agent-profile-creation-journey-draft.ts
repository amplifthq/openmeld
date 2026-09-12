import { openCodePermissionConfigSchema } from "@openmeld/schemas/schemas";
import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
} from "@openmeld/schemas/types";

const DRAFT_VERSION = 1;
const STORAGE_KEY_PREFIX = "openmeld:agent-profile-creation-journey";

export type AgentProfileCreationJourneyDraft = {
	agentControllerCollaborationMode: AgentControllerCollaborationMode | null;
	agentControllerPermissionMode: AgentControllerPermissionMode;
	agentId: string;
	modelId: string;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
	reasoningLevel: string;
	selectedProjectId: string;
	version: typeof DRAFT_VERSION;
};

export function buildAgentProfileCreationJourneyDraftStorageKey(input: {
	organizationId: string;
	userId: string;
}): string | null {
	const organizationId = input.organizationId.trim();
	const userId = input.userId.trim();
	if (!(organizationId && userId)) {
		return null;
	}
	return `${STORAGE_KEY_PREFIX}:${organizationId}:${userId}`;
}

export function readAgentProfileCreationJourneyDraft(input: {
	key: string;
	storage: Pick<Storage, "getItem" | "removeItem">;
}): AgentProfileCreationJourneyDraft | null {
	const raw = input.storage.getItem(input.key);
	if (!raw) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(raw);
		if (!isAgentProfileCreationJourneyDraft(parsed)) {
			input.storage.removeItem(input.key);
			return null;
		}
		return parsed;
	} catch {
		input.storage.removeItem(input.key);
		return null;
	}
}

export function writeAgentProfileCreationJourneyDraft(input: {
	draft: AgentProfileCreationJourneyDraft;
	key: string;
	storage: Pick<Storage, "setItem">;
}): void {
	input.storage.setItem(input.key, JSON.stringify(input.draft));
}

function isAgentProfileCreationJourneyDraft(
	value: unknown
): value is AgentProfileCreationJourneyDraft {
	if (!isRecord(value) || value.version !== DRAFT_VERSION) {
		return false;
	}
	return (
		typeof value.agentId === "string" &&
		(value.agentControllerCollaborationMode === null ||
			typeof value.agentControllerCollaborationMode === "string") &&
		typeof value.agentControllerPermissionMode === "string" &&
		typeof value.modelId === "string" &&
		(value.openCodePermission === null ||
			openCodePermissionConfigSchema.safeParse(value.openCodePermission)
				.success) &&
		typeof value.reasoningLevel === "string" &&
		typeof value.selectedProjectId === "string"
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
