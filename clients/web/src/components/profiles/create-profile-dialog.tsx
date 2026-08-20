"use client";

import {
	DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE,
	listAgentControllerPermissionModeOptions,
	parseAgentControllerRef,
	resolveAgentControllerPermissionModeForController,
} from "@openmeld/agent-runtime";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import { formatAgentRecoveryActionLabel } from "@openmeld/schemas";
import type {
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	AgentProfileCreationRequest,
	AuthProfileView,
	GetAgentProfileCreationDefaultsResponse,
	ListProjectsResponse,
	ModelCatalog,
	OrganizationComputersResponse,
	OrganizationDirectoryResponse,
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
import {
	type FormEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { resolveLocalFolderPickerDeviceId } from "#/lib/connect/local-folder-picker";
import { useOptionalCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import {
	resolveRememberedAgentProfileCreationDefaults,
	setAgentProfileCreationDefaults,
} from "#/lib/profiles/agent-profile-creation-defaults";
import { createAgentProfileCreationRequest } from "#/lib/profiles/agent-profile-creation-requests";
import type {
	NewProfileErrorState,
	NewProfileKind,
} from "#/lib/profiles/create-profile-flow";
import {
	type CreatedProfileFollowUpIssue,
	type CreateProfileSpaceContext,
	createProfileWithFollowUps,
} from "#/lib/profiles/create-profile-orchestration";
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
import {
	organizationComputersQueryOptions,
	organizationDirectoryQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import { projectsQueryOptions } from "#/query/organizations/projects";
import {
	agentProfileCreationDefaultsQueryKeys,
	agentProfileCreationDefaultsQueryOptions,
} from "#/query/profiles/agent-profile-creation-defaults";
import { agentProfileCreationRequestQueryKeys } from "#/query/profiles/agent-profile-creation-requests";
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
import type { AgentProfileBindingChoice } from "./agent-binding-choice-list";
import {
	AgentProfileOwnerChoice,
	type AgentProfileOwnerMode,
} from "./agent-profile-owner-choice";
import { AgentProfileProjectSelector } from "./agent-profile-project-selector";
import { CreateProfileForm } from "./create-profile-form";
import { formatLocalAgentDisplayName } from "./local-agent-display-name";
import { isOpenCodeAgentId } from "./open-code-permissions-field";
import { RequestedAgentProjectField } from "./requested-agent-project-field";

type RecoveryController = ReturnType<typeof useLocalAgentRecoveryController>;

export type { CreateProfileSpaceContext } from "#/lib/profiles/create-profile-orchestration";

export type CreateProfileOrganizationAuthorizationContext = {
	organizationId: string;
	organizationName: string;
};

// Standalone, route-free Create Profile dialog. Reused from Profiles, legacy
// agent redirects, and Spaces — the only difference is `spaceContext`: when
// present, the freshly created profile is also joined to that Space (always as a
// human acting profile); when absent, it is created in the selected Organization
// without Space membership. Carries zero dependency on retired start pages or
// route intents.
export function CreateProfileDialog(input: {
	allowTeammateRequests?: boolean;
	currentUserId?: string;
	onAfterJoin?: (profile: AuthProfileView) => void | Promise<void>;
	onAgentRequestCreated?: (request: AgentProfileCreationRequest) => void;
	onOpenChange: (open: boolean) => void;
	onProfileCreated?: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId: string;
	organizationAuthorizationContext?: CreateProfileOrganizationAuthorizationContext;
	orgSlug?: string;
	recovery: RecoveryController;
	spaceContext?: CreateProfileSpaceContext;
}) {
	const queryClient = useQueryClient();
	const currentUserId = input.currentUserId ?? "";
	const { selectedHumanProfile, profilesQuery } = useSelectedHumanProfile({
		selectDefaultWhenMissing: true,
	});
	const profileCapabilitiesQuery = useQuery(profileCapabilitiesQueryOptions());
	const additionalHumanProfileCreationEnabled =
		isAdditionalHumanProfileCreationEnabled(profileCapabilitiesQuery);
	const [profileKind, setProfileKind] = useState<NewProfileKind | null>(null);
	const [ownerMode, setOwnerMode] = useState<AgentProfileOwnerMode>("self");
	const [targetOwnerUserId, setTargetOwnerUserId] = useState("");
	const [agentBindingValue, setAgentBindingValue] = useState("");
	const selectableProfileKind = resolveSelectableProfileKind({
		additionalHumanProfileCreationEnabled,
		profileKind,
	});
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
	const submissionInFlightRef = useRef(false);
	const creationIntentRef = useRef<{
		fingerprint: string;
		idempotencyKey: string;
	} | null>(null);
	const appliedCreationDefaultsKeyRef = useRef<string | null>(null);
	const creationDefaultsEditedRef = useRef(false);
	const { data: modelCatalog = null } = useQuery(modelCatalogQueryOptions());
	const currentOrgSlug = useOptionalCurrentOrganizationSlug();
	const orgSlug = input.orgSlug ?? currentOrgSlug;
	const organizationAuthorizationContext =
		input.organizationAuthorizationContext;
	const organizationId = input.organizationId;
	const canRequestForTeammate = canRequestTeammateAgent({
		allowTeammateRequests: input.allowTeammateRequests,
		currentUserId,
	});
	const teammateQueriesEnabled = input.open && canRequestForTeammate;
	const organizationDirectoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: teammateQueriesEnabled,
			organizationId,
		})
	);
	const organizationComputersQuery = useQuery(
		organizationComputersQueryOptions({
			enabled: teammateQueriesEnabled,
			organizationId,
		})
	);
	const projectsQuery = useQuery(
		projectsQueryOptions({
			enabled: Boolean(organizationId),
			organizationId,
		})
	);
	const agentControllerRef = resolveAgentControllerRef(boundAgentId);
	const creationDefaultsQuery = useQuery(
		agentProfileCreationDefaultsQueryOptions({
			agentControllerRef,
			enabled: shouldReadCreationDefaults({
				agentControllerRef,
				open: input.open,
				organizationId,
				ownerMode,
			}),
			organizationId,
		})
	);
	const organizationAuthorizationPreferenceQuery = useQuery(
		organizationBindingAuthorizationPreferenceQueryOptions({
			enabled: shouldReadOrganizationAuthorizationPreference({
				organizationAuthorizationContext,
				ownerMode,
			}),
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
	const ownLocalAgentIds = bindableLocalAgentIdsFromTarget(bindingTarget);
	const teammateBindingOptions = useMemo(
		() =>
			resolveTeammateBindingOptions({
				computers: organizationComputersQuery.data ?? null,
				targetOwnerUserId,
			}),
		[organizationComputersQuery.data, targetOwnerUserId]
	);
	const selectedTeammateBinding = teammateBindingOptions.find(
		(option) => option.choice.value === agentBindingValue
	);
	const { availableLocalAgentIds, isResolvingLocalAgents } =
		resolveAvailableLocalAgents({
			organizationComputersPending: organizationComputersQuery.isPending,
			ownLocalAgentIds,
			ownerMode,
			recovery,
			teammateBindingOptions,
		});
	const recoveryActionHref = buildConnectComputerPath({
		orgSlug,
		session: "fresh",
	});
	const localFolderPickerDeviceId = resolveLocalFolderPickerDeviceId(
		recovery.currentComputer
	);

	useDefaultTeammateSelection({
		currentUserId,
		directory: organizationDirectoryQuery.data,
		onSelect: setTargetOwnerUserId,
		targetOwnerUserId,
	});
	useRememberedCreationDefaults({
		agentControllerRef,
		appliedCreationDefaultsKeyRef,
		boundAgentId,
		creationDefaults: creationDefaultsQuery.data,
		creationDefaultsEditedRef,
		modelCatalog,
		onApply: (remembered) => {
			setBoundAgentControllerPermissionMode(
				remembered.agentControllerPermissionMode
			);
			setBoundAgentControllerPermissionModeConfirmed(false);
			setBoundModelId(remembered.modelId ?? "");
			setBoundOpenCodePermission(remembered.openCodePermission);
			setBoundReasoningLevel(remembered.reasoningLevel ?? "");
			setSelectedProjectId(remembered.defaultProjectId ?? "");
			setSelectedProjectBindingGeneration(null);
			setProjectFolderPath("");
			setProjectWorkspaceFallback(
				remembered.defaultProjectId ? null : "managed"
			);
		},
		organizationId,
		projects: projectsQuery.data,
		projectsPending: projectsQuery.isPending,
	});

	const resetForm = () => {
		submissionInFlightRef.current = false;
		creationIntentRef.current = null;
		appliedCreationDefaultsKeyRef.current = null;
		creationDefaultsEditedRef.current = false;
		setProfileKind(null);
		setOwnerMode("self");
		setTargetOwnerUserId("");
		setAgentBindingValue("");
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
		mutationFn: (submission: { idempotencyKey: string }) =>
			submitProfileCreation({
				agentControllerPermissionMode:
					resolveCreateAgentControllerPermissionMode({
						boundAgentControllerPermissionMode,
						boundAgentId,
					}),
				agentControllerRef,
				authorizeForOrganization,
				autoAuthorizeAgentProfileBindings:
					organizationAuthorizationPreferenceQuery.data
						?.autoAuthorizeAgentProfileBindings ?? false,
				bindingTarget,
				boundAgentId,
				boundModelId,
				boundOpenCodePermission,
				boundReasoningLevel,
				enableFutureOrganizationAuthorization,
				idempotencyKey: submission.idempotencyKey,
				onAfterJoin: input.onAfterJoin,
				organizationAuthorizationContext,
				organizationId,
				ownerMode,
				profileKind: selectableProfileKind,
				profileName,
				projectFolderPath,
				queryClient,
				recovery,
				selectedHumanProfile,
				selectedProjectBindingGeneration,
				selectedProjectId,
				selectedTeammateBinding,
				spaceContext,
				targetOwnerUserId,
			}),
		onError: (error) => {
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
		onSuccess: (result) =>
			handleProfileCreationSuccess({
				onAgentRequestCreated: input.onAgentRequestCreated,
				onClose: () => input.onOpenChange(false),
				onProfileCreated: input.onProfileCreated,
				onReset: resetForm,
				organizationId,
				queryClient,
				result,
				spaceContext,
			}),
		onSettled: () => {
			submissionInFlightRef.current = false;
		},
	});
	const organizationWakeAccessSlot = renderOrganizationWakeAccessSlot({
		authorizeForOrganization,
		autoAuthorizeAgentProfileBindings:
			organizationAuthorizationPreferenceQuery.data
				?.autoAuthorizeAgentProfileBindings ?? false,
		boundAgentId,
		disabled: createProfileMutation.isPending,
		enableFutureOrganizationAuthorization,
		isPreferenceError: organizationAuthorizationPreferenceQuery.isError,
		isPreferencePending: organizationAuthorizationPreferenceQuery.isPending,
		onAuthorizeForOrganizationChange: setAuthorizeForOrganization,
		onEnableFutureOrganizationAuthorizationChange:
			setEnableFutureOrganizationAuthorization,
		organizationAuthorizationContext,
		ownerMode,
		profileKind: selectableProfileKind,
	});
	const projectSelectionBlockReason = resolveOwnerProjectSelectionBlockReason({
		boundAgentId,
		ownerMode,
		projectFolderPath,
		projectWorkspaceFallback,
		selectedProjectBindingGeneration,
		selectedProjectId,
	});
	const projectSelectionSlot = renderProjectSelectionSlot({
		creationDefaultsEditedRef,
		disabled: createProfileMutation.isPending,
		onErrorClear: () => setErrorState(null),
		organizationId,
		ownerMode,
		projectFolderPath,
		projects: projectsQuery.data,
		projectsError: projectsQuery.isError,
		projectsPending: projectsQuery.isPending,
		projectWorkspaceFallback,
		selectedProjectBindingGeneration,
		selectedProjectId,
		setProjectFolderPath,
		setProjectWorkspaceFallback,
		setSelectedProjectBindingGeneration,
		setSelectedProjectId,
	});
	const ownerChoice = renderAgentProfileOwnerChoice({
		canRequestForTeammate,
		currentUserId,
		disabled: createProfileMutation.isPending,
		members: organizationDirectoryQuery.data?.members ?? [],
		onResetBinding: (nextMode) => {
			setAgentBindingValue("");
			setBoundAgentId("");
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
			setProjectWorkspaceFallback(nextMode === "self" ? "managed" : null);
			setErrorState(null);
		},
		onResetTeammate: (userId) => {
			setTargetOwnerUserId(userId);
			setAgentBindingValue("");
			setBoundAgentId("");
			setBoundModelId("");
			setBoundReasoningLevel("");
			setSelectedProjectId("");
			setErrorState(null);
		},
		ownerMode,
		setOwnerMode,
		targetOwnerUserId,
	});
	const teammateBindingChoices = resolveTeammateBindingChoices({
		ownerMode,
		options: teammateBindingOptions,
	});
	const additionalSubmitBlockReason = resolveOwnerSubmitBlockReason({
		directoryPending: organizationDirectoryQuery.isPending,
		ownerMode,
		targetOwnerUserId,
	});

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				handleCreateProfileDialogOpenChange({
					isSubmitting: createProfileMutation.isPending,
					nextOpen,
					onClose: resetForm,
					onOpenChange: input.onOpenChange,
				});
			}}
			open={input.open}
		>
			<DialogContent className="flex max-h-[min(42rem,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>
						{additionalHumanProfileCreationEnabled
							? "Create a new profile"
							: "Create a new Agent"}
					</DialogTitle>
					<DialogDescription>
						{resolveCreateProfileDialogDescription({
							additionalHumanProfileCreationEnabled,
							ownerMode,
							spaceContext,
							targetOwnerName:
								organizationDirectoryQuery.data?.members.find(
									(member) => member.userId === targetOwnerUserId
								)?.user.name ?? null,
						})}
					</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
					<CreateProfileForm
						additionalHumanProfileCreationEnabled={
							additionalHumanProfileCreationEnabled
						}
						additionalSubmitBlockReason={additionalSubmitBlockReason}
						agentBindingChoices={teammateBindingChoices}
						agentBindingValue={
							ownerMode === "self" ? boundAgentId : agentBindingValue
						}
						agentOwnershipSlot={ownerChoice}
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
						localFolderPickerDeviceId={
							ownerMode === "self" ? localFolderPickerDeviceId : null
						}
						modelCatalog={modelCatalog}
						onChangeAgentBindingValue={(value) => {
							setAgentBindingValue(value);
							const nextAgentId =
								ownerMode === "self"
									? value
									: (teammateBindingOptions.find(
											(option) => option.choice.value === value
										)?.agentId ?? "");
							appliedCreationDefaultsKeyRef.current = null;
							creationDefaultsEditedRef.current = false;
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
							setProjectWorkspaceFallback(
								ownerMode === "self" ? "managed" : null
							);
							setErrorState(null);
						}}
						onChangeBoundAgentControllerPermissionMode={(
							nextAgentControllerPermissionMode
						) => {
							creationDefaultsEditedRef.current = true;
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
							appliedCreationDefaultsKeyRef.current = null;
							creationDefaultsEditedRef.current = false;
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
							setProjectWorkspaceFallback("managed");
							setErrorState(null);
						}}
						onChangeBoundModelId={(nextModelId) => {
							creationDefaultsEditedRef.current = true;
							setBoundModelId(nextModelId);
							setBoundReasoningLevel("");
							setErrorState(null);
						}}
						onChangeBoundOpenCodePermission={(nextOpenCodePermission) => {
							creationDefaultsEditedRef.current = true;
							setBoundOpenCodePermission(nextOpenCodePermission);
							setErrorState(null);
						}}
						onChangeBoundReasoningLevel={(nextReasoningLevel) => {
							creationDefaultsEditedRef.current = true;
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
							handleProfileKindSelection({
								additionalHumanProfileCreationEnabled,
								nextProfileKind,
								onClearAgentFields: () => {
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
								},
								onErrorClear: () => setErrorState(null),
								onSelect: setProfileKind,
							});
						}}
						onSubmit={(event) => {
							handleCreateProfileSubmit({
								creationIntentRef,
								event,
								fingerprint: buildCreationFingerprint({
									agentBindingValue,
									authorizeForOrganization,
									boundAgentControllerPermissionMode,
									boundAgentId,
									boundModelId,
									boundOpenCodePermission,
									boundReasoningLevel,
									organizationId,
									ownerMode,
									profileKind: selectableProfileKind,
									profileName,
									selectedHumanProfileId:
										selectedHumanProfile?.openMeldProfileId ?? null,
									selectedProjectId,
									spaceId: spaceContext?.spaceId ?? null,
									targetOwnerUserId,
								}),
								onErrorClear: () => setErrorState(null),
								onSubmit: (idempotencyKey) =>
									createProfileMutation.mutate({ idempotencyKey }),
								submissionInFlightRef,
							});
						}}
						organizationWakeAccessSlot={organizationWakeAccessSlot}
						profileKind={selectableProfileKind}
						profileName={profileName}
						projectFolderPath={projectFolderPath}
						projectSelectionBlockReason={projectSelectionBlockReason}
						projectSelectionSlot={projectSelectionSlot}
						recoveryActionHref={recoveryActionHref}
						submitLabel={ownerMode === "teammate" ? "Request Agent" : undefined}
					/>
				</div>
			</DialogContent>
		</Dialog>
	);
}

type CreateProfileSubmissionInput = {
	agentControllerPermissionMode: AgentControllerPermissionMode | null;
	agentControllerRef: string;
	authorizeForOrganization: boolean;
	autoAuthorizeAgentProfileBindings: boolean;
	bindingTarget: ReturnType<typeof resolveProfileBindingCatalogExecutionTarget>;
	boundAgentId: string;
	boundModelId: string;
	boundOpenCodePermission: AgentProfileBindingOpenCodePermission | null;
	boundReasoningLevel: string;
	enableFutureOrganizationAuthorization: boolean;
	idempotencyKey: string;
	onAfterJoin?: (profile: AuthProfileView) => void | Promise<void>;
	organizationAuthorizationContext:
		| CreateProfileOrganizationAuthorizationContext
		| undefined;
	organizationId: string;
	ownerMode: AgentProfileOwnerMode;
	profileKind: NewProfileKind | null;
	profileName: string;
	projectFolderPath: string;
	queryClient: QueryClient;
	recovery: RecoveryController;
	selectedHumanProfile: AuthProfileView | null;
	selectedProjectBindingGeneration: string | null;
	selectedProjectId: string;
	selectedTeammateBinding: TeammateBindingOption | undefined;
	spaceContext: CreateProfileSpaceContext | undefined;
	targetOwnerUserId: string;
};

async function submitProfileCreation(input: CreateProfileSubmissionInput) {
	if (input.ownerMode === "teammate") {
		return await requestTeammateAgentProfile(input);
	}
	return await createOwnProfile(input);
}

async function handleProfileCreationSuccess(input: {
	onAgentRequestCreated?: (request: AgentProfileCreationRequest) => void;
	onClose: () => void;
	onProfileCreated?: (profile: AuthProfileView) => void;
	onReset: () => void;
	organizationId: string;
	queryClient: QueryClient;
	result: Awaited<ReturnType<typeof submitProfileCreation>>;
	spaceContext: CreateProfileSpaceContext | undefined;
}) {
	if (input.result.kind === "request") {
		await Promise.all([
			input.queryClient.invalidateQueries({
				queryKey: agentProfileCreationRequestQueryKeys.byOrganization(
					input.organizationId
				),
			}),
			input.queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.directory(input.organizationId),
			}),
		]);
		toast.success(createdAgentRequestMessage(input.result.request));
		input.onAgentRequestCreated?.(input.result.request);
		input.onReset();
		input.onClose();
		return;
	}
	showCreatedProfileToast({
		creationDefaultsUpdateFailed: input.result.creationDefaultsUpdateFailed,
		followUpIssues: input.result.creationOutcome.followUpIssues,
		organizationAuthorization: input.result.organizationAuthorization,
		profile: input.result.profile,
		spaceContext: input.spaceContext,
	});
	input.onProfileCreated?.(input.result.profile);
	input.onReset();
	input.onClose();
}

