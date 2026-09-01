import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	AgentProfileBindingSessionInventorySelection,
	AuthProfileView,
	DaemonServiceLane,
} from "@openmeld/schemas/types";
import type { QueryClient } from "@tanstack/react-query";
import {
	createNewProfile,
	type NewProfileKind,
	NewProfileLocalSetupError,
	setupNewAgentProfileLocalState,
} from "./create-profile-flow";
import { joinProfileToSpace } from "./join-profile-to-space";

export type CreateProfileSpaceContext = {
	spaceId: string;
	spaceName: string | null;
};

export type SpaceJoinedProfileReference = Pick<
	AuthProfileView,
	"openMeldProfileId" | "profileKind"
>;

export type CreatedProfileFollowUpIssue = {
	kind: "local_setup" | "space_join";
	message: string;
};

export type CreatedProfileOutcome = {
	followUpIssues: CreatedProfileFollowUpIssue[];
	profile: AuthProfileView;
	spaceJoined: boolean;
};

export const SPACE_JOIN_REQUIRES_HUMAN_MESSAGE =
	"Add a human profile to this account before bringing profiles into this Space.";

// This is the single phase-order owner for interactive Profile creation. The
// Auth create response is the commit point, so later follow-up errors cannot
// escape as create failures or delete the committed identity.
export async function createProfileWithFollowUps(input: {
	agentControllerConversationId?: string | null;
	agentControllerCollaborationMode?: AgentControllerCollaborationMode;
	agentControllerPermissionMode?: AgentControllerPermissionMode;
	boundAgentId: string;
	currentServiceCanSetProfileWorkspace: boolean;
	defaultProjectId: string | null;
	deviceId: string | null;
	idempotencyKey: string;
	modelId: string | null;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	organizationId: string | null;
	profileKind: NewProfileKind | null;
	profileName: string;
	projectFolderPath: string | null;
	queryClient: QueryClient;
	reasoningLevel: string | null;
	runtimeLane: DaemonServiceLane | null;
	selectedHumanProfile: AuthProfileView | null | undefined;
	selectedHumanProfileId: string | null;
	sessionInventorySelection?: AgentProfileBindingSessionInventorySelection;
	spaceContext: CreateProfileSpaceContext | undefined;
}): Promise<CreatedProfileOutcome> {
	assertSpaceJoinActorBeforeProfileCreate(input);
	const spaceJoinContext = input.spaceContext
		? {
				organizationId: requireSpaceOrganizationId(input.organizationId),
				spaceContext: input.spaceContext,
			}
		: null;

	let profile = await createNewProfile({
		idempotencyKey: input.idempotencyKey,
		organizationId: input.organizationId,
		profileKind: input.profileKind,
		profileName: input.profileName,
		selectedHumanProfileId: input.selectedHumanProfileId,
	});
	const followUpIssues: CreatedProfileFollowUpIssue[] = [];
	let spaceJoined = false;
	const setupLocalState = async () =>
		await setupNewAgentProfileLocalState({
			agentControllerConversationId:
				input.agentControllerConversationId ?? null,
			...(input.agentControllerCollaborationMode
				? {
						agentControllerCollaborationMode:
							input.agentControllerCollaborationMode,
					}
				: {}),
			...(input.agentControllerPermissionMode
				? {
						agentControllerPermissionMode: input.agentControllerPermissionMode,
					}
				: {}),
			boundAgentId: input.boundAgentId,
			currentServiceCanSetProfileWorkspace:
				input.currentServiceCanSetProfileWorkspace,
			defaultProjectId: input.defaultProjectId,
			deviceId: input.deviceId,
			modelId: input.modelId,
			openCodePermission: input.openCodePermission,
			organizationId: input.organizationId,
			profile,
			projectFolderPath: input.projectFolderPath,
			reasoningLevel: input.reasoningLevel,
			runtimeLane: input.runtimeLane,
			selectedHumanProfileId: input.selectedHumanProfileId,
			...(input.sessionInventorySelection
				? { sessionInventorySelection: input.sessionInventorySelection }
				: {}),
		});

	if (spaceJoinContext) {
		try {
			await joinCreatedProfileToSpace({
				boundAgentId: input.boundAgentId,
				onAfterJoin: input.onAfterJoin,
				organizationId: spaceJoinContext.organizationId,
				profile,
				queryClient: input.queryClient,
				selectedHumanProfile: input.selectedHumanProfile,
				spaceContext: spaceJoinContext.spaceContext,
			});
			spaceJoined = true;
		} catch (error) {
			followUpIssues.push({
				kind: "space_join",
				message: toCreatedProfileFollowUpMessage(
					error,
					`OpenMeld couldn't add this profile to ${spaceJoinContext.spaceContext.spaceName ?? "the Space"}.`
				),
			});
		}
	}

	if (profile.profileKind === "agent") {
		try {
			profile = await setupLocalState();
		} catch (error) {
			followUpIssues.push(buildLocalSetupFollowUpIssue(error));
		}
	}

	return { followUpIssues, profile, spaceJoined };
}

