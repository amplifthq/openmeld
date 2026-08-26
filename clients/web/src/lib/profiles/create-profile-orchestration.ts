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
import { deleteStartAgentProfile } from "#/lib/profiles/delete-agent-profile";
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

export class SessionProfileCreationRolledBackError extends Error {
	constructor(cause: unknown) {
		super(
			toCreatedProfileFollowUpMessage(
				cause,
				"OpenMeld couldn't connect this Session to the new Agent Profile."
			),
			{ cause }
		);
		this.name = "SessionProfileCreationRolledBackError";
	}
}

// This is the single phase-order owner for interactive Profile creation. The
// Auth create response is normally the commit point, so later follow-up errors
// cannot escape as create failures. The one exception is a Session-preset
// setup failure before Core establishes its Binding: that incomplete identity
// is removed before the error escapes.
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
	let localSetupAttempted = false;
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

	// Resume eligibility is revalidated by Core during the Binding write. Run
	// that write before Space membership so a Session that changed while this
	// dialog was open can be compensated without leaving a visible orphan.
	if (profile.profileKind === "agent" && input.sessionInventorySelection) {
		localSetupAttempted = true;
		try {
			profile = await setupLocalState();
		} catch (error) {
			if (!didLocalSetupEstablishBinding(error)) {
				await removeIncompleteSessionProfile({ error, profile });
				throw new SessionProfileCreationRolledBackError(error);
			}
			followUpIssues.push(buildLocalSetupFollowUpIssue(error));
		}
	}

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

	if (profile.profileKind === "agent" && !localSetupAttempted) {
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

function didLocalSetupEstablishBinding(error: unknown): boolean {
	return error instanceof NewProfileLocalSetupError && error.bindingEstablished;
}

async function removeIncompleteSessionProfile(input: {
	error: unknown;
	profile: AuthProfileView;
}): Promise<void> {
	try {
		await deleteStartAgentProfile({ data: input.profile.openMeldProfileId });
	} catch (cleanupError) {
		const setupFailureMessage = toCreatedProfileFollowUpMessage(
			input.error,
			"OpenMeld couldn't connect this Session to the new Agent Profile."
		);
		throw new Error(
			`${setupFailureMessage} OpenMeld also couldn't remove the incomplete Agent Profile. Open Agent Profiles and remove it before trying again.`,
			{
				cause: new AggregateError(
					[input.error, cleanupError],
					"Session Agent Profile rollback failed."
				),
			}
		);
	}
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