async function requestTeammateAgentProfile(
	input: CreateProfileSubmissionInput
) {
	const result = await createAgentProfileCreationRequest({
		configuration: {
			agentControllerPermissionMode: input.agentControllerPermissionMode,
			agentControllerRef:
				input.selectedTeammateBinding?.agentControllerRef ?? null,
			authorizeForOrganization: input.authorizeForOrganization,
			defaultProjectId: input.selectedProjectId || null,
			modelId:
				input.boundAgentId && input.boundModelId ? input.boundModelId : null,
			openCodePermission:
				input.boundAgentId && isOpenCodeAgentId(input.boundAgentId)
					? input.boundOpenCodePermission
					: null,
			reasoningLevel:
				input.boundAgentId && input.boundReasoningLevel
					? input.boundReasoningLevel
					: null,
			targetComputerId: input.selectedTeammateBinding?.targetComputerId ?? null,
		},
		idempotencyKey: input.idempotencyKey,
		organizationId: input.organizationId,
		profileName: input.profileName,
		requestedSpaceId: input.spaceContext?.spaceId ?? null,
		targetOwnerUserId: input.targetOwnerUserId,
	});
	return { kind: "request" as const, request: result.request };
}

async function createOwnProfile(input: CreateProfileSubmissionInput) {
	const defaultProjectId = resolveSelectedDefaultProjectId({
		selectedProjectBindingGeneration: input.selectedProjectBindingGeneration,
		selectedProjectId: input.selectedProjectId,
	});
	const creationOutcome = await createProfileWithFollowUps({
		...(input.agentControllerPermissionMode
			? { agentControllerPermissionMode: input.agentControllerPermissionMode }
			: {}),
		boundAgentId: input.boundAgentId,
		currentServiceCanSetProfileWorkspace:
			input.bindingTarget?.localAgentControl.setProfileWorkspace === true,
		defaultProjectId,
		deviceId: input.bindingTarget?.deviceId ?? input.recovery.deviceId,
		idempotencyKey: input.idempotencyKey,
		modelId: input.boundAgentId ? input.boundModelId : null,
		onAfterJoin: input.onAfterJoin,
		openCodePermission: isOpenCodeAgentId(input.boundAgentId)
			? input.boundOpenCodePermission
			: null,
		organizationId: input.organizationId || null,
		profileKind: input.profileKind,
		profileName: input.profileName,
		projectFolderPath: input.boundAgentId ? input.projectFolderPath : null,
		queryClient: input.queryClient,
		reasoningLevel: input.boundAgentId ? input.boundReasoningLevel : null,
		runtimeLane: input.bindingTarget?.runtimeLane ?? input.recovery.runtimeLane,
		selectedHumanProfile: input.selectedHumanProfile,
		selectedHumanProfileId:
			input.selectedHumanProfile?.openMeldProfileId ?? null,
		spaceContext: input.spaceContext,
	});
	const { profile } = creationOutcome;
	const [creationDefaultsUpdateFailed, organizationAuthorization] =
		await Promise.all([
			rememberSuccessfulAgentProfileCreationDefaults({
				agentControllerPermissionMode: input.agentControllerPermissionMode,
				agentControllerRef: input.agentControllerRef,
				boundAgentId: input.boundAgentId,
				defaultProjectId,
				followUpIssues: creationOutcome.followUpIssues,
				modelId: input.boundModelId || null,
				openCodePermission: isOpenCodeAgentId(input.boundAgentId)
					? input.boundOpenCodePermission
					: null,
				organizationId: input.organizationId,
				queryClient: input.queryClient,
				reasoningLevel: input.boundReasoningLevel || null,
			}),
			applyCreatedProfileOrganizationAuthorization({
				authorizeForOrganization: input.authorizeForOrganization,
				autoAuthorizeAgentProfileBindings:
					input.autoAuthorizeAgentProfileBindings,
				boundAgentId: input.boundAgentId,
				enableFutureOrganizationAuthorization:
					input.enableFutureOrganizationAuthorization,
				organizationAuthorizationContext:
					input.organizationAuthorizationContext,
				profile,
				queryClient: input.queryClient,
			}),
		]);
	refreshCreatedProfileCaches({
		boundAgentId: input.boundAgentId,
		createdProfile: profile,
		onAfterJoin: input.onAfterJoin,
		organizationAuthorization,
		queryClient: input.queryClient,
		recovery: input.recovery,
		spaceJoined: creationOutcome.spaceJoined,
		spaceContext: input.spaceContext,
	}).catch((error) => {
		console.warn(
			"OpenMeld created the profile but could not refresh profile caches.",
			error
		);
	});
	return {
		kind: "profile" as const,
		creationDefaultsUpdateFailed,
		creationOutcome,
		organizationAuthorization,
		profile,
	};
}

