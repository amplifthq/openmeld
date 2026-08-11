"use client";

import {
	DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE,
	listAgentControllerPermissionModeOptions,
	resolveAgentControllerPermissionModeForController,
} from "@openmeld/agent-runtime";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import { formatAgentRecoveryActionLabel } from "@openmeld/schemas";
import type {
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	AuthProfileView,
} from "@openmeld/schemas/types";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { resolveLocalFolderPickerDeviceId } from "#/lib/connect/local-folder-picker";
import { useOptionalCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import {
	createNewStartProfile,
	type NewProfileErrorState,
	type NewProfileKind,
	NewProfileLocalSetupError,
} from "#/lib/profiles/create-profile-flow";
import { joinProfileToSpace } from "#/lib/profiles/join-profile-to-space";
import {
	bulkAuthorizeAgentProfileBindingsForOrganization,
	setOrganizationBindingAuthorizationPreference,
} from "#/lib/profiles/organization-binding-authorizations";
import {
	bindableLocalAgentIdsFromTarget,
	resolveProfileBindingCatalogExecutionTarget,
} from "#/lib/profiles/profile-binding-target";
import { useSelectedHumanProfile } from "#/lib/profiles/use-selected-human-profile";
import { refreshWebAgentReadinessFacts } from "#/query/agents/execution-readiness";
import { modelCatalogQueryOptions } from "#/query/config/model-catalog";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { projectsQueryOptions } from "#/query/organizations/projects";
import {
	organizationBindingAuthorizationPreferenceQueryOptions,
	organizationBindingAuthorizationQueryKeys,
} from "#/query/profiles/organization-binding-authorizations";
import {
	agentProfilePrimaryBindingQueryKeys,
	agentProfilePrimaryBindingQueryOptions,
} from "#/query/profiles/primary-binding";
import {
	isAdditionalHumanProfileCreationEnabled,
	profileCapabilitiesQueryOptions,
} from "#/query/profiles/profile-capabilities";
import { startQueryKeys } from "#/query/query-keys";
import { AgentProfileProjectSelector } from "./agent-profile-project-selector";
import { CreateProfileForm } from "./create-profile-form";
import { isOpenCodeAgentId } from "./open-code-permissions-field";

type RecoveryController = ReturnType<typeof useLocalAgentRecoveryController>;

export type CreateProfileSpaceContext = {
	spaceId: string;
	spaceName: string | null;
};

export type CreateProfileOrganizationAuthorizationContext = {
	organizationId: string;
	organizationName: string;
};

const SPACE_JOIN_REQUIRES_HUMAN_MESSAGE =
	"Add a human profile to this account before bringing profiles into this Space.";

// Standalone, route-free Create Profile dialog. Reused from Profiles, legacy
// agent redirects, and Spaces — the only difference is `spaceContext`: when
// present, the freshly created profile is also joined to that Space (always as a
// human acting profile); when absent, it is created on the account only. Carries zero
// dependency on retired start pages or route intents.
export function CreateProfileDialog(input: {
	onAfterJoin?: (profile: AuthProfileView) => void | Promise<void>;
	onOpenChange: (open: boolean) => void;
	onProfileCreated?: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId?: string;
	organizationAuthorizationContext?: CreateProfileOrganizationAuthorizationContext;
	orgSlug?: string;
	recovery: RecoveryController;
	spaceContext?: CreateProfileSpaceContext;
}) {
	const queryClient = useQueryClient();
	const { selectedHumanProfile, profilesQuery } = useSelectedHumanProfile({
		selectDefaultWhenMissing: true,
	});
	const profileCapabilitiesQuery = useQuery(profileCapabilitiesQueryOptions());
	const additionalHumanProfileCreationEnabled =
		isAdditionalHumanProfileCreationEnabled(profileCapabilitiesQuery);
	const [profileKind, setProfileKind] = useState<NewProfileKind | null>(null);
	const selectableProfileKind =
		profileKind === "human" && !additionalHumanProfileCreationEnabled
			? null
			: profileKind;
	const [profileName, setProfileName] = useState("");
	const [boundAgentId, setBoundAgentId] = useState("");
	const [
		boundAgentControllerPermissionMode,
		setBoundAgentControllerPermissionMode,
	] = useState<AgentControllerPermissionMode>(
		DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE
	);
	const [
		boundAgentControllerPermissionModeConfirmed,
		setBoundAgentControllerPermissionModeConfirmed,
	] = useState(false);
	const [boundModelId, setBoundModelId] = useState("");
	const [boundOpenCodePermission, setBoundOpenCodePermission] =
		useState<AgentProfileBindingOpenCodePermission | null>(null);
	const [projectFolderPath, setProjectFolderPath] = useState("");
	const [selectedProjectId, setSelectedProjectId] = useState("");
	const [
		selectedProjectBindingGeneration,
		setSelectedProjectBindingGeneration,
	] = useState<string | null>(null);
	const [projectWorkspaceFallback, setProjectWorkspaceFallback] = useState<
		"advanced" | "managed" | null
	>(null);
	const [boundReasoningLevel, setBoundReasoningLevel] = useState("");
	const [authorizeForOrganization, setAuthorizeForOrganization] =
		useState(true);
	const [
		enableFutureOrganizationAuthorization,
		setEnableFutureOrganizationAuthorization,
	] = useState(false);
	const [errorState, setErrorState] = useState<NewProfileErrorState | null>(
		null
	);
	const { data: modelCatalog = null } = useQuery(modelCatalogQueryOptions());
	const currentOrgSlug = useOptionalCurrentOrganizationSlug();
	const orgSlug = input.orgSlug ?? currentOrgSlug;
	const organizationAuthorizationContext =
		input.organizationAuthorizationContext;
	const organizationId =
		input.organizationId ??
		organizationAuthorizationContext?.organizationId ??
		"";
	const projectsQuery = useQuery(
		projectsQueryOptions({
			enabled: Boolean(organizationId),
			organizationId,
		})
	);
	const organizationAuthorizationPreferenceQuery = useQuery(
		organizationBindingAuthorizationPreferenceQueryOptions({
			enabled: Boolean(organizationAuthorizationContext),
			organizationId: organizationAuthorizationContext?.organizationId ?? "",
		})
	);

	const recovery = input.recovery;
	const spaceContext = input.spaceContext;
	// Resolve the execution target once: it provides both the bindable local
	// agent catalog AND the device/lane the bind must target. recovery.deviceId
	// / recovery.runtimeLane are null when the current-device target is
	// unresolved (no Agent Profile bound yet), so the bind must use this target.
	const bindingTarget = resolveProfileBindingCatalogExecutionTarget(recovery);
	const availableLocalAgentIds = bindableLocalAgentIdsFromTarget(bindingTarget);
	const isResolvingLocalAgents =
		availableLocalAgentIds.length === 0 &&
		isResolvingCreateProfileLocalAgents(recovery);
	const recoveryActionHref = buildConnectComputerPath({
		orgSlug,
		session: "fresh",
	});
	const localFolderPickerDeviceId = resolveLocalFolderPickerDeviceId(
		recovery.currentComputer
	);

	const resetForm = () => {
		setProfileKind(null);
		setProfileName("");
		setBoundAgentId("");
		setBoundAgentControllerPermissionMode(
			DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE
		);
		setBoundAgentControllerPermissionModeConfirmed(false);
		setBoundModelId("");
		setBoundOpenCodePermission(null);
		setProjectFolderPath("");
		setSelectedProjectId("");
		setSelectedProjectBindingGeneration(null);
		setProjectWorkspaceFallback(null);
		setBoundReasoningLevel("");
		setAuthorizeForOrganization(true);
		setEnableFutureOrganizationAuthorization(false);
		setErrorState(null);
	};

	const createProfileMutation = useMutation({
		mutationFn: async () => {
			const agentControllerPermissionMode =
				resolveCreateAgentControllerPermissionMode({
					boundAgentControllerPermissionMode,
					boundAgentId,
				});
			const profile = await createProfileAndMaybeJoinSpace({
				...(agentControllerPermissionMode
					? { agentControllerPermissionMode }
					: {}),
				boundAgentId,
				deviceId: bindingTarget?.deviceId ?? recovery.deviceId,
				modelId: boundAgentId ? boundModelId : null,
				defaultProjectId: resolveSelectedDefaultProjectId({
					selectedProjectBindingGeneration,
					selectedProjectId,
				}),
				openCodePermission: isOpenCodeAgentId(boundAgentId)
					? boundOpenCodePermission
					: null,
				onAfterJoin: input.onAfterJoin,
				organizationId: organizationId || null,
				projectFolderPath: boundAgentId ? projectFolderPath : null,
				profileKind: selectableProfileKind,
				profileName,
				reasoningLevel: boundAgentId ? boundReasoningLevel : null,
				runtimeLane: bindingTarget?.runtimeLane ?? recovery.runtimeLane,
				queryClient,
				selectedHumanProfileId: selectedHumanProfile?.openMeldProfileId ?? null,
				selectedHumanProfile,
				spaceContext,
			});
			const organizationAuthorization =
				await applyCreatedProfileOrganizationAuthorization({
					authorizeForOrganization,
					autoAuthorizeAgentProfileBindings:
						organizationAuthorizationPreferenceQuery.data
							?.autoAuthorizeAgentProfileBindings ?? false,
					boundAgentId,
					enableFutureOrganizationAuthorization,
					organizationAuthorizationContext,
					profile,
					queryClient,
				});
			refreshCreatedProfileCaches({
				boundAgentId,
				createdProfile: profile,
				onAfterJoin: input.onAfterJoin,
				organizationAuthorization,
				queryClient,
				recovery,
				spaceContext,
			}).catch((error) => {
				console.warn(
					"OpenMeld created the profile but could not refresh profile caches.",
					error
				);
			});
			return { organizationAuthorization, profile };
		},
		onError: (error) => {
			if (error instanceof NewProfileLocalSetupError) {
				setErrorState({
					message: error.message,
					setupRefreshActionLabel: error.setupRefreshActionLabel,
					setupRefreshAvailable: error.setupRefreshAvailable,
				});
				return;
			}
			const failure = toStructuredApiClientFailure(error);
			setErrorState({
				message:
					failure.message || "OpenMeld couldn't create the requested profile.",
				setupRefreshActionLabel: formatAgentRecoveryActionLabel(
					"reconnect_openmeld_service"
				),
				setupRefreshAvailable: false,
			});
		},
		onSuccess: ({ organizationAuthorization, profile }) => {
			showCreatedProfileToast({
				organizationAuthorization,
				profile,
				spaceContext,
			});
			input.onProfileCreated?.(profile);
			resetForm();
			input.onOpenChange(false);
		},
	});
	const organizationWakeAccessSlot = organizationAuthorizationContext ? (
		<CreateProfileOrganizationWakeAccessChoice
			authorizeForOrganization={authorizeForOrganization}
			autoAuthorizeAgentProfileBindings={
				organizationAuthorizationPreferenceQuery.data
					?.autoAuthorizeAgentProfileBindings ?? false
			}
			boundAgentId={boundAgentId}
			disabled={createProfileMutation.isPending}
			enableFutureOrganizationAuthorization={
				enableFutureOrganizationAuthorization
			}
			isPreferenceError={organizationAuthorizationPreferenceQuery.isError}
			isPreferencePending={organizationAuthorizationPreferenceQuery.isPending}
			onAuthorizeForOrganizationChange={setAuthorizeForOrganization}
			onEnableFutureOrganizationAuthorizationChange={
				setEnableFutureOrganizationAuthorization
			}
			organizationName={organizationAuthorizationContext.organizationName}
			profileKind={selectableProfileKind}
		/>
	) : null;
	const projectSelectionBlockReason = resolveProjectSelectionBlockReason({
		boundAgentId,
		projectFolderPath,
		projectWorkspaceFallback,
		selectedProjectBindingGeneration,
		selectedProjectId,
	});
	let projectSelectionSlot: ReactNode;
	if (organizationId && projectsQuery.isPending) {
		projectSelectionSlot = (
			<p className="text-muted-foreground text-sm">Loading active Projects.</p>
		);
	} else if (organizationId && !projectsQuery.isError) {
		projectSelectionSlot = (
			<AgentProfileProjectSelector
				disabled={createProfileMutation.isPending}
				manualPath={projectFolderPath}
				onConnectionReady={(connection) => {
					setSelectedProjectBindingGeneration(connection.bindingGeneration);
					setProjectFolderPath(connection.path);
					setProjectWorkspaceFallback(null);
					setErrorState(null);
				}}
				onManualPathChange={(path) => {
					setProjectWorkspaceFallback("advanced");
					setProjectFolderPath(path);
					setErrorState(null);
				}}
				onProjectChange={(projectId) => {
					setSelectedProjectId(projectId);
					setSelectedProjectBindingGeneration(null);
					setProjectFolderPath("");
					setProjectWorkspaceFallback(null);
					setErrorState(null);
				}}
				onUseAdvancedWorkspace={() => {
					setSelectedProjectBindingGeneration(null);
					setProjectWorkspaceFallback("advanced");
					setErrorState(null);
				}}
				onUseManagedWorkspace={() => {
					setSelectedProjectBindingGeneration(null);
					setProjectFolderPath("");
					setProjectWorkspaceFallback("managed");
					setErrorState(null);
				}}
				organizationId={organizationId}
				projectId={selectedProjectId}
				projects={projectsQuery.data?.projects ?? []}
				selectedBindingGeneration={selectedProjectBindingGeneration}
				workspaceFallbackMode={projectWorkspaceFallback}
			/>
		);
	}

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (createProfileMutation.isPending) {
					return;
				}
				if (!nextOpen) {
					resetForm();
				}
				input.onOpenChange(nextOpen);
			}}
			open={input.open}
		>
			<DialogContent className="flex max-h-[min(42rem,calc(100dvh-2rem))] flex-col overflow-hidden sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{additionalHumanProfileCreationEnabled
							? "Create a new profile"
							: "Create a new Agent"}
					</DialogTitle>
					<DialogDescription>
						{resolveCreateProfileDialogDescription({
							additionalHumanProfileCreationEnabled,
							spaceContext,
						})}
					</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 flex-1 overflow-y-auto pr-1">
					<CreateProfileForm
						additionalHumanProfileCreationEnabled={
							additionalHumanProfileCreationEnabled
						}
						availableLocalAgentIds={availableLocalAgentIds}
						boundAgentControllerPermissionMode={
							boundAgentControllerPermissionMode
						}
						boundAgentControllerPermissionModeConfirmed={
							boundAgentControllerPermissionModeConfirmed
						}
						boundAgentId={boundAgentId}
						boundModelId={boundModelId}
						boundOpenCodePermission={boundOpenCodePermission}
						boundReasoningLevel={boundReasoningLevel}
						errorState={errorState}
						isResolvingAccount={profilesQuery.isPending}
						isResolvingLocalAgents={isResolvingLocalAgents}
						isSubmitting={createProfileMutation.isPending}
						localFolderPickerDeviceId={localFolderPickerDeviceId}
						modelCatalog={modelCatalog}
						onChangeBoundAgentControllerPermissionMode={(
							nextAgentControllerPermissionMode
						) => {
							setBoundAgentControllerPermissionMode(
								resolveAgentControllerPermissionModeForController(
									nextAgentControllerPermissionMode,
									{
										agentControllerRef:
											buildBuiltinAgentControllerRef(boundAgentId),
									}
								)
							);
							setErrorState(null);
						}}
						onChangeBoundAgentControllerPermissionModeConfirmed={
							setBoundAgentControllerPermissionModeConfirmed
						}
						onChangeBoundAgentId={(nextAgentId) => {
							setBoundAgentId(nextAgentId);
							setBoundAgentControllerPermissionMode(
								DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE
							);
							setBoundAgentControllerPermissionModeConfirmed(false);
							setBoundModelId("");
							setBoundOpenCodePermission(null);
							setBoundReasoningLevel("");
							setProjectFolderPath("");
							setSelectedProjectId("");
							setSelectedProjectBindingGeneration(null);
							setProjectWorkspaceFallback(null);
							setErrorState(null);
						}}
						onChangeBoundModelId={(nextModelId) => {
							setBoundModelId(nextModelId);
							setBoundReasoningLevel("");
							setErrorState(null);
						}}
						onChangeBoundOpenCodePermission={(nextOpenCodePermission) => {
							setBoundOpenCodePermission(nextOpenCodePermission);
							setErrorState(null);
						}}
						onChangeBoundReasoningLevel={(nextReasoningLevel) => {
							setBoundReasoningLevel(nextReasoningLevel);
							setErrorState(null);
						}}
						onChangeProfileName={(nextProfileName) => {
							setProfileName(nextProfileName);
							setErrorState(null);
						}}
						onChangeProjectFolderPath={(nextProjectFolderPath) => {
							setProjectFolderPath(nextProjectFolderPath);
							setErrorState(null);
						}}
						onSelectProfileKind={(nextProfileKind) => {
							if (
								nextProfileKind === "human" &&
								!additionalHumanProfileCreationEnabled
							) {
								return;
							}
							setProfileKind(nextProfileKind);
							if (nextProfileKind !== "agent") {
								setBoundAgentId("");
								setBoundAgentControllerPermissionMode(
									DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE
								);
								setBoundAgentControllerPermissionModeConfirmed(false);
								setBoundModelId("");
								setBoundOpenCodePermission(null);
								setProjectFolderPath("");
								setSelectedProjectId("");
								setSelectedProjectBindingGeneration(null);
								setProjectWorkspaceFallback(null);
								setBoundReasoningLevel("");
							}
							setErrorState(null);
						}}
						onSubmit={(event) => {
							event.preventDefault();
							setErrorState(null);
							createProfileMutation.mutate();
						}}
						organizationWakeAccessSlot={organizationWakeAccessSlot}
						profileKind={selectableProfileKind}
						profileName={profileName}
						projectFolderPath={projectFolderPath}
						projectSelectionBlockReason={projectSelectionBlockReason}
						projectSelectionSlot={projectSelectionSlot}
						recoveryActionHref={recoveryActionHref}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function resolveCreateProfileDialogDescription(input: {
	additionalHumanProfileCreationEnabled: boolean;
	spaceContext: CreateProfileSpaceContext | undefined;
}): string {
	if (input.spaceContext) {
		return input.additionalHumanProfileCreationEnabled
			? `Create a profile and bring it into ${input.spaceContext.spaceName ?? "this Space"}.`
			: `Create an Agent and bring it into ${input.spaceContext.spaceName ?? "this Space"}.`;
	}
	return input.additionalHumanProfileCreationEnabled
		? "Create a person or Agent on this account."
		: "Create an Agent on this account.";
}

