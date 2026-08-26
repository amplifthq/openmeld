"use client";

import {
	DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE,
	listAgentControllerPermissionModeOptions,
	parseAgentControllerRef,
	resolveAgentControllerPermissionModeForController,
	resolveNativeAgentControllerCollaborationModeForController,
} from "@openmeld/agent-runtime";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import { formatAgentRecoveryActionLabel } from "@openmeld/schemas";
import type {
	AgentActivityInventorySession,
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	AgentProfileBindingSessionInventorySelection,
	AgentProfileCreationRequest,
	AuthProfileView,
	DaemonServiceLane,
	GetAgentProfileCreationDefaultsResponse,
	ListProjectsResponse,
	ModelCatalog,
	OrganizationComputersResponse,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import { Bars } from "@openmeld/ui/components/bars";
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
	type ComponentProps,
	type Dispatch,
	type FormEvent,
	type ReactNode,
	useEffect,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { resolveLocalFolderPickerDeviceId } from "#/lib/connect/local-folder-picker";
import { useOptionalCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import { buildOrganizationComputerPath } from "#/lib/organizations/organization-routes";
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
	SessionProfileCreationRolledBackError,
	type SpaceJoinedProfileReference,
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
import {
	refreshWebAgentReadinessFacts,
	refreshWebAgentReadinessSharedCaches,
} from "#/query/agents/execution-readiness";
import { modelCatalogQueryOptions } from "#/query/config/model-catalog";
import { agentActivitySessionsQueryOptions } from "#/query/organizations/agent-activity";
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
import {
	AgentProfileSessionChoice,
	type AgentProfileSessionMode,
} from "./agent-profile-session-choice";
import {
	type AgentProfileModelCompatibilityContext,
	CreateProfileForm,
} from "./create-profile-form";
import { formatLocalAgentDisplayName } from "./local-agent-display-name";
import { isOpenCodeAgentId } from "./open-code-permissions-field";
import { RequestedAgentProjectField } from "./requested-agent-project-field";

type RecoveryController = ReturnType<typeof useLocalAgentRecoveryController>;

export type { CreateProfileSpaceContext } from "#/lib/profiles/create-profile-orchestration";

export type CreateProfileOrganizationAuthorizationContext = {
	organizationId: string;
	organizationName: string;
};

export type CreateProfileAgentActivitySessionPreset = {
	agentControllerRef: string;
	computerId: string;
	localAgentName: string;
	mode: "create" | "fork" | "resume";
	nativeSessionId: string;
	nativeSessionTitle: string | null;
	organizationId: string;
	ownerUserId: string;
	projectId: string;
	provider: AgentProfileBindingSessionInventorySelection["provider"];
	status: "working" | "idle" | "ended" | "error" | "unknown";
};

type CreateProfileDialogFormState = {
	agentBindingValue: string;
	authorizeForOrganization: boolean;
	boundAgentControllerCollaborationMode: AgentControllerCollaborationMode | null;
	boundAgentControllerPermissionMode: AgentControllerPermissionMode;
	boundAgentControllerPermissionModeConfirmed: boolean;
	boundAgentId: string;
	boundModelId: string;
	boundOpenCodePermission: AgentProfileBindingOpenCodePermission | null;
	boundReasoningLevel: string;
	enableFutureOrganizationAuthorization: boolean;
	errorState: NewProfileErrorState | null;
	ownerMode: AgentProfileOwnerMode;
	profileKind: NewProfileKind | null;
	profileName: string;
	projectFolderPath: string;
	projectWorkspaceFallback: "advanced" | "managed" | null;
	selectedProjectBindingGeneration: string | null;
	selectedProjectId: string;
	sessionMode: AgentProfileSessionMode;
	sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
	targetOwnerUserId: string;
};

type CreateProfileDialogFormAction =
	| {
			patch: Partial<CreateProfileDialogFormState>;
			type: "patch";
	  }
	| {
			state: CreateProfileDialogFormState;
			type: "reset";
	  };

function reduceCreateProfileDialogFormState(
	state: CreateProfileDialogFormState,
	action: CreateProfileDialogFormAction
): CreateProfileDialogFormState {
	return action.type === "reset" ? action.state : { ...state, ...action.patch };
}

function createInitialCreateProfileDialogFormState(input: {
	initialOwnerMode: AgentProfileOwnerMode;
	initialSessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
}): CreateProfileDialogFormState {
	const sessionPresetAgentId = resolveSessionPresetAgentId(
		input.initialSessionPreset?.agentControllerRef ?? ""
	);
	return {
		agentBindingValue:
			input.initialOwnerMode === "teammate" && input.initialSessionPreset
				? `${input.initialSessionPreset.computerId}:${input.initialSessionPreset.agentControllerRef}`
				: "",
		authorizeForOrganization: true,
		boundAgentControllerCollaborationMode: null,
		boundAgentControllerPermissionMode:
			DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE,
		boundAgentControllerPermissionModeConfirmed: false,
		boundAgentId: sessionPresetAgentId ?? "",
		boundModelId: "",
		boundOpenCodePermission: null,
		boundReasoningLevel: "",
		enableFutureOrganizationAuthorization: false,
		errorState: null,
		ownerMode: input.initialOwnerMode,
		profileKind: input.initialSessionPreset ? "agent" : null,
		profileName: resolveSessionPresetProfileName(input.initialSessionPreset),
		projectFolderPath: "",
		projectWorkspaceFallback: null,
		selectedProjectBindingGeneration: null,
		selectedProjectId: input.initialSessionPreset?.projectId ?? "",
		sessionMode: resolveInitialAgentProfileSessionMode(
			input.initialSessionPreset
		),
		sessionPreset: input.initialSessionPreset,
		targetOwnerUserId:
			input.initialOwnerMode === "teammate"
				? (input.initialSessionPreset?.ownerUserId ?? "")
				: "",
	};
}

function createProfileDialogFormSetters(
	dispatch: Dispatch<CreateProfileDialogFormAction>
) {
	const setField =
		<Field extends keyof CreateProfileDialogFormState>(field: Field) =>
		(value: CreateProfileDialogFormState[Field]) =>
			dispatch({
				patch: { [field]: value } as Partial<CreateProfileDialogFormState>,
				type: "patch",
			});

	return {
		setAgentBindingValue: setField("agentBindingValue"),
		setAuthorizeForOrganization: setField("authorizeForOrganization"),
		setBoundAgentControllerCollaborationMode: setField(
			"boundAgentControllerCollaborationMode"
		),
		setBoundAgentControllerPermissionMode: setField(
			"boundAgentControllerPermissionMode"
		),
		setBoundAgentControllerPermissionModeConfirmed: setField(
			"boundAgentControllerPermissionModeConfirmed"
		),
		setBoundAgentId: setField("boundAgentId"),
		setBoundModelId: setField("boundModelId"),
		setBoundOpenCodePermission: setField("boundOpenCodePermission"),
		setBoundReasoningLevel: setField("boundReasoningLevel"),
		setEnableFutureOrganizationAuthorization: setField(
			"enableFutureOrganizationAuthorization"
		),
		setErrorState: setField("errorState"),
		setOwnerMode: setField("ownerMode"),
		setProfileKind: setField("profileKind"),
		setProfileName: setField("profileName"),
		setProjectFolderPath: setField("projectFolderPath"),
		setProjectWorkspaceFallback: setField("projectWorkspaceFallback"),
		setSelectedProjectBindingGeneration: setField(
			"selectedProjectBindingGeneration"
		),
		setSelectedProjectId: setField("selectedProjectId"),
		setSessionMode: setField("sessionMode"),
		setSessionPreset: setField("sessionPreset"),
		setTargetOwnerUserId: setField("targetOwnerUserId"),
	};
}

function resolveInitialAgentProfileSessionMode(
	preset: CreateProfileAgentActivitySessionPreset | undefined
): AgentProfileSessionMode {
	return preset?.mode === "resume" || preset?.mode === "fork"
		? preset.mode
		: "new";
}

// Standalone, route-free Create Profile dialog. Reused from Profiles, legacy
// agent redirects, and Spaces — the only difference is `spaceContext`: when
// present, the freshly created profile is also joined to that Space (always as a
// human acting profile); when absent, it is created in the selected Organization
// without Space membership. Carries zero dependency on retired start pages or
// route intents.
type CreateProfileDialogProps = {
	agentActivitySessionPreset?: CreateProfileAgentActivitySessionPreset;
	allowTeammateRequests?: boolean;
	currentUserId?: string;
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	onAgentRequestCreated?: (request: AgentProfileCreationRequest) => void;
	onOpenChange: (open: boolean) => void;
	onProfileCreated?: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId: string;
	organizationAuthorizationContext?: CreateProfileOrganizationAuthorizationContext;
	orgSlug?: string;
	recovery: RecoveryController;
	spaceContext?: CreateProfileSpaceContext;
};

export function CreateProfileDialog(input: CreateProfileDialogProps) {
	const view = useCreateProfileDialogController(input);
	return (
		<Dialog onOpenChange={view.onOpenChange} open={input.open}>
			<DialogContent className="flex max-h-[min(42rem,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{view.title}</DialogTitle>
					<DialogDescription>{view.description}</DialogDescription>
				</DialogHeader>
				<CreateProfileForm {...view.formProps} />
			</DialogContent>
		</Dialog>
	);
}

function useCreateProfileDialogController(input: CreateProfileDialogProps) {
	const initialSessionPreset = input.agentActivitySessionPreset;
	const currentUserId = input.currentUserId ?? "";
	const initialOwnerMode: AgentProfileOwnerMode =
		initialSessionPreset &&
		currentUserId &&
		initialSessionPreset.ownerUserId !== currentUserId
			? "teammate"
			: "self";
	const [formState, dispatchForm] = useReducer(
		reduceCreateProfileDialogFormState,
		{ initialOwnerMode, initialSessionPreset },
		createInitialCreateProfileDialogFormState
	);
	const formSetters = useMemo(
		() => createProfileDialogFormSetters(dispatchForm),
		[]
	);
	const {
		agentBindingValue,
		authorizeForOrganization,
		boundAgentControllerCollaborationMode,
		boundAgentControllerPermissionMode,
		boundAgentControllerPermissionModeConfirmed,
		boundAgentId,
		boundModelId,
		boundOpenCodePermission,
		boundReasoningLevel,
		enableFutureOrganizationAuthorization,
		errorState,
		ownerMode,
		profileKind,
		profileName,
		projectFolderPath,
		projectWorkspaceFallback,
		selectedProjectBindingGeneration,
		selectedProjectId,
		sessionMode,
		sessionPreset,
		targetOwnerUserId,
	} = formState;
	const {
		setAgentBindingValue,
		setAuthorizeForOrganization,
		setBoundAgentControllerCollaborationMode,
		setBoundAgentControllerPermissionMode,
		setBoundAgentControllerPermissionModeConfirmed,
		setBoundAgentId,
		setBoundModelId,
		setBoundOpenCodePermission,
		setBoundReasoningLevel,
		setEnableFutureOrganizationAuthorization,
		setErrorState,
		setOwnerMode,
		setProfileKind,
		setProfileName,
		setProjectFolderPath,
		setProjectWorkspaceFallback,
		setSelectedProjectBindingGeneration,
		setSelectedProjectId,
		setSessionMode,
		setSessionPreset,
		setTargetOwnerUserId,
	} = formSetters;
	const sessionPresetAgentId = resolveSessionPresetAgentId(
		sessionPreset?.agentControllerRef ?? ""
	);
	const queryClient = useQueryClient();
	const { selectedHumanProfile, profilesQuery } = useSelectedHumanProfile({
		selectDefaultWhenMissing: true,
	});
	const profileCapabilitiesQuery = useQuery(profileCapabilitiesQueryOptions());
	const additionalHumanProfileCreationEnabled =
		isAdditionalHumanProfileCreationEnabled(profileCapabilitiesQuery);
	const selectableProfileKind = resolveSelectableProfileKind({
		additionalHumanProfileCreationEnabled,
		profileKind,
	});
	const submissionInFlightRef = useRef(false);
	const creationIntentRef = useRef<{
		fingerprint: string;
		idempotencyKey: string;
	} | null>(null);
	const [initialSessionPresetKey] = useState(() =>
		resolveSessionPresetKey(initialSessionPreset)
	);
	const appliedCreationDefaultsKeyRef = useRef<string | null>(
		initialSessionPresetKey
	);
	const creationDefaultsEditedRef = useRef(Boolean(sessionPreset));
	const { data: modelCatalog = null } = useQuery(modelCatalogQueryOptions());
	const currentOrgSlug = useOptionalCurrentOrganizationSlug();
	const orgSlug = input.orgSlug ?? currentOrgSlug;
	const organizationAuthorizationContext =
		input.organizationAuthorizationContext;
	const organizationId = input.organizationId;
	const dialogTitle = resolveCreateProfileDialogTitle({
		additionalHumanProfileCreationEnabled,
	});
	const canRequestForTeammate = canRequestTeammateAgent({
		allowTeammateRequests:
			!initialSessionPreset || initialOwnerMode === "teammate"
				? input.allowTeammateRequests
				: false,
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
	const sessionOwnerUserId = resolveSessionOwnerUserId({
		currentUserId,
		initialSessionPreset,
		ownerMode,
		targetOwnerUserId,
	});
	const agentActivitySessionsQuery = useQuery(
		agentActivitySessionsQueryOptions({
			enabled: shouldReadAgentProfileSessionChoices({
				open: input.open,
				profileKind: selectableProfileKind,
				sessionOwnerUserId,
			}),
			limit: 100,
			memberUserId: sessionOwnerUserId,
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
	const bindingTarget = resolveProfileBindingCatalogExecutionTarget(
		recovery,
		resolveSessionPresetBindingTarget({
			ownerMode,
			sessionPreset,
			sessionPresetAgentId,
		})
	);
	const ownLocalAgentIds = bindableLocalAgentIdsFromTarget(bindingTarget);
	const teammateBindingOptions = useMemo(
		() =>
			resolveTeammateBindingOptions({
				computers: organizationComputersQuery.data ?? null,
				sessionPreset: ownerMode === "teammate" ? sessionPreset : undefined,
				targetOwnerUserId,
			}),
		[
			organizationComputersQuery.data,
			ownerMode,
			sessionPreset,
			targetOwnerUserId,
		]
	);
	const selectedTeammateBinding = teammateBindingOptions.find(
		(option) => option.choice.value === agentBindingValue
	);
	const modelCompatibilityContext = resolveCreateModelCompatibilityContext({
		bindingTarget,
		boundAgentId,
		orgSlug,
		ownerMode,
		selectedTeammateBinding,
	});
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
	const sessionPresetBindingBlockReason =
		resolveSessionPresetBindingBlockReason({
			bindingTarget,
			boundAgentId,
			hasSessionPreset: Boolean(sessionPreset),
			ownerMode,
			selectedTeammateBinding,
			sessionPresetAgentId,
		});
	const profileCreationExecutionTarget = resolveProfileCreationExecutionTarget({
		bindingTarget,
		hasSessionPreset: Boolean(sessionPreset),
		recovery,
	});
	const agentControllerConversationId =
		resolveAgentActivitySessionConversationId(sessionPreset);
	const sessionInventorySelection =
		resolveAgentActivitySessionInventorySelection(sessionPreset);

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
			setBoundAgentControllerCollaborationMode(
				remembered.agentControllerCollaborationMode
			);
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
		dispatchForm({
			state: {
				...createInitialCreateProfileDialogFormState({
					initialOwnerMode,
					initialSessionPreset,
				}),
				boundAgentId: sessionPresetAgentId ?? "",
				profileKind: null,
				selectedProjectId: "",
			},
			type: "reset",
		});
	};

	const createProfileMutation = useMutation({
		mutationFn: (submission: { idempotencyKey: string }) =>
			submitProfileCreation({
				agentControllerConversationId,
				agentControllerCollaborationMode:
					resolveCreateAgentControllerCollaborationMode({
						boundAgentControllerCollaborationMode,
						boundAgentId,
					}),
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
				currentUserId,
				idempotencyKey: submission.idempotencyKey,
				onAfterJoin: input.onAfterJoin,
				organizationAuthorizationContext,
				organizationId,
				ownerMode,
				profileKind: selectableProfileKind,
				profileName,
				profileCreationExecutionTarget,
				projectFolderPath,
				queryClient,
				recovery,
				selectedHumanProfile,
				selectedProjectBindingGeneration,
				selectedProjectId,
				selectedTeammateBinding,
				sessionInventorySelection,
				sessionPreset,
				sessionStrategy: sessionMode,
				sessionPresetBindingBlockReason,
				spaceContext,
				targetOwnerUserId,
			}),
		onError: (error) => {
			if (error instanceof SessionProfileCreationRolledBackError) {
				creationIntentRef.current = null;
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
		onSuccess: (result) =>
			handleProfileCreationSuccess({
				onAfterJoin: input.onAfterJoin,
				onAgentRequestCreated: input.onAgentRequestCreated,
				onClose: () => input.onOpenChange(false),
				onProfileCreated: input.onProfileCreated,
				onReset: resetForm,
				organizationId,
				queryClient,
				result,
				spaceContext,
				storageScope: recovery.storageScope,
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
	const projectSelectionBlockReason =
		resolveAgentProfileProjectSelectionBlockReason({
			boundAgentId,
			ownerMode,
			projectFolderPath,
			projectsPending: projectsQuery.isPending,
			projectWorkspaceFallback,
			selectedProjectBindingGeneration,
			selectedProjectId,
			sessionPreset,
		});
	const projectSelectionSlot = renderProjectSelectionSlot({
		creationDefaultsEditedRef,
		disabled:
			createProfileMutation.isPending ||
			sessionPreset?.mode === "resume" ||
			sessionPreset?.mode === "fork",
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
	const ownerChoice = initialSessionPreset
		? null
		: renderAgentProfileOwnerChoice({
				canRequestForTeammate,
				currentUserId,
				disabled: createProfileMutation.isPending,
				members: organizationDirectoryQuery.data?.members ?? [],
				onResetBinding: (nextMode) => {
					setSessionMode("new");
					setSessionPreset(undefined);
					setAgentBindingValue("");
					setBoundAgentId("");
					setBoundAgentControllerCollaborationMode(null);
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
					setSessionMode("new");
					setSessionPreset(undefined);
					setTargetOwnerUserId(userId);
					setAgentBindingValue("");
					setBoundAgentId("");
					setBoundAgentControllerCollaborationMode(null);
					setBoundAgentControllerPermissionMode(
						DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE
					);
					setBoundAgentControllerPermissionModeConfirmed(false);
					setBoundModelId("");
					setBoundOpenCodePermission(null);
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
	const sessionChoice = renderAgentProfileSessionChoice({
		disabled: createProfileMutation.isPending,
		initialSessionPreset,
		isError: agentActivitySessionsQuery.isError,
		isPending: agentActivitySessionsQuery.isPending,
		onModeChange: (nextMode) =>
			handleAgentProfileSessionModeChange({
				creationDefaultsEditedRef,
				nextMode,
				onErrorClear: () => setErrorState(null),
				ownerMode,
				sessionPreset,
				setAgentBindingValue,
				setBoundAgentId,
				setBoundAgentControllerCollaborationMode,
				setBoundModelId,
				setBoundOpenCodePermission,
				setBoundReasoningLevel,
				setProjectWorkspaceFallback,
				setSelectedProjectBindingGeneration,
				setSelectedProjectId,
				setSessionMode,
				setSessionPreset,
			}),
		onSessionChange: (session, mode) =>
			applyAgentProfileSessionSelection({
				creationDefaultsEditedRef,
				onErrorClear: () => setErrorState(null),
				ownerMode,
				profileName,
				session,
				mode,
				setAgentBindingValue,
				setBoundAgentControllerCollaborationMode,
				setBoundAgentControllerPermissionMode,
				setBoundAgentControllerPermissionModeConfirmed,
				setBoundAgentId,
				setBoundModelId,
				setBoundOpenCodePermission,
				setBoundReasoningLevel,
				setProfileName,
				setProjectFolderPath,
				setProjectWorkspaceFallback,
				setSelectedProjectBindingGeneration,
				setSelectedProjectId,
				setSessionMode,
				setSessionPreset,
			}),
		selectedSessionKey: resolveSelectedSessionKey(sessionPreset),
		sessionMode,
		sessions: agentActivitySessionsQuery.data?.sessions ?? [],
	});
	const additionalSubmitBlockReason = resolveAgentProfileSubmitBlockReason({
		ownerBlockReason: resolveOwnerSubmitBlockReason({
			directoryPending: organizationDirectoryQuery.isPending,
			ownerMode,
			targetOwnerUserId,
		}),
		sessionMode,
		sessionPreset,
		sessionPresetBindingBlockReason,
	});

	const formProps = {
		additionalHumanProfileCreationEnabled,
		additionalSubmitBlockReason,
		agentBindingChoices: teammateBindingChoices,
		agentBindingValue: ownerMode === "self" ? boundAgentId : agentBindingValue,
		agentOwnershipSlot: ownerChoice,
		agentSessionSlot: sessionChoice,
		allowProfileKindSelection: !initialSessionPreset,
		availableLocalAgentIds,
		boundAgentControllerCollaborationMode,
		boundAgentControllerPermissionMode,
		boundAgentControllerPermissionModeConfirmed,
		boundAgentId,
		boundModelId,
		boundOpenCodePermission,
		boundReasoningLevel,
		errorState,
		isResolvingAccount: profilesQuery.isPending,
		isResolvingLocalAgents,
		isSubmitting: createProfileMutation.isPending,
		localFolderPickerDeviceId:
			ownerMode === "self" ? localFolderPickerDeviceId : null,
		lockLocalAgentSelection: Boolean(sessionPreset),
		modelCatalog,
		modelCompatibilityContext,
		onChangeAgentBindingValue: (value: string) => {
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
			setBoundAgentControllerCollaborationMode(null);
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
			setProjectWorkspaceFallback(ownerMode === "self" ? "managed" : null);
			setErrorState(null);
		},
		onChangeBoundAgentControllerCollaborationMode: (
			nextCollaborationMode: AgentControllerCollaborationMode
		) => {
			creationDefaultsEditedRef.current = true;
			setBoundAgentControllerCollaborationMode(nextCollaborationMode);
			setErrorState(null);
		},
		onChangeBoundAgentControllerPermissionMode: (
			nextAgentControllerPermissionMode
		) => {
			creationDefaultsEditedRef.current = true;
			setBoundAgentControllerPermissionMode(
				resolveAgentControllerPermissionModeForController(
					nextAgentControllerPermissionMode,
					{
						agentControllerRef: buildBuiltinAgentControllerRef(boundAgentId),
					}
				)
			);
			setErrorState(null);
		},
		onChangeBoundAgentControllerPermissionModeConfirmed:
			setBoundAgentControllerPermissionModeConfirmed,
		onChangeBoundAgentId: (nextAgentId: string) => {
			appliedCreationDefaultsKeyRef.current = null;
			creationDefaultsEditedRef.current = false;
			setBoundAgentId(nextAgentId);
			setBoundAgentControllerCollaborationMode(null);
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
		},
		onChangeBoundModelId: (nextModelId: string) => {
			creationDefaultsEditedRef.current = true;
			setBoundModelId(nextModelId);
			setBoundReasoningLevel("");
			setErrorState(null);
		},
		onChangeBoundOpenCodePermission: (
			nextOpenCodePermission: AgentProfileBindingOpenCodePermission | null
		) => {
			creationDefaultsEditedRef.current = true;
			setBoundOpenCodePermission(nextOpenCodePermission);
			setErrorState(null);
		},
		onChangeBoundReasoningLevel: (nextReasoningLevel: string) => {
			creationDefaultsEditedRef.current = true;
			setBoundReasoningLevel(nextReasoningLevel);
			setErrorState(null);
		},
		onChangeProfileName: (nextProfileName: string) => {
			setProfileName(nextProfileName);
			setErrorState(null);
		},
		onChangeProjectFolderPath: (nextProjectFolderPath: string) => {
			setProjectFolderPath(nextProjectFolderPath);
			setErrorState(null);
		},
		onSelectProfileKind: (nextProfileKind: NewProfileKind) => {
			if (sessionPreset) {
				return;
			}
			handleProfileKindSelection({
				additionalHumanProfileCreationEnabled,
				nextProfileKind,
				onClearAgentFields: () => {
					setBoundAgentId("");
					setBoundAgentControllerCollaborationMode(null);
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
		},
		onSubmit: (event: FormEvent<HTMLFormElement>) => {
			handleCreateProfileSubmit({
				creationIntentRef,
				event,
				fingerprint: buildCreationFingerprint({
					agentBindingValue,
					authorizeForOrganization,
					boundAgentControllerCollaborationMode,
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
					sessionPresetKey: resolveSessionPresetKey(sessionPreset),
					targetOwnerUserId,
				}),
				onErrorClear: () => setErrorState(null),
				onSubmit: (idempotencyKey) =>
					createProfileMutation.mutate({ idempotencyKey }),
				submissionInFlightRef,
			});
		},
		organizationWakeAccessSlot,
		profileKind: selectableProfileKind,
		profileName,
		projectFolderPath,
		projectSelectionBlockReason,
		projectSelectionSlot,
		recoveryActionHref,
		submitLabel: ownerMode === "teammate" ? "Request Agent" : undefined,
		submittingLabel: ownerMode === "teammate" ? "Requesting Agent…" : undefined,
	} satisfies ComponentProps<typeof CreateProfileForm>;

	return {
		description: resolveCreateProfileDialogDescription({
			agentActivitySessionPreset: sessionPreset,
			additionalHumanProfileCreationEnabled,
			ownerMode,
			spaceContext,
			targetOwnerName:
				organizationDirectoryQuery.data?.members.find(
					(member) => member.userId === targetOwnerUserId
				)?.user.name ?? null,
		}),
		formProps,
		onOpenChange: (nextOpen: boolean) => {
			handleCreateProfileDialogOpenChange({
				isSubmitting: createProfileMutation.isPending,
				nextOpen,
				onClose: resetForm,
				onOpenChange: input.onOpenChange,
			});
		},
		title: dialogTitle,
	};
}

function resolveSessionOwnerUserId(input: {
	currentUserId: string;
	initialSessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
	ownerMode: AgentProfileOwnerMode;
	targetOwnerUserId: string;
}): string {
	if (input.ownerMode === "teammate") {
		return input.targetOwnerUserId;
	}
	return input.currentUserId || input.initialSessionPreset?.ownerUserId || "";
}

function shouldReadAgentProfileSessionChoices(input: {
	open: boolean;
	profileKind: NewProfileKind | null;
	sessionOwnerUserId: string;
}): boolean {
	return (
		input.open &&
		input.profileKind === "agent" &&
		Boolean(input.sessionOwnerUserId)
	);
}

function resolveSessionPresetBindingTarget(input: {
	ownerMode: AgentProfileOwnerMode;
	sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
	sessionPresetAgentId: string | null;
}):
	| {
			connectedComputerId: string;
			localAgentId: string;
	  }
	| undefined {
	if (!(input.sessionPreset && input.ownerMode === "self")) {
		return undefined;
	}
	return {
		connectedComputerId: input.sessionPreset.computerId,
		localAgentId: input.sessionPresetAgentId ?? "",
	};
}

function resolveAgentProfileProjectSelectionBlockReason(
	input: Parameters<typeof resolveOwnerProjectSelectionBlockReason>[0] & {
		sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
	}
): string | null {
	if (
		input.sessionPreset?.mode === "resume" ||
		input.sessionPreset?.mode === "fork"
	) {
		return null;
	}
	return resolveOwnerProjectSelectionBlockReason(input);
}

function renderAgentProfileSessionChoice(input: {
	disabled: boolean;
	initialSessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
	isError: boolean;
	isPending: boolean;
	onModeChange: (mode: AgentProfileSessionMode) => void;
	onSessionChange: (
		session: AgentActivityInventorySession,
		mode: Exclude<AgentProfileSessionMode, "new">
	) => void;
	selectedSessionKey: string | null;
	sessionMode: AgentProfileSessionMode;
	sessions: readonly AgentActivityInventorySession[];
}): ReactNode {
	if (input.initialSessionPreset) {
		return null;
	}
	return (
		<AgentProfileSessionChoice
			disabled={input.disabled}
			isError={input.isError}
			isPending={input.isPending}
			mode={input.sessionMode}
			onModeChange={input.onModeChange}
			onSessionChange={input.onSessionChange}
			selectedSessionKey={input.selectedSessionKey}
			sessions={input.sessions}
		/>
	);
}

function handleAgentProfileSessionModeChange(input: {
	creationDefaultsEditedRef: { current: boolean };
	nextMode: AgentProfileSessionMode;
	onErrorClear: () => void;
	ownerMode: AgentProfileOwnerMode;
	sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
	setAgentBindingValue: (value: string) => void;
	setBoundAgentId: (value: string) => void;
	setBoundAgentControllerCollaborationMode: (
		mode: AgentControllerCollaborationMode | null
	) => void;
	setBoundModelId: (value: string) => void;
	setBoundOpenCodePermission: (
		value: AgentProfileBindingOpenCodePermission | null
	) => void;
	setBoundReasoningLevel: (value: string) => void;
	setProjectWorkspaceFallback: (value: "advanced" | "managed" | null) => void;
	setSelectedProjectBindingGeneration: (value: string | null) => void;
	setSelectedProjectId: (value: string) => void;
	setSessionMode: (mode: AgentProfileSessionMode) => void;
	setSessionPreset: (
		preset: CreateProfileAgentActivitySessionPreset | undefined
	) => void;
}) {
	input.setSessionMode(input.nextMode);
	input.onErrorClear();
	if (input.nextMode !== "new") {
		if (input.sessionPreset) {
			input.setSessionPreset({
				...input.sessionPreset,
				mode: input.nextMode,
			});
		}
		return;
	}
	input.creationDefaultsEditedRef.current = false;
	input.setSessionPreset(undefined);
	input.setAgentBindingValue("");
	input.setBoundAgentId("");
	input.setBoundAgentControllerCollaborationMode(null);
	input.setBoundModelId("");
	input.setBoundOpenCodePermission(null);
	input.setBoundReasoningLevel("");
	input.setSelectedProjectId("");
	input.setSelectedProjectBindingGeneration(null);
	input.setProjectWorkspaceFallback(
		input.ownerMode === "self" ? "managed" : null
	);
}

function applyAgentProfileSessionSelection(input: {
	creationDefaultsEditedRef: { current: boolean };
	onErrorClear: () => void;
	ownerMode: AgentProfileOwnerMode;
	profileName: string;
	session: AgentActivityInventorySession;
	mode: Exclude<AgentProfileSessionMode, "new">;
	setAgentBindingValue: (value: string) => void;
	setBoundAgentControllerCollaborationMode: (
		mode: AgentControllerCollaborationMode | null
	) => void;
	setBoundAgentControllerPermissionMode: (
		mode: AgentControllerPermissionMode
	) => void;
	setBoundAgentControllerPermissionModeConfirmed: (confirmed: boolean) => void;
	setBoundAgentId: (value: string) => void;
	setBoundModelId: (value: string) => void;
	setBoundOpenCodePermission: (
		value: AgentProfileBindingOpenCodePermission | null
	) => void;
	setBoundReasoningLevel: (value: string) => void;
	setProfileName: (value: string) => void;
	setProjectFolderPath: (value: string) => void;
	setProjectWorkspaceFallback: (value: "advanced" | "managed" | null) => void;
	setSelectedProjectBindingGeneration: (value: string | null) => void;
	setSelectedProjectId: (value: string) => void;
	setSessionMode: (mode: AgentProfileSessionMode) => void;
	setSessionPreset: (
		preset: CreateProfileAgentActivitySessionPreset | undefined
	) => void;
}) {
	const agentId = resolveSessionPresetAgentId(
		input.session.localAgent.agentControllerRef
	);
	input.creationDefaultsEditedRef.current = true;
	input.setSessionPreset(
		toCreateProfileSessionPreset(input.session, input.mode)
	);
	input.setSessionMode(input.mode);
	input.setAgentBindingValue(
		resolveSelectedSessionAgentBindingValue({
			agentId,
			ownerMode: input.ownerMode,
			session: input.session,
		})
	);
	input.setBoundAgentId(agentId ?? "");
	input.setBoundAgentControllerCollaborationMode(null);
	input.setBoundAgentControllerPermissionMode(
		DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE
	);
	input.setBoundAgentControllerPermissionModeConfirmed(false);
	input.setBoundModelId("");
	input.setBoundOpenCodePermission(null);
	input.setBoundReasoningLevel("");
	input.setSelectedProjectId(input.session.project.id);
	input.setSelectedProjectBindingGeneration(null);
	input.setProjectFolderPath("");
	input.setProjectWorkspaceFallback(null);
	input.setProfileName(
		input.profileName.trim()
			? input.profileName
			: input.session.nativeSessionTitle?.trim() ||
					`${input.session.localAgent.name} Agent`
	);
	input.onErrorClear();
}

function resolveSelectedSessionAgentBindingValue(input: {
	agentId: string | null;
	ownerMode: AgentProfileOwnerMode;
	session: AgentActivityInventorySession;
}): string {
	if (input.ownerMode === "self") {
		return input.agentId ?? "";
	}
	return `${input.session.computer.id}:${input.session.localAgent.agentControllerRef}`;
}

function resolveAgentProfileSubmitBlockReason(input: {
	ownerBlockReason: string | null;
	sessionMode: AgentProfileSessionMode;
	sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
	sessionPresetBindingBlockReason: string | null;
}): string | null {
	if (input.sessionPresetBindingBlockReason) {
		return input.sessionPresetBindingBlockReason;
	}
	if (input.sessionMode !== "new" && !input.sessionPreset) {
		return "Choose a Session to use.";
	}
	return input.ownerBlockReason;
}

type CreateProfileSubmissionInput = {
	agentControllerConversationId: string | null;
	agentControllerCollaborationMode: AgentControllerCollaborationMode | null;
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
	currentUserId: string;
	idempotencyKey: string;
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	organizationAuthorizationContext:
		| CreateProfileOrganizationAuthorizationContext
		| undefined;
	organizationId: string;
	ownerMode: AgentProfileOwnerMode;
	profileKind: NewProfileKind | null;
	profileName: string;
	profileCreationExecutionTarget: {
		deviceId: string | null;
		runtimeLane: DaemonServiceLane | null;
	};
	projectFolderPath: string;
	queryClient: QueryClient;
	recovery: RecoveryController;
	selectedHumanProfile: AuthProfileView | null;
	selectedProjectBindingGeneration: string | null;
	selectedProjectId: string;
	selectedTeammateBinding: TeammateBindingOption | undefined;
	sessionInventorySelection:
		| AgentProfileBindingSessionInventorySelection
		| undefined;
	sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
	sessionStrategy: "fork" | "new" | "resume";
	sessionPresetBindingBlockReason: string | null;
	spaceContext: CreateProfileSpaceContext | undefined;
	targetOwnerUserId: string;
};

async function submitProfileCreation(input: CreateProfileSubmissionInput) {
	assertSessionPresetBindingReady(input.sessionPresetBindingBlockReason);
	if (input.ownerMode === "teammate" || input.sessionStrategy === "fork") {
		return await requestAgentProfile(input);
	}
	return await createOwnProfile(input);
}

function handleProfileCreationSuccess(input: {
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	onAgentRequestCreated?: (request: AgentProfileCreationRequest) => void;
	onClose: () => void;
	onProfileCreated?: (profile: AuthProfileView) => void;
	onReset: () => void;
	organizationId: string;
	queryClient: QueryClient;
	result: Awaited<ReturnType<typeof submitProfileCreation>>;
	spaceContext: CreateProfileSpaceContext | undefined;
	storageScope: string;
}) {
	if (input.result.kind === "request") {
		toast.success(createdAgentRequestMessage(input.result.request));
		input.onAgentRequestCreated?.(input.result.request);
		input.onReset();
		input.onClose();
		refreshAgentProfileCreationRequestCaches({
			createdAgentProfileId: input.result.request.createdAgentProfileId,
			onAfterJoin: input.onAfterJoin,
			organizationId: input.organizationId,
			queryClient: input.queryClient,
			requestStatus: input.result.request.status,
			requestedSpaceId: input.result.request.requestedSpaceId,
			spaceContext: input.spaceContext,
			storageScope: input.storageScope,
		}).catch((error) => {
			console.warn(
				"OpenMeld created the Agent request but could not refresh its current status.",
				error
			);
		});
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

async function refreshAgentProfileCreationRequestCaches(input: {
	createdAgentProfileId: string | null;
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	organizationId: string;
	queryClient: QueryClient;
	requestStatus: AgentProfileCreationRequest["status"];
	requestedSpaceId: string | null;
	spaceContext: CreateProfileSpaceContext | undefined;
	storageScope: string;
}) {
	const refreshes: Promise<unknown>[] = [
		input.queryClient.invalidateQueries({
			queryKey: agentProfileCreationRequestQueryKeys.byOrganization(
				input.organizationId
			),
			refetchType: "active",
		}),
	];
	const createdAgentProfileId = input.createdAgentProfileId;
	if (createdAgentProfileId) {
		refreshes.push(
			input.queryClient.invalidateQueries({
				queryKey: startQueryKeys.profilesForStorageScope(input.storageScope),
				refetchType: "active",
			}),
			refreshWebAgentReadinessSharedCaches({
				agentProfileIds: [createdAgentProfileId],
				includeLocalRuntimeCaches: false,
				organizationId: input.organizationId,
				queryClient: input.queryClient,
				storageScope: input.storageScope,
			})
		);
		if (
			input.requestStatus === "completed" &&
			input.spaceContext &&
			input.requestedSpaceId === input.spaceContext.spaceId
		) {
			refreshes.push(
				Promise.resolve()
					.then(() =>
						input.onAfterJoin?.({
							openMeldProfileId: createdAgentProfileId,
							profileKind: "agent",
						})
					)
					.catch((error) => {
						console.warn(
							"OpenMeld created and added the Agent but could not refresh the Space members panel.",
							error
						);
					})
			);
		}
	} else {
		refreshes.push(
			input.queryClient.invalidateQueries({
				queryKey: organizationQueryKeys.directory(input.organizationId),
				refetchType: "active",
			})
		);
	}
	await Promise.all(refreshes);
}

async function requestAgentProfile(input: CreateProfileSubmissionInput) {
	const result = await createAgentProfileCreationRequest({
		configuration: {
			agentControllerCollaborationMode: input.agentControllerCollaborationMode,
			agentControllerPermissionMode: input.agentControllerPermissionMode,
			agentControllerRef:
				input.ownerMode === "self"
					? input.agentControllerRef || null
					: (input.selectedTeammateBinding?.agentControllerRef ?? null),
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
			targetComputerId:
				input.ownerMode === "self"
					? input.profileCreationExecutionTarget.deviceId
					: (input.selectedTeammateBinding?.targetComputerId ?? null),
		},
		idempotencyKey: input.idempotencyKey,
		nativeSessionId:
			input.sessionStrategy === "new"
				? null
				: (input.sessionPreset?.nativeSessionId ?? null),
		organizationId: input.organizationId,
		profileName: input.profileName,
		requestedSpaceId: input.spaceContext?.spaceId ?? null,
		sessionStrategy: input.sessionStrategy,
		targetOwnerUserId:
			input.ownerMode === "self"
				? (input.sessionPreset?.ownerUserId ?? input.currentUserId)
				: input.targetOwnerUserId,
	});
	return { kind: "request" as const, request: result.request };
}

async function createOwnProfile(input: CreateProfileSubmissionInput) {
	const defaultProjectId = resolveSelectedDefaultProjectId({
		selectedProjectBindingGeneration: input.selectedProjectBindingGeneration,
		selectedProjectId: input.selectedProjectId,
	});
	const creationOutcome = await createProfileWithFollowUps({
		agentControllerConversationId: input.agentControllerConversationId,
		...(input.agentControllerCollaborationMode
			? {
					agentControllerCollaborationMode:
						input.agentControllerCollaborationMode,
				}
			: {}),
		...(input.agentControllerPermissionMode
			? { agentControllerPermissionMode: input.agentControllerPermissionMode }
			: {}),
		boundAgentId: input.boundAgentId,
		currentServiceCanSetProfileWorkspace:
			input.bindingTarget?.localAgentControl.setProfileWorkspace === true,
		defaultProjectId,
		deviceId: input.profileCreationExecutionTarget.deviceId,
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
		runtimeLane: input.profileCreationExecutionTarget.runtimeLane,
		...toSessionInventorySelectionInput(input.sessionInventorySelection),
		selectedHumanProfile: input.selectedHumanProfile,
		selectedHumanProfileId:
			input.selectedHumanProfile?.openMeldProfileId ?? null,
		spaceContext: input.spaceContext,
	});
	const { profile } = creationOutcome;
	const [creationDefaultsUpdateFailed, organizationAuthorization] =
		await Promise.all([
			rememberSuccessfulAgentProfileCreationDefaults({
				agentControllerCollaborationMode:
					input.agentControllerCollaborationMode,
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
			<section className="grid min-w-0 gap-2">
				<p className="font-medium text-sm">Working folder</p>
				<div className="flex items-center gap-2 text-muted-foreground text-sm">
					<Bars
						aria-label="Loading working folder choices"
						className="h-4 w-5 shrink-0"
					/>
					<span>Loading your Projects and saved working folder.</span>
				</div>
				<p className="text-muted-foreground text-xs leading-5">
					You can keep editing other settings while this finishes.
				</p>
			</section>
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
	if (!input.additionalHumanProfileCreationEnabled) {
		return "agent";
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
	projectsPending: boolean;
	projectWorkspaceFallback: "advanced" | "managed" | null;
	selectedProjectBindingGeneration: string | null;
	selectedProjectId: string;
}): string | null {
	if (input.ownerMode !== "self") {
		return null;
	}
	if (input.boundAgentId && input.projectsPending) {
		return "Loading working folder choices.";
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
	boundAgentControllerCollaborationMode: AgentControllerCollaborationMode | null;
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
	sessionPresetKey: string | null;
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
		input.boundAgentControllerCollaborationMode,
		input.boundAgentControllerPermissionMode,
		input.boundModelId,
		input.boundOpenCodePermission,
		input.boundReasoningLevel,
		input.selectedProjectId,
		input.sessionPresetKey,
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

function resolveCreateProfileDialogTitle(input: {
	additionalHumanProfileCreationEnabled: boolean;
}): string {
	return input.additionalHumanProfileCreationEnabled
		? "Create a new profile"
		: "Create a new Agent";
}

function resolveCreateProfileDialogDescription(input: {
	agentActivitySessionPreset:
		| CreateProfileAgentActivitySessionPreset
		| undefined;
	additionalHumanProfileCreationEnabled: boolean;
	ownerMode: AgentProfileOwnerMode;
	spaceContext: CreateProfileSpaceContext | undefined;
	targetOwnerName: string | null;
}): string {
	if (input.agentActivitySessionPreset?.mode === "resume") {
		if (input.ownerMode === "teammate") {
			return `Request an Agent for ${input.targetOwnerName ?? "this teammate"} that continues this Session.`;
		}
		return input.agentActivitySessionPreset.status === "working"
			? "Connect this working Session to a new Agent. Fork it instead when you want to preserve the work already in progress."
			: "Connect this Session to a new Agent so it can continue with the same Local Agent context.";
	}
	if (input.agentActivitySessionPreset?.mode === "fork") {
		if (input.ownerMode === "teammate") {
			return `Request an Agent for ${input.targetOwnerName ?? "this teammate"} from a copy of this Session. The original stays unchanged.`;
		}
		return "Create a new Agent from a copy of this Session. The original Session stays unchanged.";
	}
	if (input.agentActivitySessionPreset?.mode === "create") {
		return "Create a new Agent with this Local Agent and Project. The existing Session stays unchanged.";
	}
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

function resolveSessionPresetAgentId(
	agentControllerRef: string
): string | null {
	const parsed = parseAgentControllerRef(agentControllerRef);
	return parsed?.kind === "builtin" ? parsed.id : null;
}

function resolveAgentActivitySessionConversationId(
	preset: CreateProfileAgentActivitySessionPreset | undefined
): string | null {
	return preset?.mode === "resume" ? preset.nativeSessionId : null;
}

function resolveAgentActivitySessionInventorySelection(
	preset: CreateProfileAgentActivitySessionPreset | undefined
): AgentProfileBindingSessionInventorySelection | undefined {
	if (preset?.mode !== "resume") {
		return undefined;
	}
	return {
		computerId: preset.computerId,
		nativeSessionId: preset.nativeSessionId,
		organizationId: preset.organizationId,
		ownerUserId: preset.ownerUserId,
		projectId: preset.projectId,
		provider: preset.provider,
	};
}

function toCreateProfileSessionPreset(
	session: AgentActivityInventorySession,
	mode: CreateProfileAgentActivitySessionPreset["mode"]
): CreateProfileAgentActivitySessionPreset {
	return {
		agentControllerRef: session.localAgent.agentControllerRef,
		computerId: session.computer.id,
		localAgentName: session.localAgent.name,
		mode,
		nativeSessionId: session.nativeSessionId,
		nativeSessionTitle: session.nativeSessionTitle,
		organizationId: session.organization.id,
		ownerUserId: session.owner.userId,
		projectId: session.project.id,
		provider: session.localAgent.provider,
		status: session.status,
	};
}

function toSessionInventorySelectionInput(
	selection: AgentProfileBindingSessionInventorySelection | undefined
): {
	sessionInventorySelection?: AgentProfileBindingSessionInventorySelection;
} {
	return selection ? { sessionInventorySelection: selection } : {};
}

function resolveSessionPresetProfileName(
	preset: CreateProfileAgentActivitySessionPreset | undefined
): string {
	return preset
		? preset.nativeSessionTitle?.trim() || `${preset.localAgentName} Agent`
		: "";
}

function resolveSessionPresetKey(
	preset: CreateProfileAgentActivitySessionPreset | undefined
): string | null {
	return preset
		? `${preset.mode}:${preset.agentControllerRef}:${preset.nativeSessionId}`
		: null;
}

function resolveSelectedSessionKey(
	preset: CreateProfileAgentActivitySessionPreset | undefined
): string | null {
	if (!preset || preset.mode === "create") {
		return null;
	}
	return `${preset.computerId}:${preset.agentControllerRef}:${preset.nativeSessionId}`;
}

function resolveSessionPresetBindingBlockReason(input: {
	bindingTarget: ReturnType<typeof resolveProfileBindingCatalogExecutionTarget>;
	boundAgentId: string;
	hasSessionPreset: boolean;
	ownerMode: AgentProfileOwnerMode;
	selectedTeammateBinding: TeammateBindingOption | undefined;
	sessionPresetAgentId: string | null;
}): string | null {
	if (!input.hasSessionPreset) {
		return null;
	}
	if (!input.sessionPresetAgentId) {
		return "This Session's local agent is not supported for Agent Profile creation.";
	}
	if (input.boundAgentId !== input.sessionPresetAgentId) {
		return "This Agent Profile must use the same local agent as the Session.";
	}
	if (input.ownerMode === "teammate") {
		return input.selectedTeammateBinding
			? null
			: "This teammate’s Session is no longer connected to an available local agent.";
	}
	if (!input.bindingTarget) {
		return `Connect this Session's computer and make ${formatLocalAgentDisplayName(input.sessionPresetAgentId)} available before creating the profile.`;
	}
	return null;
}

function assertSessionPresetBindingReady(blockReason: string | null): void {
	if (blockReason) {
		throw new Error(blockReason);
	}
}

function resolveProfileCreationExecutionTarget(input: {
	bindingTarget: ReturnType<typeof resolveProfileBindingCatalogExecutionTarget>;
	hasSessionPreset: boolean;
	recovery: RecoveryController;
}): { deviceId: string | null; runtimeLane: DaemonServiceLane | null } {
	if (input.hasSessionPreset) {
		return {
			deviceId: input.bindingTarget?.deviceId ?? null,
			runtimeLane: input.bindingTarget?.runtimeLane ?? null,
		};
	}
	return {
		deviceId: input.bindingTarget?.deviceId ?? input.recovery.deviceId,
		runtimeLane: input.bindingTarget?.runtimeLane ?? input.recovery.runtimeLane,
	};
}

type TeammateBindingOption = {
	agentControllerRef: string;
	agentId: string;
	choice: AgentProfileBindingChoice;
	installedVersion: string | null;
	reportedModelIds: readonly string[] | null;
	targetComputerId: string;
};

function resolveTeammateBindingOptions(input: {
	computers: OrganizationComputersResponse | null;
	sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
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
				installedVersion: localAgent.details?.version ?? null,
				reportedModelIds:
					localAgent.details?.models.flatMap((model) =>
						model.id ? [model.id] : []
					) ?? null,
				targetComputerId: computer.computerId,
			});
		}
	}
	if (
		input.sessionPreset &&
		input.sessionPreset.ownerUserId === input.targetOwnerUserId
	) {
		const controller = parseAgentControllerRef(
			input.sessionPreset.agentControllerRef
		);
		const value = `${input.sessionPreset.computerId}:${input.sessionPreset.agentControllerRef}`;
		if (
			controller?.kind === "builtin" &&
			!options.some((option) => option.choice.value === value)
		) {
			options.push({
				agentControllerRef: controller.ref,
				agentId: controller.id,
				choice: {
					agentId: controller.id,
					description: `${input.sessionPreset.localAgentName} for the selected Session.`,
					label: input.sessionPreset.localAgentName,
					value,
				},
				installedVersion: null,
				reportedModelIds: null,
				targetComputerId: input.sessionPreset.computerId,
			});
		}
	}
	return options.sort((left, right) =>
		`${left.choice.label}:${left.choice.description}`.localeCompare(
			`${right.choice.label}:${right.choice.description}`
		)
	);
}

function resolveCreateModelCompatibilityContext(input: {
	bindingTarget: ReturnType<typeof resolveProfileBindingCatalogExecutionTarget>;
	boundAgentId: string;
	orgSlug: string | null | undefined;
	ownerMode: AgentProfileOwnerMode;
	selectedTeammateBinding: TeammateBindingOption | undefined;
}): AgentProfileModelCompatibilityContext | null {
	if (!input.boundAgentId) {
		return null;
	}
	if (input.ownerMode === "teammate") {
		const option = input.selectedTeammateBinding;
		if (!option) {
			return null;
		}
		return {
			agentControllerId: option.agentId,
			controllerDisplayName: formatLocalAgentDisplayName(option.agentId),
			installedVersion: option.installedVersion,
			managePath: input.orgSlug
				? buildOrganizationComputerPath({
						deviceId: option.targetComputerId,
						orgSlug: input.orgSlug,
					})
				: null,
			reportedModelIds: option.reportedModelIds,
		};
	}
	const agentControllerRef = buildBuiltinAgentControllerRef(input.boundAgentId);
	const snapshot = input.bindingTarget?.capabilities.find(
		(capability) => capability.agentControllerRef === agentControllerRef
	)?.agentControllerInterface;
	return {
		agentControllerId: input.boundAgentId,
		controllerDisplayName: formatLocalAgentDisplayName(input.boundAgentId),
		installedVersion: snapshot?.version ?? null,
		managePath:
			input.orgSlug && input.bindingTarget
				? buildOrganizationComputerPath({
						deviceId: input.bindingTarget.deviceId,
						orgSlug: input.orgSlug,
					})
				: null,
		reportedModelIds: snapshot?.models.map((model) => model.id) ?? null,
	};
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
	return "Waiting for a connected working folder. Choose another working folder to continue now.";
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

function resolveCreateAgentControllerCollaborationMode(input: {
	boundAgentControllerCollaborationMode: AgentControllerCollaborationMode | null;
	boundAgentId: string;
}): AgentControllerCollaborationMode | null {
	if (!input.boundAgentId) {
		return null;
	}
	return (
		resolveNativeAgentControllerCollaborationModeForController(
			input.boundAgentControllerCollaborationMode,
			{
				agentControllerRef: buildBuiltinAgentControllerRef(input.boundAgentId),
			}
		) ?? null
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
	agentControllerCollaborationMode: AgentControllerCollaborationMode | null;
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
			agentControllerCollaborationMode: input.agentControllerCollaborationMode,
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
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
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