function useDefaultTeammateSelection(input: {
	currentUserId: string;
	directory: OrganizationDirectoryResponse | undefined;
	onSelect: (userId: string) => void;
	targetOwnerUserId: string;
}) {
	useEffect(() => {
		if (input.targetOwnerUserId || !input.directory) {
			return;
		}
		const firstTeammate = input.directory.members.find(
			(member) => member.userId !== input.currentUserId
		);
		if (firstTeammate) {
			input.onSelect(firstTeammate.userId);
		}
	}, [input]);
}

function useRememberedCreationDefaults(input: {
	agentControllerRef: string;
	appliedCreationDefaultsKeyRef: { current: string | null };
	boundAgentId: string;
	creationDefaults: GetAgentProfileCreationDefaultsResponse | undefined;
	creationDefaultsEditedRef: { current: boolean };
	modelCatalog: ModelCatalog | null;
	onApply: (
		remembered: ReturnType<typeof resolveRememberedAgentProfileCreationDefaults>
	) => void;
	organizationId: string;
	projects: ListProjectsResponse | undefined;
	projectsPending: boolean;
}) {
	useEffect(() => {
		if (
			!input.boundAgentId ||
			input.creationDefaultsEditedRef.current ||
			!input.creationDefaults ||
			!input.modelCatalog ||
			input.projectsPending
		) {
			return;
		}
		const applyKey = `${input.organizationId}:${input.agentControllerRef}:${input.creationDefaults.updatedAt ?? "empty"}`;
		if (input.appliedCreationDefaultsKeyRef.current === applyKey) {
			return;
		}
		input.onApply(
			resolveRememberedAgentProfileCreationDefaults({
				agentId: input.boundAgentId,
				defaults: input.creationDefaults,
				modelCatalog: input.modelCatalog,
				projects: input.projects?.projects ?? [],
			})
		);
		input.appliedCreationDefaultsKeyRef.current = applyKey;
	}, [input]);
}