function resolveProjectSelectionBlockReason(input: {
	boundAgentId: string;
	projectFolderPath: string;
	projectWorkspaceFallback: "advanced" | "managed" | null;
	selectedProjectBindingGeneration: string | null;
	selectedProjectId: string;
}): string | null {
	if (!(input.boundAgentId && input.selectedProjectId)) {
		return null;
	}
	if (input.selectedProjectBindingGeneration) {
		return null;
	}
	if (input.projectWorkspaceFallback === "managed") {
		return null;
	}
	if (input.projectWorkspaceFallback === "advanced") {
		return input.projectFolderPath.trim()
			? null
			: "Enter the full workspace path.";
	}
	return "Choose a connected folder or another workspace option.";
}

function resolveCreateAgentControllerPermissionMode(input: {
	boundAgentControllerPermissionMode: AgentControllerPermissionMode;
	boundAgentId: string;
}): AgentControllerPermissionMode | null {
	if (!input.boundAgentId) {
		return null;
	}
	const agentControllerRef = buildBuiltinAgentControllerRef(input.boundAgentId);
	if (
		listAgentControllerPermissionModeOptions({ agentControllerRef }).length ===
		0
	) {
		return null;
	}
	return resolveAgentControllerPermissionModeForController(
		input.boundAgentControllerPermissionMode,
		{ agentControllerRef }
	);
}

