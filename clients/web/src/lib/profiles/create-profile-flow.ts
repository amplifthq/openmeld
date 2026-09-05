import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	AgentProfileBindingSessionInventorySelection,
	AuthProfileView,
	DaemonServiceLane,
} from "@openmeld/schemas/types";
import {
	ensureWebAgentProfileRuntimeBinding,
	formatWebAgentProfileRuntimeBindingFailure,
	formatWebAgentProfileRuntimeBindingFailureActionLabel,
	shouldOfferWebAgentProfileSetupRefresh,
} from "#/lib/profiles/agent-profile-runtime-binding";
import { createStartAgentProfile } from "#/lib/profiles/create-agent-profile";
import { createStartHumanProfile } from "#/lib/profiles/create-human-profile";
import { updateAgentProfileDefaultProject } from "./update-default-project";
import { updateAgentProfileWorkspace } from "./update-profile-workspace";

// Route-free Profile creation and local setup primitives. Creating the durable
// Profile identity is an explicit commit point. Callers must treat every later
// Binding, workspace, Default Project, authorization, or Space-membership write
// as a follow-up outcome rather than reporting the committed Profile as a
// failed create and allowing a duplicate retry.

export type NewProfileKind = "human" | "agent";

export type NewProfileErrorState = {
	message: string;
	setupRefreshActionLabel: string;
	setupRefreshAvailable: boolean;
};

export class NewProfileLocalSetupError extends Error {
	bindingEstablished: boolean;
	reasonCodes: readonly string[];
	setupRefreshActionLabel: string;
	setupRefreshAvailable: boolean;

	constructor(
		input: NewProfileErrorState & {
			bindingEstablished?: boolean;
			reasonCodes?: readonly string[];
		}
	) {
		super(input.message);
		this.name = "NewProfileLocalSetupError";
		this.bindingEstablished = input.bindingEstablished ?? false;
		this.reasonCodes = [...(input.reasonCodes ?? [])];
		this.setupRefreshActionLabel = input.setupRefreshActionLabel;
		this.setupRefreshAvailable = input.setupRefreshAvailable;
	}
}

export type NewProfileCreationInput = {
	idempotencyKey?: string | null;
	organizationId: string | null;
	profileKind: NewProfileKind | null;
	profileName: string;
	selectedHumanProfileId: string | null;
};

export type NewAgentProfileLocalSetupInput = {
	agentControllerConversationId?: string | null;
	agentControllerCollaborationMode?: AgentControllerCollaborationMode;
	agentControllerPermissionMode?: AgentControllerPermissionMode;
	boundAgentId: string;
	currentServiceCanSetProfileWorkspace?: boolean;
	deviceId: string | null;
	defaultProjectId?: string | null;
	modelId?: string | null;
	openCodePermission?: AgentProfileBindingOpenCodePermission | null;
	organizationId: string | null;
	projectFolderPath?: string | null;
	profile: AuthProfileView;
	reasoningLevel?: string | null;
	runtimeLane: DaemonServiceLane | null;
	selectedHumanProfileId: string | null;
	sessionInventorySelection?: AgentProfileBindingSessionInventorySelection;
};

export async function createNewProfile(
	input: NewProfileCreationInput
): Promise<AuthProfileView> {
	const normalizedProfileName = requireNewProfileName(input.profileName);
	const profileKind = requireNewProfileKind(input.profileKind);

	if (profileKind === "human") {
		return await createStartHumanProfile({
			data: {
				profileName: normalizedProfileName,
				...(input.selectedHumanProfileId
					? { creatorProfileId: input.selectedHumanProfileId }
					: {}),
			},
		});
	}

	const organizationId = requireNewAgentProfileOrganizationId(
		input.organizationId
	);
	return await createStartAgentProfile({
		data: {
			...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
			organizationId,
			profileName: normalizedProfileName,
			...(input.selectedHumanProfileId
				? { creatorProfileId: input.selectedHumanProfileId }
				: {}),
		},
	});
}

function requireNewProfileName(profileName: string): string {
	const normalizedProfileName = profileName.trim();
	if (normalizedProfileName.length === 0) {
		throw new Error("Enter a profile name.");
	}

	return normalizedProfileName;
}

function requireNewProfileKind(
	profileKind: NewProfileKind | null
): NewProfileKind {
	if (profileKind === null) {
		throw new Error("Choose whether to create a personal or Agent Profile.");
	}

	return profileKind;
}

export async function setupNewAgentProfileLocalState(
	input: NewAgentProfileLocalSetupInput
): Promise<AuthProfileView> {
	if (input.profile.profileKind !== "agent") {
		throw new Error("Local Agent setup requires an Agent Profile.");
	}
	const organizationId = requireNewAgentProfileOrganizationId(
		input.organizationId
	);
	const agentControllerRef =
		input.boundAgentId.length > 0 ? `builtin:${input.boundAgentId}` : null;

	if (!agentControllerRef) {
		if (input.currentServiceCanSetProfileWorkspace === true) {
			await configureNewAgentProfileWorkspace({
				agentProfileId: input.profile.openMeldProfileId,
				bindingEstablished: false,
				organizationId,
				projectFolderPath: input.projectFolderPath ?? null,
				selectedHumanProfileId: input.selectedHumanProfileId,
			});
		}
		return input.profile;
	}

	await bindNewAgentProfileToLocalAgent({
		agentControllerConversationId: input.agentControllerConversationId ?? null,
		...(input.agentControllerCollaborationMode
			? {
					agentControllerCollaborationMode:
						input.agentControllerCollaborationMode,
				}
			: {}),
		...(input.agentControllerPermissionMode
			? { agentControllerPermissionMode: input.agentControllerPermissionMode }
			: {}),
		agentProfileId: input.profile.openMeldProfileId,
		agentControllerRef,
		deviceId: input.deviceId,
		modelId: input.modelId ?? null,
		openCodePermission: input.openCodePermission ?? null,
		organizationId,
		reasoningLevel: input.reasoningLevel ?? null,
		runtimeLane: input.runtimeLane,
		selectedHumanProfileId: input.selectedHumanProfileId,
		...(input.sessionInventorySelection
			? { sessionInventorySelection: input.sessionInventorySelection }
			: {}),
	});
	if (!input.defaultProjectId) {
		await configureNewAgentProfileWorkspace({
			agentProfileId: input.profile.openMeldProfileId,
			bindingEstablished: true,
			organizationId,
			projectFolderPath: input.projectFolderPath ?? null,
			selectedHumanProfileId: input.selectedHumanProfileId,
		});
	}
	if (!input.defaultProjectId) {
		return input.profile;
	}
	return await configureNewAgentProfileDefaultProject({
		bindingEstablished: true,
		defaultProjectId: input.defaultProjectId,
		organizationId,
		profile: input.profile,
		selectedHumanProfileId: input.selectedHumanProfileId,
	});
}