function renderOrganizationWakeAccessSlot(input: {
	authorizeForOrganization: boolean;
	autoAuthorizeAgentProfileBindings: boolean;
	boundAgentId: string;
	disabled: boolean;
	enableFutureOrganizationAuthorization: boolean;
	isPreferenceError: boolean;
	isPreferencePending: boolean;
	onAuthorizeForOrganizationChange: (checked: boolean) => void;
	onEnableFutureOrganizationAuthorizationChange: (checked: boolean) => void;
	organizationAuthorizationContext:
		| CreateProfileOrganizationAuthorizationContext
		| undefined;
	ownerMode: AgentProfileOwnerMode;
	profileKind: NewProfileKind | null;
}): ReactNode {
	if (!input.organizationAuthorizationContext) {
		return null;
	}
	if (input.ownerMode === "teammate") {
		return (
			<RequestedAgentOrganizationWakeAccessChoice
				authorizeForOrganization={input.authorizeForOrganization}
				boundAgentId={input.boundAgentId}
				disabled={input.disabled}
				onAuthorizeForOrganizationChange={
					input.onAuthorizeForOrganizationChange
				}
				organizationName={
					input.organizationAuthorizationContext.organizationName
				}
			/>
		);
	}
	return (
		<CreateProfileOrganizationWakeAccessChoice
			authorizeForOrganization={input.authorizeForOrganization}
			autoAuthorizeAgentProfileBindings={
				input.autoAuthorizeAgentProfileBindings
			}
			boundAgentId={input.boundAgentId}
			disabled={input.disabled}
			enableFutureOrganizationAuthorization={
				input.enableFutureOrganizationAuthorization
			}
			isPreferenceError={input.isPreferenceError}
			isPreferencePending={input.isPreferencePending}
			onAuthorizeForOrganizationChange={input.onAuthorizeForOrganizationChange}
			onEnableFutureOrganizationAuthorizationChange={
				input.onEnableFutureOrganizationAuthorizationChange
			}
			organizationName={input.organizationAuthorizationContext.organizationName}
			profileKind={input.profileKind}
		/>
	);
}