function resolveSelectedDefaultProjectId(input: {
	selectedProjectBindingGeneration: string | null;
	selectedProjectId: string;
}): string | null {
	return input.selectedProjectId && input.selectedProjectBindingGeneration
		? input.selectedProjectId
		: null;
}

async function createProfileAndMaybeJoinSpace(input: {
	agentControllerPermissionMode?: AgentControllerPermissionMode;
	boundAgentId: string;
	defaultProjectId: string | null;
	deviceId: string | null;
	modelId: string | null;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
	onAfterJoin?: (profile: AuthProfileView) => void | Promise<void>;
	organizationId: string | null;
	projectFolderPath: string | null;
	profileKind: NewProfileKind | null;
	profileName: string;
	queryClient: QueryClient;
	reasoningLevel: string | null;
	runtimeLane: Parameters<typeof createNewStartProfile>[0]["runtimeLane"];
	selectedHumanProfile: AuthProfileView | null | undefined;
	selectedHumanProfileId: string | null;
	spaceContext: CreateProfileSpaceContext | undefined;
}): Promise<AuthProfileView> {
	// When joining a Space, membership must be managed by a human. If the
	// account has no human profile and we are not creating one, fail before the
	// irreversible create so we never orphan a created/bound profile.
	if (
		input.spaceContext &&
		!input.selectedHumanProfile &&
		input.profileKind !== "human"
	) {
		throw new Error(SPACE_JOIN_REQUIRES_HUMAN_MESSAGE);
	}

	const profile = await createNewStartProfile({
		...(input.agentControllerPermissionMode
			? { agentControllerPermissionMode: input.agentControllerPermissionMode }
			: {}),
		boundAgentId: input.boundAgentId,
		defaultProjectId: input.defaultProjectId,
		deviceId: input.deviceId,
		modelId: input.modelId,
		openCodePermission: input.openCodePermission,
		organizationId: input.organizationId,
		projectFolderPath: input.projectFolderPath,
		profileKind: input.profileKind,
		profileName: input.profileName,
		reasoningLevel: input.reasoningLevel,
		runtimeLane: input.runtimeLane,
		selectedHumanProfileId: input.selectedHumanProfileId,
	});

	if (input.spaceContext) {
		await joinCreatedProfileToSpace({
			boundAgentId: input.boundAgentId,
			onAfterJoin: input.onAfterJoin,
			profile,
			queryClient: input.queryClient,
			selectedHumanProfile: input.selectedHumanProfile,
			spaceContext: input.spaceContext,
		});
	}

	return profile;
}