function buildLocalSetupFollowUpIssue(
	error: unknown
): CreatedProfileFollowUpIssue {
	return {
		kind: "local_setup",
		message: toCreatedProfileFollowUpMessage(
			error,
			"OpenMeld created the Agent, but couldn't finish its local setup."
		),
	};
}

function assertSpaceJoinActorBeforeProfileCreate(input: {
	profileKind: NewProfileKind | null;
	selectedHumanProfile: AuthProfileView | null | undefined;
	spaceContext: CreateProfileSpaceContext | undefined;
}): void {
	if (
		input.spaceContext &&
		!input.selectedHumanProfile &&
		input.profileKind !== "human"
	) {
		throw new Error(SPACE_JOIN_REQUIRES_HUMAN_MESSAGE);
	}
}

function requireSpaceOrganizationId(organizationId: string | null): string {
	if (organizationId) {
		return organizationId;
	}
	throw new Error(
		"OpenMeld could not confirm the Organization for this Space. Refresh the page and try again."
	);
}

async function joinCreatedProfileToSpace(input: {
	boundAgentId: string;
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	organizationId: string;
	profile: AuthProfileView;
	queryClient: QueryClient;
	selectedHumanProfile: AuthProfileView | null | undefined;
	spaceContext: CreateProfileSpaceContext;
}): Promise<void> {
	const actingHumanProfile =
		input.selectedHumanProfile ??
		(input.profile.profileKind === "human" ? input.profile : null);
	if (!actingHumanProfile) {
		throw new Error(SPACE_JOIN_REQUIRES_HUMAN_MESSAGE);
	}
	const shouldDeferMembersRefresh =
		input.profile.profileKind === "agent" &&
		input.boundAgentId.trim().length > 0;
	await joinProfileToSpace({
		actingHumanProfile,
		memberProfileIds: [input.profile.openMeldProfileId],
		organizationId: input.organizationId,
		pendingWakeReadinessProfileIds: shouldDeferMembersRefresh
			? [input.profile.openMeldProfileId]
			: [],
		queryClient: input.queryClient,
		spaceId: input.spaceContext.spaceId,
		spaceName: input.spaceContext.spaceName,
	});
	if (shouldDeferMembersRefresh) {
		return;
	}
	Promise.resolve(input.onAfterJoin?.(input.profile)).catch((error) => {
		console.warn(
			"OpenMeld added the new profile to the Space but could not refresh the members panel.",
			error
		);
	});
}

function toCreatedProfileFollowUpMessage(
	error: unknown,
	fallbackMessage: string
): string {
	if (error instanceof NewProfileLocalSetupError && error.message) {
		return error.message;
	}
	return toStructuredApiClientFailure(error).message || fallbackMessage;
}