function renderProjectSelectionSlot(input: {
	creationDefaultsEditedRef: { current: boolean };
	disabled: boolean;
	onErrorClear: () => void;
	organizationId: string;
	ownerMode: AgentProfileOwnerMode;
	projectFolderPath: string;
	projects: ListProjectsResponse | undefined;
	projectsError: boolean;
	projectsPending: boolean;
	projectWorkspaceFallback: "advanced" | "managed" | null;
	selectedProjectBindingGeneration: string | null;
	selectedProjectId: string;
	setProjectFolderPath: (value: string) => void;
	setProjectWorkspaceFallback: (value: "advanced" | "managed" | null) => void;
	setSelectedProjectBindingGeneration: (value: string | null) => void;
	setSelectedProjectId: (value: string) => void;
}): ReactNode {
	if (input.organizationId && input.projectsPending) {
		return (
			<p className="text-muted-foreground text-sm">Loading active Projects.</p>
		);
	}
	if (!input.organizationId || input.projectsError) {
		return null;
	}
	if (input.ownerMode === "teammate") {
		return (
			<RequestedAgentProjectField
				disabled={input.disabled}
				onChange={(projectId) => {
					input.setSelectedProjectId(projectId);
					input.onErrorClear();
				}}
				projects={input.projects?.projects ?? []}
				value={input.selectedProjectId}
			/>
		);
	}
	return (
		<AgentProfileProjectSelector
			disabled={input.disabled}
			manualPath={input.projectFolderPath}
			onConnectionReady={(connection) => {
				input.creationDefaultsEditedRef.current = true;
				input.setSelectedProjectBindingGeneration(connection.bindingGeneration);
				input.setProjectFolderPath(connection.path);
				input.setProjectWorkspaceFallback(null);
				input.onErrorClear();
			}}
			onManualPathChange={(path) => {
				input.creationDefaultsEditedRef.current = true;
				input.setProjectWorkspaceFallback("advanced");
				input.setProjectFolderPath(path);
				input.onErrorClear();
			}}
			onProjectChange={(projectId) => {
				input.creationDefaultsEditedRef.current = true;
				input.setSelectedProjectId(projectId);
				input.setSelectedProjectBindingGeneration(null);
				input.setProjectFolderPath("");
				input.setProjectWorkspaceFallback(null);
				input.onErrorClear();
			}}
			onUseAdvancedWorkspace={() => {
				input.creationDefaultsEditedRef.current = true;
				input.setSelectedProjectBindingGeneration(null);
				input.setProjectWorkspaceFallback("advanced");
				input.onErrorClear();
			}}
			onUseManagedWorkspace={() => {
				input.creationDefaultsEditedRef.current = true;
				input.setSelectedProjectBindingGeneration(null);
				input.setProjectFolderPath("");
				input.setProjectWorkspaceFallback("managed");
				input.onErrorClear();
			}}
			organizationId={input.organizationId}
			projectId={input.selectedProjectId}
			projects={input.projects?.projects ?? []}
			selectedBindingGeneration={input.selectedProjectBindingGeneration}
			workspaceFallbackMode={input.projectWorkspaceFallback}
		/>
	);
}