type CreatedProfileOrganizationAuthorizationResult =
	| {
			organizationId: string;
			organizationName: string;
			preferenceUpdateFailed: boolean;
			status: "authorized";
	  }
	| {
			errorMessage: string;
			organizationName: string;
			status: "failed";
	  }
	| {
			status: "not_applicable" | "skipped";
	  };

async function applyCreatedProfileOrganizationAuthorization(input: {
	authorizeForOrganization: boolean;
	autoAuthorizeAgentProfileBindings: boolean;
	boundAgentId: string;
	enableFutureOrganizationAuthorization: boolean;
	organizationAuthorizationContext:
		| CreateProfileOrganizationAuthorizationContext
		| undefined;
	profile: AuthProfileView;
	queryClient: QueryClient;
}): Promise<CreatedProfileOrganizationAuthorizationResult> {
	if (!input.organizationAuthorizationContext) {
		return { status: "not_applicable" };
	}
	if (input.profile.profileKind !== "agent") {
		return { status: "not_applicable" };
	}
	if (!input.boundAgentId.trim()) {
		return { status: "skipped" };
	}

	const organization = input.organizationAuthorizationContext;
	const shouldAuthorize =
		input.autoAuthorizeAgentProfileBindings || input.authorizeForOrganization;
	if (!shouldAuthorize) {
		return { status: "skipped" };
	}

	try {
		await bulkAuthorizeAgentProfileBindingsForOrganization({
			agentProfileIds: [input.profile.openMeldProfileId],
			organizationId: organization.organizationId,
		});
		const preferenceUpdateFailed =
			input.enableFutureOrganizationAuthorization &&
			!input.autoAuthorizeAgentProfileBindings
				? await setCreatedProfileOrganizationAuthorizationPreference({
						organizationId: organization.organizationId,
					})
				: false;
		await refreshOrganizationAuthorizationCaches({
			organizationId: organization.organizationId,
			queryClient: input.queryClient,
		});
		return {
			organizationId: organization.organizationId,
			organizationName: organization.organizationName,
			preferenceUpdateFailed,
			status: "authorized",
		};
	} catch (error) {
		const failure = toStructuredApiClientFailure(error);
		return {
			errorMessage:
				failure.message ||
				`OpenMeld could not authorize this Agent for ${organization.organizationName}.`,
			organizationName: organization.organizationName,
			status: "failed",
		};
	}
}