function requireNewAgentProfileOrganizationId(
	organizationId: string | null
): string {
	const normalizedOrganizationId = organizationId?.trim() ?? "";
	if (!normalizedOrganizationId) {
		throw new Error("Choose an organization before creating an Agent Profile.");
	}
	return normalizedOrganizationId;
}

async function bindNewAgentProfileToLocalAgent(input: {
	agentControllerConversationId: string | null;
	agentControllerCollaborationMode?: AgentControllerCollaborationMode;
	agentControllerPermissionMode?: AgentControllerPermissionMode;
	agentProfileId: string;
	agentControllerRef: string;
	deviceId: string | null;
	modelId: string | null;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
	organizationId: string;
	reasoningLevel: string | null;
	runtimeLane: DaemonServiceLane | null;
	selectedHumanProfileId: string | null;
	sessionInventorySelection?: AgentProfileBindingSessionInventorySelection;
}): Promise<void> {
	const bindingResult = await ensureWebAgentProfileRuntimeBinding({
		actorProfileId: input.selectedHumanProfileId,
		agentProfileId: input.agentProfileId,
		...(input.agentControllerCollaborationMode
			? {
					agentControllerCollaborationMode:
						input.agentControllerCollaborationMode,
				}
			: {}),
		...(input.agentControllerPermissionMode
			? { agentControllerPermissionMode: input.agentControllerPermissionMode }
			: {}),
		agentControllerRef: input.agentControllerRef,
		...(input.agentControllerConversationId
			? { agentControllerConversationId: input.agentControllerConversationId }
			: {}),
		deviceId: input.deviceId,
		modelId: input.modelId,
		openCodePermission: input.openCodePermission,
		organizationId: input.organizationId,
		reasoningLevel: input.reasoningLevel,
		runtimeLane: input.runtimeLane,
		...(input.sessionInventorySelection
			? { sessionInventorySelection: input.sessionInventorySelection }
			: {}),
	});
	if (bindingResult.status !== "accepted") {
		throw new NewProfileLocalSetupError({
			message: formatWebAgentProfileRuntimeBindingFailure(bindingResult),
			reasonCodes: bindingResult.reasonCodes,
			setupRefreshActionLabel:
				formatWebAgentProfileRuntimeBindingFailureActionLabel(bindingResult),
			setupRefreshAvailable:
				shouldOfferWebAgentProfileSetupRefresh(bindingResult),
		});
	}
}

export async function configureNewAgentProfileWorkspace(input: {
	agentProfileId: string;
	bindingEstablished: boolean;
	organizationId: string;
	projectFolderPath: string | null;
	selectedHumanProfileId: string | null;
}): Promise<void> {
	const projectFolderPath = normalizeProjectFolderPath(input.projectFolderPath);
	try {
		await updateAgentProfileWorkspace({
			actorProfileId: input.selectedHumanProfileId,
			organizationId: input.organizationId,
			profileId: input.agentProfileId,
			workspaceMode: projectFolderPath ? "custom" : "openmeld_managed",
			...(projectFolderPath ? { workspacePath: projectFolderPath } : {}),
		});
	} catch (error) {
		const failure = toStructuredApiClientFailure(error);
		throw new NewProfileLocalSetupError({
			bindingEstablished: input.bindingEstablished,
			message:
				failure.message ||
				"OpenMeld created the Agent, but couldn't prepare its working folder on this computer.",
			setupRefreshActionLabel: "Reconnect computer",
			setupRefreshAvailable: false,
		});
	}
}

async function configureNewAgentProfileDefaultProject(input: {
	bindingEstablished: boolean;
	defaultProjectId: string;
	organizationId: string;
	profile: AuthProfileView;
	selectedHumanProfileId: string | null;
}): Promise<AuthProfileView> {
	try {
		return await updateAgentProfileDefaultProject({
			actorProfileId: input.selectedHumanProfileId,
			defaultProjectId: input.defaultProjectId,
			organizationId: input.organizationId,
			profileId: input.profile.openMeldProfileId,
		});
	} catch (error) {
		const failure = toStructuredApiClientFailure(error);
		throw new NewProfileLocalSetupError({
			bindingEstablished: input.bindingEstablished,
			message:
				failure.message ||
				"OpenMeld created the Agent, but couldn't set its Default Project.",
			setupRefreshActionLabel: "Review Agent settings",
			setupRefreshAvailable: false,
		});
	}
}

function normalizeProjectFolderPath(
	projectFolderPath: string | null
): string | null {
	if (!projectFolderPath || projectFolderPath.trim().length === 0) {
		return null;
	}

	return projectFolderPath;
}