function renderAgentProfileOwnerChoice(input: {
	canRequestForTeammate: boolean;
	currentUserId: string;
	disabled: boolean;
	members: OrganizationDirectoryResponse["members"];
	onResetBinding: (nextMode: AgentProfileOwnerMode) => void;
	onResetTeammate: (userId: string) => void;
	ownerMode: AgentProfileOwnerMode;
	setOwnerMode: (mode: AgentProfileOwnerMode) => void;
	targetOwnerUserId: string;
}): ReactNode {
	if (!input.canRequestForTeammate) {
		return null;
	}
	return (
		<AgentProfileOwnerChoice
			currentUserId={input.currentUserId}
			disabled={input.disabled}
			members={input.members}
			mode={input.ownerMode}
			onModeChange={(nextMode) => {
				input.setOwnerMode(nextMode);
				input.onResetBinding(nextMode);
			}}
			onTargetOwnerChange={input.onResetTeammate}
			targetOwnerUserId={input.targetOwnerUserId}
		/>
	);
}

function resolveTeammateBindingChoices(input: {
	options: readonly TeammateBindingOption[];
	ownerMode: AgentProfileOwnerMode;
}): readonly AgentProfileBindingChoice[] | undefined {
	if (input.ownerMode !== "teammate") {
		return undefined;
	}
	return [
		{
			agentId: null,
			description:
				"Create the Agent now and let its owner choose the controlling local agent later.",
			label: "Let the owner choose",
			value: "",
		},
		...input.options.map((option) => option.choice),
	];
}

function resolveOwnerSubmitBlockReason(input: {
	directoryPending: boolean;
	ownerMode: AgentProfileOwnerMode;
	targetOwnerUserId: string;
}): string | null {
	if (input.ownerMode !== "teammate" || input.targetOwnerUserId) {
		return null;
	}
	return input.directoryPending
		? "Loading teammates."
		: "Choose an Agent owner.";
}

function resolveSelectableProfileKind(input: {
	additionalHumanProfileCreationEnabled: boolean;
	profileKind: NewProfileKind | null;
}): NewProfileKind | null {
	if (
		input.profileKind === "human" &&
		!input.additionalHumanProfileCreationEnabled
	) {
		return null;
	}
	return input.profileKind;
}

function canRequestTeammateAgent(input: {
	allowTeammateRequests: boolean | undefined;
	currentUserId: string;
}): boolean {
	return input.allowTeammateRequests === true && Boolean(input.currentUserId);
}

function shouldReadCreationDefaults(input: {
	agentControllerRef: string;
	open: boolean;
	organizationId: string;
	ownerMode: AgentProfileOwnerMode;
}): boolean {
	return Boolean(
		input.open &&
			input.organizationId &&
			input.agentControllerRef &&
			input.ownerMode === "self"
	);
}

function shouldReadOrganizationAuthorizationPreference(input: {
	organizationAuthorizationContext:
		| CreateProfileOrganizationAuthorizationContext
		| undefined;
	ownerMode: AgentProfileOwnerMode;
}): boolean {
	return Boolean(
		input.organizationAuthorizationContext && input.ownerMode === "self"
	);
}

function resolveAgentControllerRef(boundAgentId: string): string {
	return boundAgentId ? buildBuiltinAgentControllerRef(boundAgentId) : "";
}

function resolveAvailableLocalAgents(input: {
	organizationComputersPending: boolean;
	ownLocalAgentIds: readonly string[];
	ownerMode: AgentProfileOwnerMode;
	recovery: RecoveryController;
	teammateBindingOptions: readonly TeammateBindingOption[];
}): {
	availableLocalAgentIds: readonly string[];
	isResolvingLocalAgents: boolean;
} {
	const availableLocalAgentIds =
		input.ownerMode === "self"
			? input.ownLocalAgentIds
			: input.teammateBindingOptions.map((option) => option.agentId);
	const sourcePending =
		input.ownerMode === "self"
			? isResolvingCreateProfileLocalAgents(input.recovery)
			: input.organizationComputersPending;
	return {
		availableLocalAgentIds,
		isResolvingLocalAgents:
			availableLocalAgentIds.length === 0 && sourcePending,
	};
}