async function setCreatedProfileOrganizationAuthorizationPreference(input: {
	organizationId: string;
}): Promise<boolean> {
	try {
		await setOrganizationBindingAuthorizationPreference({
			autoAuthorizeAgentProfileBindings: true,
			organizationId: input.organizationId,
		});
		return false;
	} catch (error) {
		console.warn(
			"OpenMeld authorized the new Agent but could not update the organization Wake access preference.",
			error
		);
		return true;
	}
}

async function refreshOrganizationAuthorizationCaches(input: {
	organizationId: string;
	queryClient: QueryClient;
}): Promise<void> {
	await Promise.allSettled([
		input.queryClient.invalidateQueries({
			queryKey: organizationQueryKeys.directory(input.organizationId),
		}),
		input.queryClient.invalidateQueries({
			queryKey: organizationBindingAuthorizationQueryKeys.byOrganization(
				input.organizationId
			),
		}),
		input.queryClient.invalidateQueries({
			queryKey: organizationBindingAuthorizationQueryKeys.preference(
				input.organizationId
			),
		}),
	]);
}

function showCreatedProfileToast(input: {
	organizationAuthorization: CreatedProfileOrganizationAuthorizationResult;
	profile: AuthProfileView;
	spaceContext: CreateProfileSpaceContext | undefined;
}) {
	if (input.organizationAuthorization.status === "failed") {
		toast.error(
			`${input.profile.profileName} was created, but OpenMeld couldn't authorize it for ${input.organizationAuthorization.organizationName}.`
		);
		return;
	}

	if (input.organizationAuthorization.status === "authorized") {
		if (input.organizationAuthorization.preferenceUpdateFailed) {
			toast.warning(
				`${input.profile.profileName} was created and authorized for ${input.organizationAuthorization.organizationName}. OpenMeld couldn't update automatic authorization.`
			);
			return;
		}
		toast.success(
			`${input.profile.profileName} was created and authorized for ${input.organizationAuthorization.organizationName}.`
		);
		return;
	}

	toast.success(
		input.spaceContext
			? `${input.profile.profileName} was created and added to ${input.spaceContext.spaceName ?? "this Space"}.`
			: `${input.profile.profileName} was created.`
	);
}

