import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
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

// Route-free "create profile" flow. The standalone Create Profile dialog and
// any future caller can create a human/agent profile and optionally bind it to a
// local agent without depending on a route tree.
//
// The setup steps are independent: (1) create the profile (auth, no Space),
// (2) optionally bind an agent profile to a local agent (gateway), and
// (3) configure its local workspace and optional Default Project. Space joining
// remains in join-profile-to-space.ts. This module
// owns steps (1) and (2).

export type NewProfileKind = "human" | "agent";

export type NewProfileErrorState = {
	message: string;
	setupRefreshActionLabel: string;
	setupRefreshAvailable: boolean;
};

export class NewProfileLocalSetupError extends Error {
	setupRefreshActionLabel: string;
	setupRefreshAvailable: boolean;

	constructor(input: NewProfileErrorState) {
		super(input.message);
		this.name = "NewProfileLocalSetupError";
		this.setupRefreshActionLabel = input.setupRefreshActionLabel;
		this.setupRefreshAvailable = input.setupRefreshAvailable;
	}
}

export type NewStartProfileInput = {
	agentControllerPermissionMode?: AgentControllerPermissionMode;
	boundAgentId: string;
	deviceId: string | null;
	defaultProjectId?: string | null;
	modelId?: string | null;
	openCodePermission?: AgentProfileBindingOpenCodePermission | null;
	organizationId?: string | null;
	projectFolderPath?: string | null;
	profileKind: NewProfileKind | null;
	profileName: string;
	reasoningLevel?: string | null;
	runtimeLane: DaemonServiceLane | null;
	selectedHumanProfileId: string | null;
};

export async function createNewStartProfile(
	input: NewStartProfileInput
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

	return await createBoundStartAgentProfile({
		...(input.agentControllerPermissionMode
			? { agentControllerPermissionMode: input.agentControllerPermissionMode }
			: {}),
		boundAgentId: input.boundAgentId,
		deviceId: input.deviceId,
		defaultProjectId: input.defaultProjectId ?? null,
		modelId: input.modelId ?? null,
		openCodePermission: input.openCodePermission ?? null,
		organizationId: input.organizationId ?? null,
		projectFolderPath: input.projectFolderPath ?? null,
		profileName: normalizedProfileName,
		reasoningLevel: input.reasoningLevel ?? null,
		runtimeLane: input.runtimeLane,
		selectedHumanProfileId: input.selectedHumanProfileId,
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
		throw new Error("Choose whether to create a human or agent profile.");
	}

	return profileKind;
}

async function createBoundStartAgentProfile(input: {
	agentControllerPermissionMode?: AgentControllerPermissionMode;
	boundAgentId: string;
	deviceId: string | null;
	defaultProjectId: string | null;
	modelId: string | null;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
	organizationId: string | null;
	projectFolderPath: string | null;
	profileName: string;
	reasoningLevel: string | null;
	runtimeLane: DaemonServiceLane | null;
	selectedHumanProfileId: string | null;
}): Promise<AuthProfileView> {
	const agentControllerRef =
		input.boundAgentId.length > 0 ? `builtin:${input.boundAgentId}` : null;

	const profile = await createStartAgentProfile({
		data: {
			profileName: input.profileName,
			...(input.selectedHumanProfileId
				? { creatorProfileId: input.selectedHumanProfileId }
				: {}),
		},
	});
	if (!agentControllerRef) {
		return profile;
	}

	await bindNewAgentProfileToLocalAgent({
		...(input.agentControllerPermissionMode
			? { agentControllerPermissionMode: input.agentControllerPermissionMode }
			: {}),
		agentProfileId: profile.openMeldProfileId,
		agentControllerRef,
		deviceId: input.deviceId,
		modelId: input.modelId,
		openCodePermission: input.openCodePermission,
		reasoningLevel: input.reasoningLevel,
		runtimeLane: input.runtimeLane,
		selectedHumanProfileId: input.selectedHumanProfileId,
	});
	await configureNewAgentProfileWorkspace({
		agentProfileId: profile.openMeldProfileId,
		projectFolderPath: input.projectFolderPath,
		selectedHumanProfileId: input.selectedHumanProfileId,
	});
	if (!(input.defaultProjectId && input.organizationId)) {
		return profile;
	}
	return await updateAgentProfileDefaultProject({
		actorProfileId: input.selectedHumanProfileId,
		defaultProjectId: input.defaultProjectId,
		organizationId: input.organizationId,
		profileId: profile.openMeldProfileId,
	});
}

async function bindNewAgentProfileToLocalAgent(input: {
	agentControllerPermissionMode?: AgentControllerPermissionMode;
	agentProfileId: string;
	agentControllerRef: string;
	deviceId: string | null;
	modelId: string | null;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
	reasoningLevel: string | null;
	runtimeLane: DaemonServiceLane | null;
	selectedHumanProfileId: string | null;
}): Promise<void> {
	const bindingResult = await ensureWebAgentProfileRuntimeBinding({
		actorProfileId: input.selectedHumanProfileId,
		agentProfileId: input.agentProfileId,
		...(input.agentControllerPermissionMode
			? { agentControllerPermissionMode: input.agentControllerPermissionMode }
			: {}),
		agentControllerRef: input.agentControllerRef,
		deviceId: input.deviceId,
		modelId: input.modelId,
		openCodePermission: input.openCodePermission,
		reasoningLevel: input.reasoningLevel,
		runtimeLane: input.runtimeLane,
	});
	if (bindingResult.status !== "accepted") {
		throw new NewProfileLocalSetupError({
			message: formatWebAgentProfileRuntimeBindingFailure(bindingResult),
			setupRefreshActionLabel:
				formatWebAgentProfileRuntimeBindingFailureActionLabel(bindingResult),
			setupRefreshAvailable:
				shouldOfferWebAgentProfileSetupRefresh(bindingResult),
		});
	}
}

async function configureNewAgentProfileWorkspace(input: {
	agentProfileId: string;
	projectFolderPath: string | null;
	selectedHumanProfileId: string | null;
}): Promise<void> {
	const projectFolderPath = normalizeProjectFolderPath(input.projectFolderPath);
	try {
		await updateAgentProfileWorkspace({
			actorProfileId: input.selectedHumanProfileId,
			profileId: input.agentProfileId,
			workspaceMode: projectFolderPath ? "custom" : "openmeld_managed",
			...(projectFolderPath ? { workspacePath: projectFolderPath } : {}),
		});
	} catch (error) {
		const failure = toStructuredApiClientFailure(error);
		throw new NewProfileLocalSetupError({
			message:
				failure.message ||
				"OpenMeld created the Agent Profile, but couldn't save that Project folder on this computer.",
			setupRefreshActionLabel: "Reconnect computer",
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