function resolveOwnerProjectSelectionBlockReason(input: {
	boundAgentId: string;
	ownerMode: AgentProfileOwnerMode;
	projectFolderPath: string;
	projectWorkspaceFallback: "advanced" | "managed" | null;
	selectedProjectBindingGeneration: string | null;
	selectedProjectId: string;
}): string | null {
	if (input.ownerMode !== "self") {
		return null;
	}
	return resolveProjectSelectionBlockReason(input);
}

function handleProfileKindSelection(input: {
	additionalHumanProfileCreationEnabled: boolean;
	nextProfileKind: NewProfileKind;
	onClearAgentFields: () => void;
	onErrorClear: () => void;
	onSelect: (profileKind: NewProfileKind) => void;
}) {
	if (
		input.nextProfileKind === "human" &&
		!input.additionalHumanProfileCreationEnabled
	) {
		return;
	}
	input.onSelect(input.nextProfileKind);
	if (input.nextProfileKind !== "agent") {
		input.onClearAgentFields();
	}
	input.onErrorClear();
}

function buildCreationFingerprint(input: {
	agentBindingValue: string;
	authorizeForOrganization: boolean;
	boundAgentControllerPermissionMode: AgentControllerPermissionMode;
	boundAgentId: string;
	boundModelId: string;
	boundOpenCodePermission: AgentProfileBindingOpenCodePermission | null;
	boundReasoningLevel: string;
	organizationId: string;
	ownerMode: AgentProfileOwnerMode;
	profileKind: NewProfileKind | null;
	profileName: string;
	selectedHumanProfileId: string | null;
	selectedProjectId: string;
	spaceId: string | null;
	targetOwnerUserId: string;
}): string {
	return JSON.stringify([
		input.organizationId,
		input.profileKind,
		input.ownerMode,
		input.targetOwnerUserId,
		input.profileName.trim(),
		input.agentBindingValue,
		input.boundAgentId,
		input.boundAgentControllerPermissionMode,
		input.boundModelId,
		input.boundOpenCodePermission,
		input.boundReasoningLevel,
		input.selectedProjectId,
		input.authorizeForOrganization,
		input.spaceId,
		input.selectedHumanProfileId,
	]);
}

function handleCreateProfileSubmit(input: {
	creationIntentRef: {
		current: { fingerprint: string; idempotencyKey: string } | null;
	};
	event: FormEvent<HTMLFormElement>;
	fingerprint: string;
	onErrorClear: () => void;
	onSubmit: (idempotencyKey: string) => void;
	submissionInFlightRef: { current: boolean };
}) {
	input.event.preventDefault();
	if (input.submissionInFlightRef.current) {
		return;
	}
	input.submissionInFlightRef.current = true;
	const existingIntent = input.creationIntentRef.current;
	const intent =
		existingIntent?.fingerprint === input.fingerprint
			? existingIntent
			: {
					fingerprint: input.fingerprint,
					idempotencyKey: crypto.randomUUID(),
				};
	input.creationIntentRef.current = intent;
	input.onErrorClear();
	input.onSubmit(intent.idempotencyKey);
}

function handleCreateProfileDialogOpenChange(input: {
	isSubmitting: boolean;
	nextOpen: boolean;
	onClose: () => void;
	onOpenChange: (open: boolean) => void;
}) {
	if (input.isSubmitting) {
		return;
	}
	if (!input.nextOpen) {
		input.onClose();
	}
	input.onOpenChange(input.nextOpen);
}

function resolveCreateProfileDialogDescription(input: {
	additionalHumanProfileCreationEnabled: boolean;
	ownerMode: AgentProfileOwnerMode;
	spaceContext: CreateProfileSpaceContext | undefined;
	targetOwnerName: string | null;
}): string {
	if (input.ownerMode === "teammate") {
		return `Configure an Agent for ${input.targetOwnerName ?? "a teammate"}. Their approval settings decide whether it is created now or sent as a request.`;
	}
	if (input.spaceContext) {
		return input.additionalHumanProfileCreationEnabled
			? `Create a profile and bring it into ${input.spaceContext.spaceName ?? "this Space"}.`
			: `Create an Agent and bring it into ${input.spaceContext.spaceName ?? "this Space"}.`;
	}
	return input.additionalHumanProfileCreationEnabled
		? "Create a person or Agent on this account."
		: "Create an Agent on this account.";
}

type TeammateBindingOption = {
	agentControllerRef: string;
	agentId: string;
	choice: AgentProfileBindingChoice;
	targetComputerId: string;
};

function resolveTeammateBindingOptions(input: {
	computers: OrganizationComputersResponse | null;
	targetOwnerUserId: string;
}): TeammateBindingOption[] {
	const options: TeammateBindingOption[] = [];
	for (const computer of input.computers?.computers ?? []) {
		if (computer.ownerUserId !== input.targetOwnerUserId) {
			continue;
		}
		for (const localAgent of computer.localAgents) {
			const controller = parseAgentControllerRef(localAgent.agentControllerRef);
			if (
				!controller ||
				controller.kind !== "builtin" ||
				!localAgent.enabled ||
				localAgent.status !== "ready"
			) {
				continue;
			}
			const label = formatLocalAgentDisplayName(controller.id);
			options.push({
				agentControllerRef: controller.ref,
				agentId: controller.id,
				choice: {
					agentId: controller.id,
					description: `${label} on ${computer.deviceDisplayName}.`,
					label,
					value: `${computer.computerId}:${controller.ref}`,
				},
				targetComputerId: computer.computerId,
			});
		}
	}
	return options.sort((left, right) =>
		`${left.choice.label}:${left.choice.description}`.localeCompare(
			`${right.choice.label}:${right.choice.description}`
		)
	);
}