function CreateProfileOrganizationWakeAccessChoice(input: {
	authorizeForOrganization: boolean;
	autoAuthorizeAgentProfileBindings: boolean;
	boundAgentId: string;
	disabled: boolean;
	enableFutureOrganizationAuthorization: boolean;
	isPreferenceError: boolean;
	isPreferencePending: boolean;
	onAuthorizeForOrganizationChange: (checked: boolean) => void;
	onEnableFutureOrganizationAuthorizationChange: (checked: boolean) => void;
	organizationName: string;
	profileKind: NewProfileKind | null;
}) {
	if (input.profileKind !== "agent") {
		return null;
	}

	if (!input.boundAgentId.trim()) {
		return (
			<div className="grid gap-1 py-1">
				<p className="font-medium text-sm">
					Use this Agent in {input.organizationName}
				</p>
				<p className="text-muted-foreground text-xs leading-5">
					Choose a local agent above to let {input.organizationName} Wake this
					Agent from its Spaces. Choose later creates it only in your account
					for now.
				</p>
			</div>
		);
	}

	if (input.autoAuthorizeAgentProfileBindings) {
		return (
			<div className="grid gap-1 py-1">
				<p className="font-medium text-sm">
					Will be available in {input.organizationName}
				</p>
				<p className="text-muted-foreground text-xs leading-5">
					New connected Agents are automatically authorized for this
					organization.
				</p>
			</div>
		);
	}

	return (
		<div className="grid gap-3 py-1">
			<label className="flex items-start gap-3 text-sm">
				<input
					checked={input.authorizeForOrganization}
					className="mt-0.5 size-4 shrink-0 accent-foreground"
					disabled={input.disabled}
					onChange={(event) => {
						input.onAuthorizeForOrganizationChange(event.target.checked);
						if (!event.target.checked) {
							input.onEnableFutureOrganizationAuthorizationChange(false);
						}
					}}
					type="checkbox"
				/>
				<span>
					<span className="block font-medium text-foreground">
						Use this Agent in {input.organizationName}
					</span>
					<span className="mt-1 block text-muted-foreground text-xs leading-5">
						Members of {input.organizationName} will be able to Wake this Agent
						from {input.organizationName} Spaces.
					</span>
				</span>
			</label>
			{input.authorizeForOrganization ? (
				<label className="flex items-start gap-3 text-sm">
					<input
						checked={input.enableFutureOrganizationAuthorization}
						className="mt-0.5 size-4 shrink-0 accent-foreground"
						disabled={input.disabled}
						onChange={(event) => {
							input.onEnableFutureOrganizationAuthorizationChange(
								event.target.checked
							);
						}}
						type="checkbox"
					/>
					<span>
						<span className="block font-medium text-foreground">
							Automatically authorize my new Agents in {input.organizationName}
						</span>
						<span className="mt-1 block text-muted-foreground text-xs leading-5">
							Future connected Agents you create from this organization will
							receive Wake access automatically.
						</span>
					</span>
				</label>
			) : null}
			{input.isPreferencePending || input.isPreferenceError ? (
				<p className="text-muted-foreground text-xs leading-5">
					{input.isPreferencePending
						? `Checking ${input.organizationName} Wake access preference.`
						: `OpenMeld could not read ${input.organizationName} Wake access preference, so this choice applies to this profile only.`}
				</p>
			) : null}
		</div>
	);
}