function createdAgentRequestMessage(
	request: AgentProfileCreationRequest
): string {
	switch (request.status) {
		case "completed":
			return "Agent created for your teammate.";
		case "declined":
			return "This teammate doesn't allow Agent creation requests.";
		case "failed":
			return request.createdAgentProfileId
				? "The Agent was created, but its setup needs attention."
				: "OpenMeld couldn't create this Agent.";
		default:
			return "Request sent.";
	}
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

async function rememberSuccessfulAgentProfileCreationDefaults(input: {
	agentControllerPermissionMode: AgentControllerPermissionMode | null;
	agentControllerRef: string;
	boundAgentId: string;
	defaultProjectId: string | null;
	followUpIssues: CreatedProfileFollowUpIssue[];
	modelId: string | null;
	openCodePermission: AgentProfileBindingOpenCodePermission | null;
	organizationId: string;
	queryClient: QueryClient;
	reasoningLevel: string | null;
}): Promise<boolean> {
	if (
		!(input.boundAgentId && input.agentControllerRef) ||
		input.followUpIssues.some((issue) => issue.kind === "local_setup")
	) {
		return false;
	}
	try {
		const defaults = await setAgentProfileCreationDefaults({
			agentControllerPermissionMode: input.agentControllerPermissionMode,
			agentControllerRef: input.agentControllerRef,
			defaultProjectId: input.defaultProjectId,
			modelId: input.modelId,
			openCodePermission: input.openCodePermission,
			organizationId: input.organizationId,
			reasoningLevel: input.reasoningLevel,
		});
		input.queryClient.setQueryData(
			agentProfileCreationDefaultsQueryKeys.byController({
				agentControllerRef: input.agentControllerRef,
				organizationId: input.organizationId,
			}),
			defaults
		);
		return false;
	} catch (error) {
		console.warn(
			"OpenMeld created the Agent but could not remember its setup choices.",
			error
		);
		return true;
	}
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
	creationDefaultsUpdateFailed: boolean;
	followUpIssues: CreatedProfileFollowUpIssue[];
	organizationAuthorization: CreatedProfileOrganizationAuthorizationResult;
	profile: AuthProfileView;
	spaceContext: CreateProfileSpaceContext | undefined;
}) {
	const authorizationIssueSentence =
		toOrganizationAuthorizationFollowUpSentence(
			input.organizationAuthorization
		);
	const spaceJoinIssue = input.followUpIssues.find(
		(issue) => issue.kind === "space_join"
	);
	const localSetupIssue = input.followUpIssues.find(
		(issue) => issue.kind === "local_setup"
	);
	if (spaceJoinIssue) {
		const localSetupSentence = localSetupIssue
			? ` Local setup also needs attention: ${localSetupIssue.message}`
			: "";
		toast.error(
			`${input.profile.profileName} was created, but OpenMeld couldn't add it to ${input.spaceContext?.spaceName ?? "the Space"}. Add the existing profile from the Members panel.${localSetupSentence}${authorizationIssueSentence}`
		);
		return;
	}
	if (localSetupIssue) {
		toast.warning(
			`${input.profile.profileName} was created${input.spaceContext ? ` and added to ${input.spaceContext.spaceName ?? "this Space"}` : ""}, but local setup isn't complete. ${localSetupIssue.message}${authorizationIssueSentence}`
		);
		return;
	}
	if (input.organizationAuthorization.status === "failed") {
		toast.error(
			`${input.profile.profileName} was created, but OpenMeld couldn't authorize it for ${input.organizationAuthorization.organizationName}. ${input.organizationAuthorization.errorMessage}`
		);
		return;
	}
	if (input.creationDefaultsUpdateFailed) {
		toast.warning(
			`${input.profile.profileName} was created, but OpenMeld couldn't remember these setup choices for next time.`
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

function toOrganizationAuthorizationFollowUpSentence(
	result: CreatedProfileOrganizationAuthorizationResult
): string {
	if (result.status === "failed") {
		return ` Wake access also needs attention: ${result.errorMessage}`;
	}
	if (result.status === "authorized" && result.preferenceUpdateFailed) {
		return ` This Agent is authorized for ${result.organizationName}, but OpenMeld couldn't save automatic authorization for future Agents.`;
	}
	return "";
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

function RequestedAgentOrganizationWakeAccessChoice(input: {
	authorizeForOrganization: boolean;
	boundAgentId: string;
	disabled: boolean;
	onAuthorizeForOrganizationChange: (checked: boolean) => void;
	organizationName: string;
}) {
	if (!input.boundAgentId) {
		return (
			<div className="grid gap-1 py-1">
				<p className="font-medium text-sm">
					Use this Agent in {input.organizationName}
				</p>
				<p className="text-muted-foreground text-xs leading-5">
					Choose a local agent above to request Wake access now. If you let the
					owner choose later, they can turn it on when they connect the Agent.
				</p>
			</div>
		);
	}
	return (
		<label className="flex items-start gap-3 py-1 text-sm">
			<input
				checked={input.authorizeForOrganization}
				className="mt-0.5 size-4 shrink-0 accent-foreground"
				disabled={input.disabled}
				onChange={(event) =>
					input.onAuthorizeForOrganizationChange(event.target.checked)
				}
				type="checkbox"
			/>
			<span>
				<span className="block font-medium text-foreground">
					Use this Agent in {input.organizationName}
				</span>
				<span className="mt-1 block text-muted-foreground text-xs leading-5">
					If the owner approves, members can Wake this Agent from
					{input.organizationName} Spaces.
				</span>
			</span>
		</label>
	);
}

function buildBuiltinAgentControllerRef(agentId: string): string {
	return `builtin:${agentId}`;
}

async function refreshCreatedProfileCaches(input: {
	boundAgentId: string;
	createdProfile: AuthProfileView;
	onAfterJoin?: (profile: AuthProfileView) => void | Promise<void>;
	organizationAuthorization: CreatedProfileOrganizationAuthorizationResult;
	queryClient: QueryClient;
	recovery: RecoveryController;
	spaceJoined: boolean;
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
			if (input.spaceContext && input.spaceJoined) {
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