function buildBuiltinAgentControllerRef(agentId: string): string {
	return `builtin:${agentId}`;
}

async function joinCreatedProfileToSpace(input: {
	boundAgentId: string;
	onAfterJoin?: (profile: AuthProfileView) => void | Promise<void>;
	profile: AuthProfileView;
	queryClient: QueryClient;
	selectedHumanProfile: AuthProfileView | null | undefined;
	spaceContext: CreateProfileSpaceContext;
}) {
	// Always act as a human: the default/selected human, or when this is the
	// account's first human, the profile we just created.
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
	// Best-effort: imperatively refresh the Space members panel, whose members
	// query is enabled:false and only refetches on demand.
	Promise.resolve(input.onAfterJoin?.(input.profile)).catch((error) => {
		console.warn(
			"OpenMeld added the new profile to the Space but could not refresh the members panel.",
			error
		);
	});
}

async function refreshCreatedProfileCaches(input: {
	boundAgentId: string;
	createdProfile: AuthProfileView;
	onAfterJoin?: (profile: AuthProfileView) => void | Promise<void>;
	organizationAuthorization: CreatedProfileOrganizationAuthorizationResult;
	queryClient: QueryClient;
	recovery: RecoveryController;
	spaceContext: CreateProfileSpaceContext | undefined;
}) {
	// Best-effort: surface the new profile in the account/agent lists. A refresh
	// failure must not report a successful create as a failure.
	try {
		await input.queryClient.invalidateQueries({
			queryKey: startQueryKeys.profilesForStorageScope(
				input.recovery.storageScope
			),
		});
		if (
			input.createdProfile.profileKind === "agent" &&
			input.boundAgentId.trim().length > 0
		) {
			await refreshOrganizationDirectoryAfterCreatedProfileAuthorization(input);
			await refreshCreatedAgentProfileLocalState(input);
			if (input.spaceContext) {
				await Promise.resolve(input.onAfterJoin?.(input.createdProfile)).catch(
					(error) => {
						console.warn(
							"OpenMeld refreshed the new Agent but could not refresh the Space members panel.",
							error
						);
					}
				);
			}
		}
		await input.recovery.refreshAll();
	} catch (error) {
		console.warn(
			"OpenMeld created the profile but could not refresh the local profile lists.",
			error
		);
	}
}

async function refreshOrganizationDirectoryAfterCreatedProfileAuthorization(input: {
	organizationAuthorization: CreatedProfileOrganizationAuthorizationResult;
	queryClient: QueryClient;
}): Promise<void> {
	if (input.organizationAuthorization.status !== "authorized") {
		return;
	}
	await input.queryClient.invalidateQueries({
		queryKey: organizationQueryKeys.directory(
			input.organizationAuthorization.organizationId
		),
		refetchType: "active",
	});
}

async function refreshCreatedAgentProfileLocalState(input: {
	createdProfile: AuthProfileView;
	queryClient: QueryClient;
	recovery: RecoveryController;
}) {
	const results = await Promise.allSettled([
		refreshWebAgentReadinessFacts({
			agentProfileIds: [input.createdProfile.openMeldProfileId],
			maxAttempts: 3,
			queryClient: input.queryClient,
			storageScope: input.recovery.storageScope,
		}),
		refreshCreatedAgentProfilePrimaryBinding(input),
	]);

	for (const result of results) {
		if (result.status === "rejected") {
			console.warn(
				"OpenMeld created the Agent but could not refresh its local readiness cache.",
				result.reason
			);
		}
	}
}

async function refreshCreatedAgentProfilePrimaryBinding(input: {
	createdProfile: AuthProfileView;
	queryClient: QueryClient;
	recovery: RecoveryController;
}) {
	const queryKey = agentProfilePrimaryBindingQueryKeys.profile(
		input.recovery.storageScope,
		input.createdProfile.openMeldProfileId
	);
	await input.queryClient.invalidateQueries({ queryKey });
	await input.queryClient.fetchQuery(
		agentProfilePrimaryBindingQueryOptions({
			agentProfileId: input.createdProfile.openMeldProfileId,
			enabled: true,
			storageScope: input.recovery.storageScope,
		})
	);
}

function isResolvingCreateProfileLocalAgents(
	recovery: RecoveryController
): boolean {
	return (
		recovery.currentDeviceTargetQuery.fetchStatus === "fetching" ||
		recovery.localRuntimesQuery.fetchStatus === "fetching" ||
		recovery.currentLocalRuntimeReplyReadinessQuery.fetchStatus === "fetching"
	);
}
