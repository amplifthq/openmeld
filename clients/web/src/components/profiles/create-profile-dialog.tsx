"use client";

import {
	buildLocalAgentConnectionCandidateId,
	DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE,
	listAgentControllerCollaborationModeOptions,
	listAgentControllerPermissionModeOptions,
	parseAgentControllerRef,
	resolveAgentControllerPermissionModeForController,
	resolveNativeAgentControllerCollaborationModeForController,
} from "@openmeld/agent-runtime";
import { toStructuredApiClientFailure } from "@openmeld/api-client";
import {
	buildLocalAgentGuideDetailPath,
	getLocalAgentInstallGuide,
} from "@openmeld/product-catalog/local-agent-install-guides";
import {
	DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
	formatAgentRecoveryActionLabel,
	type HarnessKind,
	HOSTED_REMOTE_AGENT_CONTROLLER_REF,
	resolveBuiltinAgentControllerConversationCapability,
	TEAMMATE_AGENT_REQUESTS_ENABLED,
} from "@openmeld/schemas";
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
	PeopleComputer,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { Bars } from "@openmeld/ui/components/bars";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { ArrowLeftIcon } from "@phosphor-icons/react";
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
import { isLocalAgentControlStillRunningError } from "#/components/agents/agents-page-formatters";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { AgentCreationComputerSetup } from "#/components/connect/agent-creation-computer-setup";
import { canConfigureLocalComputer } from "#/desktop/platform";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { resolveLocalFolderPickerDeviceId } from "#/lib/connect/local-folder-picker";
import { useOptionalCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationComputerPath,
} from "#/lib/organizations/organization-routes";
import {
	readAgentCreationIntent,
	rememberAgentCreationIntent,
} from "#/lib/profiles/agent-creation-intent";
import { resolveRememberedAgentProfileCreationDefaults } from "#/lib/profiles/agent-profile-creation-defaults";
import {
	type AgentProfileCreationJourneyDraft,
	buildAgentProfileCreationJourneyDraftStorageKey,
	readAgentProfileCreationJourneyDraft,
	writeAgentProfileCreationJourneyDraft,
} from "#/lib/profiles/agent-profile-creation-journey-draft";
import {
	continuePendingAgentProfileCreationLocalSetup,
	rememberPendingAgentProfileCreationLocalSetup,
} from "#/lib/profiles/agent-profile-creation-local-setup";
import type { OptimisticAgentProfileCreation } from "#/lib/profiles/agent-profile-creation-requests";
import { buildAgentProfileTemplateName } from "#/lib/profiles/agent-profile-template-name";
import type {
	NewProfileErrorState,
	NewProfileKind,
} from "#/lib/profiles/create-profile-flow";
import {
	type CreatedProfileFollowUpIssue,
	type CreateProfileSpaceContext,
	createProfileWithFollowUps,
	type SpaceJoinedProfileReference,
} from "#/lib/profiles/create-profile-orchestration";
import { resolveLocalAgentCreationGuidance } from "#/lib/profiles/local-agent-creation-guidance";
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
import { currentLocalRuntimeReplyReadinessQueryOptions } from "#/query/connect/local-runtimes";
import { agentActivitySessionsQueryOptions } from "#/query/organizations/agent-activity";
import { memberAgentQueryKeys } from "#/query/organizations/member-agents";
import {
	organizationComputersQueryOptions,
	organizationDirectoryQueryFilters,
	organizationDirectoryQueryOptions,
	organizationQueryKeys,
} from "#/query/organizations/organization-directory";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { agentProfileCreationDefaultsQueryOptions } from "#/query/profiles/agent-profile-creation-defaults";
import {
	agentProfileCreationRequestQueryKeys,
	createPresentedAgentProfileCreationRequest as createAgentProfileCreationRequest,
} from "#/query/profiles/agent-profile-creation-requests";
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
import { AgentProfileGenerator } from "./agent-profile-generator";
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
	type AgentProfileLocalAgentEmptyState,
	type AgentProfileLocalAgentSelectionState,
	type AgentProfileModelCompatibilityContext,
	CreateProfileForm,
} from "./create-profile-form";
import { resolveCreateProfileSubmitBlockReason } from "./create-profile-form-logic";
import { formatLocalAgentDisplayName } from "./local-agent-display-name";
import { isOpenCodeAgentId } from "./open-code-permissions-field";
import { RequestedAgentProjectField } from "./requested-agent-project-field";
import {
	SharedConversationConfirmation,
	SharedConversationFields,
} from "./shared-conversation-confirmation";
import { useAgentCreationComputerRecovery } from "./use-agent-creation-computer-recovery";

type RecoveryController = ReturnType<typeof useLocalAgentRecoveryController>;
const PROJECT_PATH_SEPARATOR_PATTERN = /[\\/]/u;
const PROJECT_PATH_TRAILING_SEPARATOR_PATTERN = /[\\/]+$/u;
// A local agent control request can outlive the Gateway's five-second response
// timeout while the Service completes a fresh controller report. Keep the
// pending state local to this switch and reconcile against the canonical
// Computer projection long enough for that report to arrive.
const LOCAL_AGENT_ENABLE_CONFIRMATION_DELAYS_MS = [
	0, 1000, 2000, 4000, 5000, 5000, 5000, 5000, 5000,
];

export type { CreateProfileSpaceContext } from "#/lib/profiles/create-profile-orchestration";

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
	boundAgentControllerCollaborationMode: AgentControllerCollaborationMode | null;
	boundAgentControllerPermissionMode: AgentControllerPermissionMode;
	boundAgentControllerPermissionModeConfirmed: boolean;
	boundAgentId: string;
	boundModelId: string;
	boundOpenCodePermission: AgentProfileBindingOpenCodePermission | null;
	boundReasoningLevel: string;
	errorState: NewProfileErrorState | null;
	ownerMode: AgentProfileOwnerMode;
	profileKind: NewProfileKind | null;
	profileName: string;
	profileNameEdited: boolean;
	profileNames: Record<string, string>;
	projectFolderPath: string;
	projectWorkspaceFallback: "advanced" | "managed" | "project" | null;
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
	  }
	| {
			draft: AgentProfileCreationJourneyDraft;
			type: "restore_journey_draft";
	  };

function reduceCreateProfileDialogFormState(
	state: CreateProfileDialogFormState,
	action: CreateProfileDialogFormAction
): CreateProfileDialogFormState {
	if (action.type === "reset") {
		return action.state;
	}
	if (action.type === "restore_journey_draft") {
		const profileNames =
			action.draft.profileNames ??
			(action.draft.profileName === undefined
				? {}
				: { [action.draft.agentId]: action.draft.profileName });
		return {
			...state,
			boundAgentControllerCollaborationMode:
				action.draft.agentControllerCollaborationMode,
			boundAgentControllerPermissionMode:
				action.draft.agentControllerPermissionMode,
			boundAgentControllerPermissionModeConfirmed:
				state.boundAgentControllerPermissionModeConfirmed &&
				state.boundAgentControllerPermissionMode ===
					action.draft.agentControllerPermissionMode,
			boundAgentId: action.draft.agentId,
			boundModelId: action.draft.modelId,
			boundOpenCodePermission: action.draft.openCodePermission,
			boundReasoningLevel: action.draft.reasoningLevel,
			profileNames,
			profileName: profileNames[action.draft.agentId] ?? "",
			profileNameEdited: profileNames[action.draft.agentId] !== undefined,
			projectWorkspaceFallback: "managed",
			selectedProjectId: "",
			selectedProjectBindingGeneration: null,
			projectFolderPath: "",
		};
	}
	const next = { ...state, ...action.patch };
	if (next.boundAgentId !== state.boundAgentId && state.boundAgentId) {
		next.profileName = state.profileNames[next.boundAgentId] ?? "";
		next.profileNameEdited =
			state.profileNames[next.boundAgentId] !== undefined;
	} else if (action.patch.profileName !== undefined && state.boundAgentId) {
		next.profileNames = {
			...state.profileNames,
			[state.boundAgentId]: action.patch.profileName,
		};
	}
	return next;
}

function createInitialCreateProfileDialogFormState(input: {
	initialProfileKind: NewProfileKind | null;
	initialOwnerMode: AgentProfileOwnerMode;
	initialSessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
	pinnedHarnessKind?: string;
}): CreateProfileDialogFormState {
	const sessionPresetAgentId = resolveSessionPresetAgentId(
		input.initialSessionPreset?.agentControllerRef ?? ""
	);
	return {
		agentBindingValue:
			input.initialOwnerMode === "teammate" && input.initialSessionPreset
				? `${input.initialSessionPreset.computerId}:${input.initialSessionPreset.agentControllerRef}`
				: "",
		boundAgentControllerCollaborationMode: null,
		boundAgentControllerPermissionMode:
			DEFAULT_AGENT_CONTROLLER_PERMISSION_MODE,
		boundAgentControllerPermissionModeConfirmed: false,
		boundAgentId: sessionPresetAgentId ?? input.pinnedHarnessKind ?? "",
		boundModelId: "",
		boundOpenCodePermission: null,
		boundReasoningLevel: "",
		errorState: null,
		ownerMode: input.initialOwnerMode,
		profileKind: input.initialProfileKind,
		profileName: resolveSessionPresetProfileName(input.initialSessionPreset),
		profileNameEdited: false,
		profileNames: {},
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
		setErrorState: setField("errorState"),
		setOwnerMode: setField("ownerMode"),
		setProfileKind: setField("profileKind"),
		setProfileName: setField("profileName"),
		setProfileNameEdited: setField("profileNameEdited"),
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

function resolveInitialOwnerMode(input: {
	currentUserId: string;
	sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
}): AgentProfileOwnerMode {
	if (!(input.sessionPreset && input.currentUserId)) {
		return "self";
	}
	return input.sessionPreset.ownerUserId === input.currentUserId
		? "self"
		: "teammate";
}

function resolveInitialCreateProfileKind(input: {
	agentOnly: boolean;
	hasSessionPreset: boolean;
}): NewProfileKind | null {
	return input.agentOnly || input.hasSessionPreset ? "agent" : null;
}

function resolvePersonalRemoteAgentCreation(
	ownerMode: AgentProfileOwnerMode,
	hasSessionPreset: boolean,
	userId: string | null | undefined,
	action: NonNullable<
		ComponentProps<typeof CreateProfileForm>["remoteAgentCreation"]
	>
): ComponentProps<typeof CreateProfileForm>["remoteAgentCreation"] {
	return ownerMode === "self" && !hasSessionPreset && userId
		? action
		: undefined;
}

function resolveAdditionalHumanProfileCreationEnabled(input: {
	accountAllowsAdditionalHumanProfileCreation: boolean;
	agentOnly: boolean;
}): boolean {
	return !input.agentOnly && input.accountAllowsAdditionalHumanProfileCreation;
}

function resolveEffectiveCreateProfileName(input: {
	profileKind: NewProfileKind | null;
	profileName: string;
	profileNameEdited: boolean;
	suggestedProfileName: string;
	templateNaming: boolean;
}): string {
	if (
		input.templateNaming &&
		input.profileKind === "agent" &&
		!input.profileNameEdited
	) {
		return input.suggestedProfileName;
	}
	return input.profileName;
}

// Standalone, route-free Create Profile dialog. Reused from Profiles, legacy
// agent redirects, and Spaces — the only difference is `spaceContext`: when
// present, the freshly created profile is also joined to that Space (always as a
// human acting profile); when absent, it is created in the selected Organization
// without Space membership. Carries zero dependency on retired start pages or
// route intents.
export type CreateProfileDialogProps = {
	agentActivitySessionPreset?: CreateProfileAgentActivitySessionPreset;
	agentOnly?: boolean;
	allowTeammateRequests?: boolean;
	currentUserId?: string;
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	onAgentRequestCreated?: (
		request: AgentProfileCreationRequest,
		customWorkingFolderIssue: string | null
	) => void | Promise<void>;
	onAgentRequestAccepted?: (
		request: AgentProfileCreationRequest,
		optimisticId: string
	) => void | Promise<void>;
	onAgentRequestFailed?: (creation: OptimisticAgentProfileCreation) => void;
	onAgentRequestStarted?: (creation: OptimisticAgentProfileCreation) => void;
	waitForAgentRequestCompletion?: boolean;
	intentStorageScope?: string;
	clearIntentOnAcceptance?: boolean;
	manageAgentCreationCachesExternally?: boolean;
	onOpenChange: (open: boolean) => void;
	onProfileCreated?: (profile: AuthProfileView) => void | Promise<void>;
	open: boolean;
	/** Creates another Profile of one MemberAgent: only this harness is offered. */
	pinnedHarnessKind?: HarnessKind;
	organizationId: string;
	orgSlug?: string;
	recovery: RecoveryController;
	spaceContext?: CreateProfileSpaceContext;
};

export function CreateProfileDialog(input: CreateProfileDialogProps) {
	const view = useCreateProfileDialogController(input, {
		agentOnly: input.agentOnly === true,
		templateNaming: true,
	});
	return (
		<Dialog onOpenChange={view.onOpenChange} open={input.open}>
			<DialogContent className="flex max-h-[min(46rem,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-2xl">
				<DialogHeader>
					<DialogTitle>{view.title}</DialogTitle>
					<DialogDescription>{view.description}</DialogDescription>
				</DialogHeader>
				<AgentProfileGenerator form={view.formProps} surface="dialog" />
			</DialogContent>
		</Dialog>
	);
}

export function LegacyCreateProfileDialog(input: CreateProfileDialogProps) {
	const view = useCreateProfileDialogController(input, {
		agentOnly: input.agentOnly === true,
		templateNaming: false,
	});
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

// Content for an existing picker Dialog. Omit spaceContext so creation never
// grants Space membership before the picker's final Add selected action.
export function CreateProfileDialogStep(
	input: Omit<CreateProfileDialogProps, "spaceContext"> & {
		onBusyChange: (busy: boolean) => void;
	}
) {
	const [connectingComputer, setConnectingComputer] = useState(false);
	const view = useCreateProfileDialogController(input, {
		agentOnly: true,
		templateNaming: true,
	});
	useEffect(() => {
		input.onBusyChange(view.formProps.isSubmitting);
		return () => input.onBusyChange(false);
	}, [input.onBusyChange, view.formProps.isSubmitting]);
	if (connectingComputer && input.orgSlug) {
		return (
			<AgentCreationComputerSetup
				onBack={() => setConnectingComputer(false)}
				orgSlug={input.orgSlug}
			/>
		);
	}
	const formProps = {
		...view.formProps,
		localAgentEmptyState: view.formProps.localAgentEmptyState && {
			...view.formProps.localAgentEmptyState,
			onConnectComputer: input.orgSlug
				? () => setConnectingComputer(true)
				: undefined,
		},
	};
	return (
		<>
			<Button
				className="self-start"
				disabled={view.formProps.isSubmitting}
				onClick={() => view.onOpenChange(false)}
				size="sm"
				variant="outline"
			>
				<ArrowLeftIcon aria-hidden="true" className="size-4" />
				Back to people and agents
			</Button>
			<DialogHeader>
				<DialogTitle>{view.title}</DialogTitle>
			</DialogHeader>
			<AgentProfileGenerator form={formProps} surface="dialog" />
		</>
	);
}

export function CreateAgentProfilePage(
	input: Omit<CreateProfileDialogProps, "onOpenChange" | "open"> & {
		onCancel: () => void;
		hideRuntimeSelection?: boolean;
		hidePageHeading?: boolean;
		compactTop?: boolean;
	}
) {
	const view = useCreateProfileDialogController(
		{
			...input,
			onOpenChange: () => undefined,
			open: true,
		},
		{ agentOnly: true, templateNaming: true }
	);
	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div
				className={`@container/agent-creation mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-6 px-4 pb-6 sm:px-6 lg:px-8 ${input.compactTop ? "pt-4" : "pt-10"}`}
			>
				<AgentProfileGenerator
					form={view.formProps}
					hidePageHeading={input.hidePageHeading}
					hideRuntimeSelection={input.hideRuntimeSelection}
					onCancel={input.onCancel}
					surface="page"
				/>
			</div>
		</div>
	);
}

function resolveAllowedInitialSessionPreset(
	input: Pick<
		CreateProfileDialogProps,
		"agentActivitySessionPreset" | "currentUserId"
	>
) {
	// Launch hold: never carry another member's native session into self creation.
	return TEAMMATE_AGENT_REQUESTS_ENABLED ||
		input.agentActivitySessionPreset?.ownerUserId === input.currentUserId
		? input.agentActivitySessionPreset
		: undefined;
}

function sharedConversationConfiguration(
	shared: boolean,
	conversationId: string
) {
	return shared
		? { conversationId: conversationId.trim(), acknowledged: true as const }
		: undefined;
}

function creationSessionPresetKey(
	shared: boolean,
	conversationId: string,
	preset: CreateProfileAgentActivitySessionPreset | undefined
) {
	return shared ? conversationId.trim() : resolveSessionPresetKey(preset);
}

function useCreateProfileDialogController(
	input: CreateProfileDialogProps,
	options: { agentOnly: boolean; templateNaming: boolean }
) {
	const initialSessionPreset = resolveAllowedInitialSessionPreset(input);
	const currentUserId = input.currentUserId ?? "";
	const initialOwnerMode = resolveInitialOwnerMode({
		currentUserId,
		sessionPreset: initialSessionPreset,
	});
	const initialProfileKind = resolveInitialCreateProfileKind({
		agentOnly: options.agentOnly,
		hasSessionPreset: Boolean(initialSessionPreset),
	});
	const [formState, dispatchForm] = useReducer(
		reduceCreateProfileDialogFormState,
		{
			initialOwnerMode,
			initialProfileKind,
			initialSessionPreset,
			pinnedHarnessKind: input.pinnedHarnessKind,
		},
		createInitialCreateProfileDialogFormState
	);
	const formSetters = useMemo(
		() => createProfileDialogFormSetters(dispatchForm),
		[]
	);
	const {
		agentBindingValue,
		boundAgentControllerCollaborationMode:
			rawBoundAgentControllerCollaborationMode,
		boundAgentControllerPermissionMode: rawBoundAgentControllerPermissionMode,
		boundAgentId: rawBoundAgentId,
		boundModelId: rawBoundModelId,
		boundOpenCodePermission: rawBoundOpenCodePermission,
		boundReasoningLevel: rawBoundReasoningLevel,
		errorState,
		ownerMode,
		profileKind,
		profileName,
		profileNameEdited,
		projectFolderPath,
		selectedProjectBindingGeneration,
		selectedProjectId: rawSelectedProjectId,
		sessionMode,
		sessionPreset,
		targetOwnerUserId,
	} = formState;
	const {
		setAgentBindingValue,
		setBoundAgentControllerCollaborationMode,
		setBoundAgentControllerPermissionMode,
		setBoundAgentControllerPermissionModeConfirmed,
		setBoundAgentId,
		setBoundModelId,
		setBoundOpenCodePermission,
		setBoundReasoningLevel,
		setErrorState,
		setOwnerMode,
		setProfileKind,
		setProfileName,
		setProfileNameEdited,
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
	const accountAllowsAdditionalHumanProfileCreation =
		isAdditionalHumanProfileCreationEnabled(profileCapabilitiesQuery);
	const additionalHumanProfileCreationEnabled =
		resolveAdditionalHumanProfileCreationEnabled({
			accountAllowsAdditionalHumanProfileCreation,
			agentOnly: options.agentOnly,
		});
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
	const journeyDraftRestorationDismissedRef = useRef(false);
	const { data: modelCatalog = null } = useQuery(modelCatalogQueryOptions());
	const currentOrgSlug = useOptionalCurrentOrganizationSlug();
	const orgSlug = input.orgSlug ?? currentOrgSlug;
	const organizationId = input.organizationId;
	const journeyDraftStorageKey =
		buildAgentProfileCreationJourneyDraftStorageKey({
			organizationId,
			userId: currentUserId,
		});
	const remoteNameDraft = useRemoteNameDraft(journeyDraftStorageKey);
	const dialogTitle = resolveCreateProfileDialogTitle({
		additionalHumanProfileCreationEnabled,
	});
	const canRequestForTeammate = canRequestTeammateAgent({
		allowTeammateRequests: input.allowTeammateRequests,
		currentUserId,
		hasInitialSessionPreset: Boolean(initialSessionPreset),
		initialOwnerMode,
	});
	const teammateQueriesEnabled = input.open && canRequestForTeammate;
	const organizationDirectoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: input.open,
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
	const availableProjects = resolveAvailableProjects(projectsQuery.data);
	const recovery = input.recovery;
	const {
		choices: computerChoices,
		selectedChoice: selectedComputerChoice,
		connectionChoices,
	} = resolveCreationComputerChoices(recovery);
	const spaceContext = input.spaceContext;
	// The selected computer's catalog and the eventual Binding share one exact
	// target. A Session preset explicitly overrides the ordinary selection.
	const bindingTarget = resolveProfileBindingCatalogExecutionTarget(
		recovery,
		resolveSessionPresetBindingTarget({
			ownerMode,
			sessionPreset,
			sessionPresetAgentId,
		})
	);
	// A Profile created for a MemberAgent keeps that MemberAgent's harness; the
	// form never offers another one.
	const ownLocalAgentIds = filterPinnedHarnessAgentIds(
		bindableLocalAgentIdsFromTarget(bindingTarget),
		input.pinnedHarnessKind
	);
	const creationComputerReadiness = useCreationComputerReadiness({
		bindingTarget,
		enabled: input.open,
		recovery,
	});
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
	const { availableLocalAgentIds, isResolvingLocalAgents } =
		resolveAvailableLocalAgents({
			organizationComputersPending: organizationComputersQuery.isPending,
			ownLocalAgentIds,
			ownerMode,
			recovery,
			teammateBindingOptions,
		});
	const restoredJourneyDraft = useAgentProfileCreationJourneyDraft({
		availableLocalAgentIds,
		canRestore: canRestoreAgentProfileCreationJourneyDraft({
			creationDefaultsEdited: creationDefaultsEditedRef.current,
			journeyDraftRestorationDismissed:
				journeyDraftRestorationDismissedRef.current,
		}),
		current: {
			agentControllerCollaborationMode:
				rawBoundAgentControllerCollaborationMode,
			agentControllerPermissionMode: rawBoundAgentControllerPermissionMode,
			agentId: rawBoundAgentId,
			modelId: rawBoundModelId,
			profileNames: formState.profileNames,
			openCodePermission: rawBoundOpenCodePermission,
			reasoningLevel: rawBoundReasoningLevel,
			selectedProjectId: rawSelectedProjectId,
			version: 1,
		},
		enabled: shouldUseAgentProfileCreationJourneyDraft({
			hasInitialSessionPreset: Boolean(initialSessionPreset),
			isResolvingLocalAgents,
			modelCatalog,
			open: input.open,
			ownerMode,
			projectsPending: projectsQuery.isPending,
		}),
		key: journeyDraftStorageKey,
		modelCatalog,
		projects: availableProjects,
	});
	const effectiveFormState = restoredJourneyDraft
		? reduceCreateProfileDialogFormState(formState, {
				draft: restoredJourneyDraft,
				type: "restore_journey_draft",
			})
		: formState;
	useRestoredCreationForm({
		restoredJourneyDraft,
		journeyDraftRestorationDismissedRef,
		creationDefaultsEditedRef,
		dispatchForm,
	});
	const {
		boundAgentControllerCollaborationMode,
		boundAgentControllerPermissionMode,
		boundAgentControllerPermissionModeConfirmed,
		boundAgentId,
		boundModelId,
		boundOpenCodePermission,
		boundReasoningLevel,
		projectWorkspaceFallback,
		selectedProjectId,
	} = effectiveFormState;
	const agentControllerRef = resolveAgentControllerRef(boundAgentId);
	const sharedConversation =
		resolveBuiltinAgentControllerConversationCapability(boundAgentId)
			?.conversationScope === "account_shared";
	const [sharedConversationId, setSharedConversationId] = useState("");
	const [sharedConnectionKey, setSharedConnectionKey] = useState<string | null>(
		null
	);
	const creationDefaultsEnabled = shouldReadCreationDefaults({
		agentControllerRef,
		open: input.open,
		organizationId,
		ownerMode,
	});
	const creationDefaultsQuery = useQuery(
		agentProfileCreationDefaultsQueryOptions({
			agentControllerRef,
			enabled: creationDefaultsEnabled,
			organizationId,
		})
	);
	const modelCompatibilityContext = resolveCreateModelCompatibilityContext({
		bindingTarget,
		boundAgentId,
		orgSlug,
		ownerMode,
		selectedTeammateBinding,
	});
	const creationGuidance = resolveLocalAgentCreationGuidance({
		queryFailed: creationComputerReadiness.isError,
		readiness: creationComputerReadiness.data,
		target: bindingTarget,
	});
	const retryCreationConnection = () => {
		refreshCreationConnection().catch((error: unknown) =>
			console.error("Could not refresh the computer for Agent creation.", error)
		);
	};
	const refreshCreationConnection = async () => {
		if (
			creationGuidance === "set_up_local_agents" &&
			bindingTarget &&
			canConfigureLocalComputer()
		) {
			await recovery.refreshLocalAgentCatalog({
				deviceId: bindingTarget.deviceId,
				runtimeLane: bindingTarget.runtimeLane,
			});
			await creationComputerReadiness.refetch({ throwOnError: true });
		} else {
			await Promise.all([
				recovery.refreshAll(),
				creationComputerReadiness.refetch({ throwOnError: true }),
			]);
		}
	};
	const { computerRecovery, reconnectComputerId, selectCreationComputer } =
		useAgentCreationComputerRecovery({
			enabled: input.open && ownerMode === "self",
			orgSlug,
			recovery,
			guidance: creationGuidance,
			hasLocalAgents: ownLocalAgentIds.length > 0,
			isPending: creationComputerReadiness.isPending,
			sessionComputerId: sessionPreset?.computerId,
			onRetry: retryCreationConnection,
			refreshReadiness: creationComputerReadiness.refetch,
		});
	const recoveryActionHref = buildConnectComputerPath({
		connectedComputerId: reconnectComputerId,
		orgSlug,
		returnTo: "agent_creation",
		session: "fresh",
	});
	const localAgentEmptyState = resolveLocalAgentEmptyState({
		centerAgentHref: orgSlug
			? buildOrganizationCenterAgentChatPath(orgSlug)
			: null,
		computerHref: recoveryActionHref,
		guidance: creationGuidance,
		onRetry: retryCreationConnection,
		ownerMode,
		recoveryActionHref,
	});
	const selectedLocalAgentId = resolveOwnerBindingValue({
		agentBindingValue,
		boundAgentId,
		ownerMode,
	});
	const localAgentSelectionState = resolveLocalAgentSelectionState({
		bindingTarget,
		computerRecovery,
		creationGuidance,
		isResolvingLocalAgents,
		onRetry: retryCreationConnection,
		onSetupChanged: async () => {
			// Setup owns the local probe. Read its published inventory instead of
			// starting another all-agent probe and waiting on unrelated providers.
			await recovery.localRuntimesQuery.refetch({ throwOnError: true });
			await creationComputerReadiness.refetch({ throwOnError: true });
		},
		orgSlug,
		ownerMode,
		recovery,
		selectedLocalAgentId,
	});
	const selectedLocalAgentBindable =
		ownLocalAgentIds.includes(selectedLocalAgentId);
	useEffect(() => {
		if (ownerMode !== "self" || sessionPreset || !selectedLocalAgentId) {
			return;
		}
		const nextBoundAgentId = selectedLocalAgentBindable
			? selectedLocalAgentId
			: "";
		if (boundAgentId !== nextBoundAgentId) {
			setBoundAgentId(nextBoundAgentId);
		}
	}, [
		boundAgentId,
		ownerMode,
		selectedLocalAgentId,
		selectedLocalAgentBindable,
		sessionPreset,
		setBoundAgentId,
	]);
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
	const targetOwnerName = resolveCreateProfileOwnerName({
		currentUserId,
		directory: organizationDirectoryQuery.data ?? null,
		ownerMode,
		selectedHumanProfile,
		targetOwnerUserId,
	});
	const existingAgentProfileNames = useMemo(
		() =>
			resolveExistingAgentProfileNames({
				currentUserId,
				directory: organizationDirectoryQuery.data ?? null,
				ownerMode,
				profiles: profilesQuery.data ?? [],
				targetOwnerUserId,
			}),
		[
			currentUserId,
			organizationDirectoryQuery.data,
			ownerMode,
			profilesQuery.data,
			targetOwnerUserId,
		]
	);
	const suggestedProfileName = buildAgentProfileTemplateName({
		agentId: boundAgentId,
		existingNames: existingAgentProfileNames,
		localAgentDisplayName: boundAgentId
			? formatLocalAgentDisplayName(boundAgentId)
			: "Agent",
		modelCatalog,
		modelId: boundModelId,
		ownerDisplayName: targetOwnerName ?? "",
		reasoningLevel: boundReasoningLevel,
	});
	const effectiveProfileName = resolveEffectiveCreateProfileName({
		profileKind: selectableProfileKind,
		profileName,
		profileNameEdited,
		suggestedProfileName,
		templateNaming: options.templateNaming,
	});

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
			setBoundAgentControllerPermissionModeConfirmed(
				remembered.agentControllerPermissionModeConfirmed
			);
			setBoundModelId(remembered.modelId ?? "");
			setBoundOpenCodePermission(remembered.openCodePermission);
			setBoundReasoningLevel(remembered.reasoningLevel ?? "");
			// A saved Project identity does not prove a usable folder on this computer.
			// New sessions start with the managed folder unless the user chooses one.
			setSelectedProjectId("");
			setSelectedProjectBindingGeneration(null);
			setProjectFolderPath("");
			setProjectWorkspaceFallback("managed");
		},
		organizationId,
		projects: projectsQuery.data,
		projectsPending: projectsQuery.isPending,
	});

	const resetForm = () => {
		setSharedConversationId("");
		setSharedConnectionKey(null);
		submissionInFlightRef.current = false;
		creationIntentRef.current = null;
		appliedCreationDefaultsKeyRef.current = null;
		creationDefaultsEditedRef.current = false;
		journeyDraftRestorationDismissedRef.current = false;
		dispatchForm({
			state: {
				...createInitialCreateProfileDialogFormState({
					initialOwnerMode,
					initialProfileKind,
					initialSessionPreset,
					pinnedHarnessKind: input.pinnedHarnessKind,
				}),
				boundAgentId: sessionPresetAgentId ?? input.pinnedHarnessKind ?? "",
				profileKind: initialProfileKind,
				selectedProjectId: "",
			},
			type: "reset",
		});
	};

	const createProfileMutation = useMutation({
		mutationFn: async (submission: {
			idempotencyKey: string;
			remote?: {
				modelId: string | null;
				profileName: string;
				reasoningLevel: string | null;
			};
		}) => {
			if (submission.remote) {
				const result = await createAgentProfileCreationRequest({
					queryClient,
					configuration: {
						...DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
						agentControllerRef: HOSTED_REMOTE_AGENT_CONTROLLER_REF,
						modelId: submission.remote.modelId,
						reasoningLevel: submission.remote.reasoningLevel,
					},
					idempotencyKey: submission.idempotencyKey,
					intentStorageScope: input.intentStorageScope,
					clearIntentOnAcceptance: input.clearIntentOnAcceptance,
					waitForCompletion: input.waitForAgentRequestCompletion,
					organizationId,
					onAccepted: input.onAgentRequestAccepted,
					onFailed: input.onAgentRequestFailed,
					onStarted: input.onAgentRequestStarted,
					profileName: submission.remote.profileName,
					requestedSpaceId: spaceContext?.spaceId ?? null,
					sessionStrategy: "new",
					targetOwnerUserId: currentUserId,
				});
				return {
					kind: "request" as const,
					request: result.request,
					customWorkingFolderIssue: null,
				};
			}
			return submitProfileCreation({
				sharedConversation: sharedConversationConfiguration(
					sharedConversation,
					sharedConversationId
				),
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
				bindingTarget,
				boundAgentId,
				boundModelId,
				boundOpenCodePermission,
				boundReasoningLevel,
				currentUserId,
				idempotencyKey: submission.idempotencyKey,
				intentStorageScope: input.intentStorageScope,
				clearIntentOnAcceptance: input.clearIntentOnAcceptance,
				onAfterJoin: input.onAfterJoin,
				onAgentRequestAccepted: input.onAgentRequestAccepted,
				onAgentRequestFailed: input.onAgentRequestFailed,
				onAgentRequestStarted: input.onAgentRequestStarted,
				waitForAgentRequestCompletion: input.waitForAgentRequestCompletion,
				organizationId,
				ownerMode,
				profileKind: selectableProfileKind,
				profileName: effectiveProfileName,
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
			});
		},
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
		onSuccess: async (result) => {
			await handleProfileCreationSuccess({
				onAfterJoin: input.onAfterJoin,
				onAgentRequestCreated: input.onAgentRequestCreated,
				manageAgentCreationCachesExternally:
					input.manageAgentCreationCachesExternally,
				onClose: () => input.onOpenChange(false),
				onProfileCreated: input.onProfileCreated,
				onReset: resetForm,
				organizationId,
				queryClient,
				result,
				spaceContext,
				storageScope: recovery.storageScope,
			});
		},
		onSettled: () => {
			submissionInFlightRef.current = false;
		},
	});
	const projectSelectionBlockReason =
		resolveAgentProfileProjectSelectionBlockReason({
			creationDefaultsEnabled,
			creationDefaultsPending: creationDefaultsQuery.isPending,
			boundAgentId,
			ownerMode,
			projectFolderPath,
			projectsPending: projectsQuery.isPending,
			projectWorkspaceFallback,
			selectedProjectBindingGeneration,
			selectedProjectId,
			sessionPreset,
		});
	const handleUseManagedWorkingFolder = () => {
		creationDefaultsEditedRef.current = true;
		dispatchForm({
			type: "patch",
			patch: {
				...effectiveFormState,
				selectedProjectId: "",
				selectedProjectBindingGeneration: null,
				projectFolderPath: "",
				projectWorkspaceFallback: "managed",
				errorState: null,
			},
		});
	};
	const projectSelectionSlot = renderProjectSelectionSlot({
		target: bindingTarget
			? {
					deviceId: bindingTarget.deviceId,
					runtimeLane: bindingTarget.runtimeLane,
				}
			: undefined,
		onUseManagedWorkingFolder: handleUseManagedWorkingFolder,
		creationDefaultsEditedRef,
		disabled:
			createProfileMutation.isPending ||
			resolveInitialAgentProfileSessionMode(sessionPreset) !== "new",
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
	const ownerChoice = resolveCreateProfileOwnerChoice({
		hasInitialSessionPreset: Boolean(initialSessionPreset),
		render: () =>
			renderAgentProfileOwnerChoice({
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
			}),
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
	const ownerSubmitBlockReason = resolveOwnerSubmitBlockReason({
		directoryPending: organizationDirectoryQuery.isPending,
		ownerMode,
		targetOwnerUserId,
	});
	const additionalSubmitBlockReason = resolveAgentProfileSubmitBlockReason({
		ownerBlockReason:
			ownerSubmitBlockReason ??
			resolveSelectedLocalAgentSubmitBlockReason({
				emptyState: localAgentEmptyState,
				localAgentSelectionState,
				ownLocalAgentIds,
				ownerMode,
				selectedLocalAgentId,
			}),
		sessionMode,
		sessionPreset,
		sessionPresetBindingBlockReason,
	});

	const canChooseComputer = canChooseCreationComputer(ownerMode, sessionPreset);
	useOnlyCreationComputer({
		choices: computerChoices,
		enabled: input.open,
		canChooseComputer,
		isSubmitting: createProfileMutation.isPending,
		recovery,
		onSelect: (target) => {
			recovery.selectComputer(target);
			setBoundAgentId("");
			setAgentBindingValue("");
			setErrorState(null);
		},
	});
	const agentOwnerUserId =
		ownerMode === "teammate" ? targetOwnerUserId : currentUserId;
	const formProps: ComponentProps<typeof CreateProfileForm> = {
		remoteProfileName: remoteNameDraft.name,
		onChangeRemoteProfileName: remoteNameDraft.update,
		computerRecovery,
		agentComputerSlot:
			canChooseComputer && computerChoices.length > 0 ? (
				<div className="grid gap-2 text-sm">
					<CreationComputerSelector
						choices={computerChoices}
						disabled={createProfileMutation.isPending}
						onSelect={(target) => {
							selectCreationComputer(target);
							setBoundAgentId("");
							setAgentBindingValue("");
							setErrorState(null);
						}}
						selectedChoice={selectedComputerChoice}
					/>
					<AdvancedCreationConnectionSelector
						choices={connectionChoices}
						disabled={createProfileMutation.isPending}
						onSelect={(target) => {
							selectCreationComputer(target);
							setBoundAgentId("");
							setAgentBindingValue("");
							setErrorState(null);
						}}
					/>
				</div>
			) : undefined,
		additionalHumanProfileCreationEnabled,
		additionalSubmitBlockReason,
		additionalSubmitBlockSection: resolveSubmitBlockSection({
			ownerSubmitBlockReason,
			sessionPresetBindingBlockReason,
			sessionMode,
			sessionPreset,
		}),
		agentBindingChoices: resolveOwnerBindingChoices({
			ownerMode,
			teammateBindingChoices,
		}),
		agentBindingValue: resolveOwnerBindingValue({
			agentBindingValue,
			boundAgentId,
			ownerMode,
		}),
		agentOwnershipSlot: ownerChoice,
		agentOwnerAvatar: {
			userId: agentOwnerUserId,
			imageUrl:
				organizationDirectoryQuery.data?.members.find(
					(member) => member.userId === agentOwnerUserId
				)?.user.image ?? null,
		},
		agentOwnershipSummary: resolveAgentOwnershipSummary({
			ownerMode,
			targetOwnerName,
		}),
		connectionConfirmation: (
			<SharedConversationConfirmation
				onCancel={() => {
					setSharedConnectionKey(null);
					submissionInFlightRef.current = false;
				}}
				onConnect={() => {
					if (sharedConnectionKey) {
						createProfileMutation.mutate({
							idempotencyKey: sharedConnectionKey,
						});
						setSharedConnectionKey(null);
					}
				}}
				open={sharedConnectionKey !== null}
			/>
		),
		agentSessionSlot: (
			<SharedConversationFields
				enabled={sharedConversation}
				fallback={sessionChoice}
				onChange={setSharedConversationId}
				value={sharedConversationId}
			/>
		),
		remoteAgentCreation: resolvePersonalRemoteAgentCreation(
			ownerMode,
			Boolean(sessionPreset),
			currentUserId,
			{
				onSubmit: (remote: {
					idempotencyKey: string;
					modelId: string | null;
					profileName: string;
					reasoningLevel: string | null;
				}) => {
					if (submissionInFlightRef.current) {
						return;
					}
					submissionInFlightRef.current = true;
					setErrorState(null);
					createProfileMutation.mutate({
						idempotencyKey: remote.idempotencyKey,
						remote,
					});
				},
			}
		),
		sharedConversationId,
		agentSessionSummary: resolveAgentSessionSummary({
			sessionMode,
			sessionPreset,
		}),
		allowProfileKindSelection: !initialSessionPreset,
		availableLocalAgentIds,
		boundAgentControllerCollaborationMode,
		boundAgentControllerPermissionMode,
		boundAgentControllerPermissionModeConfirmed: isCreationPermissionConfirmed(
			boundAgentControllerPermissionModeConfirmed,
			creationDefaultsQuery.data,
			agentControllerRef,
			boundAgentControllerPermissionMode
		),
		boundAgentId,
		boundModelId,
		boundOpenCodePermission,
		boundReasoningLevel,
		errorState,
		isResolvingAccount: profilesQuery.isPending,
		isResolvingLocalAgents,
		isSubmitting: createProfileMutation.isPending,
		localAgentEmptyState,
		localAgentSelectionState,
		localFolderPickerDeviceId: resolveOwnerLocalFolderPickerDeviceId({
			localFolderPickerDeviceId,
			ownerMode,
		}),
		lockLocalAgentSelection: isLocalAgentSelectionLocked({
			pinnedHarnessKind: input.pinnedHarnessKind,
			sessionPreset,
		}),
		modelCatalog,
		modelCompatibilityContext,
		onChangeAgentBindingValue: (value: string) => {
			journeyDraftRestorationDismissedRef.current = true;
			setAgentBindingValue(value);
			const selectedAgentId = resolveOwnerBoundAgentId({
				ownerMode,
				teammateBindingOptions,
				value,
			});
			const nextAgentId =
				ownerMode === "self" && !ownLocalAgentIds.includes(selectedAgentId)
					? ""
					: selectedAgentId;
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
			setProjectWorkspaceFallback(
				resolveOwnerProjectWorkspaceFallback(ownerMode)
			);
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
		onChangeBoundAgentControllerPermissionModeConfirmed: (
			confirmed: boolean
		) => {
			if (confirmed) {
				setBoundAgentControllerPermissionMode(
					boundAgentControllerPermissionMode
				);
			}
			setBoundAgentControllerPermissionModeConfirmed(confirmed);
		},
		onChangeBoundAgentId: (nextAgentId: string) => {
			journeyDraftRestorationDismissedRef.current = true;
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
			setProfileNameEdited(true);
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
			event.preventDefault();
			if (
				event.target !== event.currentTarget ||
				resolveCreateProfileSubmitBlockReason(formProps) !== null
			) {
				return;
			}
			handleCreateProfileSubmit({
				creationIntentRef,
				event,
				fingerprint: buildCreationFingerprint({
					agentBindingValue,
					boundAgentControllerCollaborationMode,
					boundAgentControllerPermissionMode,
					boundAgentId,
					boundModelId,
					boundOpenCodePermission,
					boundReasoningLevel,
					organizationId,
					ownerMode,
					profileKind: selectableProfileKind,
					profileName: effectiveProfileName,
					selectedHumanProfileId:
						selectedHumanProfile?.openMeldProfileId ?? null,
					selectedProjectId,
					spaceId: spaceContext?.spaceId ?? null,
					sessionPresetKey: creationSessionPresetKey(
						sharedConversation,
						sharedConversationId,
						sessionPreset
					),
					targetOwnerUserId,
				}),
				onErrorClear: () => setErrorState(null),
				onSubmit: (idempotencyKey) => {
					if (sharedConversation) {
						setSharedConnectionKey(idempotencyKey);
					} else {
						createProfileMutation.mutate({ idempotencyKey });
					}
				},
				submissionInFlightRef,
			});
		},
		profileKind: selectableProfileKind,
		profileName: effectiveProfileName,
		projectFolderPath,
		projectSelectionBlockReason,
		onUseManagedWorkspace:
			ownerMode === "self" && sessionMode === "new"
				? handleUseManagedWorkingFolder
				: undefined,
		projectSelectionSlot,
		projectSelectionSummary: resolveProjectSelectionSummary({
			projectFolderPath,
			projects: availableProjects,
			projectWorkspaceFallback,
			selectedProjectId,
		}),
		recoveryActionHref,
		...resolveCreateProfileSubmitLabels(ownerMode),
	};

	return {
		description: resolveCreateProfileDialogDescription({
			agentActivitySessionPreset: sessionPreset,
			additionalHumanProfileCreationEnabled,
			ownerMode,
			spaceContext,
			targetOwnerName,
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

function canRestoreAgentProfileCreationJourneyDraft(input: {
	creationDefaultsEdited: boolean;
	journeyDraftRestorationDismissed: boolean;
}): boolean {
	return !(
		input.creationDefaultsEdited || input.journeyDraftRestorationDismissed
	);
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

function resolveCreateProfileOwnerName(input: {
	currentUserId: string;
	directory: OrganizationDirectoryResponse | null;
	ownerMode: AgentProfileOwnerMode;
	selectedHumanProfile: AuthProfileView | null;
	targetOwnerUserId: string;
}): string | null {
	const ownerUserId =
		input.ownerMode === "teammate"
			? input.targetOwnerUserId
			: input.currentUserId;
	const directoryName = input.directory?.members.find(
		(member) => member.userId === ownerUserId
	)?.user.name;
	if (directoryName?.trim()) {
		return directoryName.trim();
	}
	if (input.ownerMode === "self") {
		return (
			input.selectedHumanProfile?.ownerName?.trim() ||
			input.selectedHumanProfile?.profileName.trim() ||
			null
		);
	}
	return null;
}

function resolveAgentOwnershipSummary(input: {
	ownerMode: AgentProfileOwnerMode;
	targetOwnerName: string | null;
}): string {
	if (input.targetOwnerName) {
		return input.targetOwnerName;
	}
	return input.ownerMode === "self" ? "You" : "Teammate";
}

function resolveAgentSessionSummary(input: {
	sessionMode: AgentProfileSessionMode;
	sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
}): string {
	if (input.sessionMode === "new") {
		return "New session";
	}
	if (input.sessionPreset?.nativeSessionTitle) {
		return input.sessionPreset.nativeSessionTitle;
	}
	return input.sessionMode === "resume" ? "Resume session" : "Fork session";
}

function resolveProjectSelectionSummary(input: {
	projectFolderPath: string;
	projects: ListProjectsResponse["projects"];
	projectWorkspaceFallback: "advanced" | "managed" | "project" | null;
	selectedProjectId: string;
}): string {
	const selectedProject = input.projects.find(
		(project) => project.id === input.selectedProjectId
	);
	if (selectedProject) {
		return selectedProject.name;
	}
	if (input.projectWorkspaceFallback === "project") {
		return "Choose a project";
	}
	if (input.projectWorkspaceFallback === "advanced") {
		if (!input.projectFolderPath.trim()) {
			return "Choose a folder";
		}
		const normalizedPath = input.projectFolderPath
			.trim()
			.replace(PROJECT_PATH_TRAILING_SEPARATOR_PATTERN, "");
		return (
			normalizedPath.split(PROJECT_PATH_SEPARATOR_PATTERN).at(-1) ??
			"Custom folder"
		);
	}
	return "OpenMeld managed";
}

function resolveAvailableProjects(
	response: ListProjectsResponse | undefined
): ListProjectsResponse["projects"] {
	return response?.projects ?? [];
}

function resolveExistingAgentProfileNames(input: {
	currentUserId: string;
	directory: OrganizationDirectoryResponse | null;
	ownerMode: AgentProfileOwnerMode;
	profiles: readonly AuthProfileView[];
	targetOwnerUserId: string;
}): string[] {
	const ownerUserId =
		input.ownerMode === "teammate"
			? input.targetOwnerUserId
			: input.currentUserId;
	const names = new Set<string>();
	for (const profile of input.directory?.agentProfiles ?? []) {
		if (profile.ownerUserId === ownerUserId && profile.profileName.trim()) {
			names.add(profile.profileName.trim());
		}
	}
	for (const profile of input.profiles) {
		if (
			profile.profileKind === "agent" &&
			profile.ownerUserId === ownerUserId &&
			profile.profileName.trim()
		) {
			names.add(profile.profileName.trim());
		}
	}
	return [...names];
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
		creationDefaultsEnabled: boolean;
		creationDefaultsPending: boolean;
		sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
	}
): string | null {
	if (input.creationDefaultsEnabled && input.creationDefaultsPending) {
		return "Loading your saved Agent settings.";
	}
	if (
		input.sessionPreset?.mode === "resume" ||
		input.sessionPreset?.mode === "fork"
	) {
		return null;
	}
	return resolveOwnerProjectSelectionBlockReason(input);
}

function isCreationPermissionConfirmed(
	confirmed: boolean,
	saved: GetAgentProfileCreationDefaultsResponse | undefined,
	controllerRef: string,
	permissionMode: AgentControllerPermissionMode
): boolean {
	return (
		confirmed ||
		(saved?.agentControllerRef === controllerRef &&
			saved.agentControllerPermissionMode === permissionMode)
	);
}

function useRestoredCreationForm(input: {
	restoredJourneyDraft: AgentProfileCreationJourneyDraft | null;
	journeyDraftRestorationDismissedRef: { current: boolean };
	creationDefaultsEditedRef: { current: boolean };
	dispatchForm: Dispatch<CreateProfileDialogFormAction>;
}) {
	useEffect(() => {
		if (!input.restoredJourneyDraft) {
			return;
		}
		// Restore into editable state so the first edit cannot reveal an empty form.
		input.journeyDraftRestorationDismissedRef.current = true;
		input.creationDefaultsEditedRef.current = true;
		input.dispatchForm({
			type: "restore_journey_draft",
			draft: input.restoredJourneyDraft,
		});
	}, [input]);
}

function useRemoteNameDraft(scope: string | null) {
	const key = scope ? `${scope}:remote-name` : null;
	const [draft, setDraft] = useState<{ key: string | null; name?: string }>({
		key: null,
	});
	useEffect(() => {
		setDraft({
			key,
			name: key ? (window.localStorage.getItem(key) ?? undefined) : undefined,
		});
	}, [key]);
	return {
		name: draft.key === key ? draft.name : undefined,
		update: (name: string) => {
			setDraft({ key, name });
			if (key) {
				window.localStorage.setItem(key, name);
			}
		},
	};
}

function useAgentProfileCreationJourneyDraft(input: {
	availableLocalAgentIds: readonly string[];
	canRestore: boolean;
	current: AgentProfileCreationJourneyDraft;
	enabled: boolean;
	key: string | null;
	modelCatalog: ModelCatalog | null;
	projects: ListProjectsResponse["projects"];
}): AgentProfileCreationJourneyDraft | null {
	const lastWrittenDraftRef = useRef<string | null>(null);
	const restoredDraft = useMemo(() => {
		if (
			!(
				typeof window !== "undefined" &&
				input.canRestore &&
				input.enabled &&
				input.key &&
				input.modelCatalog
			)
		) {
			return null;
		}
		const remembered = readAgentProfileCreationJourneyDraft({
			key: input.key,
			storage: window.localStorage,
		});
		if (
			!(
				remembered &&
				isJourneyDraftAvailable({
					availableLocalAgentIds: input.availableLocalAgentIds,
					draft: remembered,
					modelCatalog: input.modelCatalog,
					projects: input.projects,
				})
			)
		) {
			return null;
		}
		return remembered;
	}, [input]);
	useEffect(() => {
		if (!(input.enabled && input.key && input.modelCatalog)) {
			lastWrittenDraftRef.current = null;
			return;
		}
		const storage = window.localStorage;
		if (restoredDraft) {
			lastWrittenDraftRef.current = JSON.stringify(restoredDraft);
			return;
		}
		if (!input.current.agentId) {
			return;
		}
		const serializedDraft = JSON.stringify(input.current);
		if (lastWrittenDraftRef.current === serializedDraft) {
			return;
		}
		writeAgentProfileCreationJourneyDraft({
			draft: input.current,
			key: input.key,
			storage,
		});
		lastWrittenDraftRef.current = serializedDraft;
	}, [input, restoredDraft]);
	return restoredDraft;
}

function shouldUseAgentProfileCreationJourneyDraft(input: {
	hasInitialSessionPreset: boolean;
	isResolvingLocalAgents: boolean;
	modelCatalog: ModelCatalog | null;
	open: boolean;
	ownerMode: AgentProfileOwnerMode;
	projectsPending: boolean;
}): boolean {
	return (
		input.open &&
		input.ownerMode === "self" &&
		!input.hasInitialSessionPreset &&
		!input.isResolvingLocalAgents &&
		Boolean(input.modelCatalog) &&
		!input.projectsPending
	);
}

function isJourneyDraftAvailable(input: {
	availableLocalAgentIds: readonly string[];
	draft: AgentProfileCreationJourneyDraft;
	modelCatalog: ModelCatalog;
	projects: ListProjectsResponse["projects"];
}): boolean {
	if (!input.availableLocalAgentIds.includes(input.draft.agentId)) {
		return false;
	}
	const controller = input.modelCatalog.agentControllers[input.draft.agentId];
	if (!controller) {
		return false;
	}
	if (
		input.draft.modelId &&
		!controller.models.some(
			(model) => model.id === input.draft.modelId && !model.unavailable
		)
	) {
		return false;
	}
	if (
		input.draft.selectedProjectId &&
		!input.projects.some(
			(project) => project.id === input.draft.selectedProjectId
		)
	) {
		return false;
	}
	const agentControllerRef = buildBuiltinAgentControllerRef(
		input.draft.agentId
	);
	const permissionAvailable = listAgentControllerPermissionModeOptions({
		agentControllerRef,
	}).some(
		(option) => option.value === input.draft.agentControllerPermissionMode
	);
	const collaborationAvailable =
		input.draft.agentControllerCollaborationMode === null ||
		listAgentControllerCollaborationModeOptions({ agentControllerRef }).some(
			(option) => option.value === input.draft.agentControllerCollaborationMode
		);
	return permissionAvailable && collaborationAvailable;
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
	setProjectWorkspaceFallback: (
		value: "advanced" | "managed" | "project" | null
	) => void;
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
	setProjectWorkspaceFallback: (
		value: "advanced" | "managed" | "project" | null
	) => void;
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

function resolveSelectedLocalAgentSubmitBlockReason(input: {
	emptyState: AgentProfileLocalAgentEmptyState;
	localAgentSelectionState: AgentProfileLocalAgentSelectionState | null;
	ownLocalAgentIds: readonly string[];
	ownerMode: AgentProfileOwnerMode;
	selectedLocalAgentId: string;
}): string | null {
	if (input.ownerMode !== "self" || !input.selectedLocalAgentId) {
		return null;
	}
	if (input.localAgentSelectionState?.blocksCreation) {
		switch (input.localAgentSelectionState.kind) {
			case "checking":
				return `Checking ${input.localAgentSelectionState.displayName}. Wait for the check to finish.`;
			case "check_failed":
				return `Couldn’t check ${input.localAgentSelectionState.displayName}. Check again to continue.`;
			case "computer":
				return "Connect the selected computer before creating this Agent.";
			case "disabled":
				return `Turn on ${input.localAgentSelectionState.displayName} before creating this Agent.`;
			case "not_installed":
				return input.localAgentSelectionState.agentId === "grok-bot"
					? "Connect Grok Bot before creating this Agent."
					: `Install ${input.localAgentSelectionState.displayName} before creating this Agent.`;
			default:
				return `${input.localAgentSelectionState.displayName} isn’t available for Agent creation yet.`;
		}
	}
	switch (input.emptyState.kind) {
		case "checking":
			return "Checking the selected computer. Wait for the check to finish.";
		case "check_failed":
			return "Couldn't check the selected computer. Refresh and try again.";
		case "connect_computer":
			return "Connect the selected computer before creating this Agent.";
		default:
			return input.ownLocalAgentIds.includes(input.selectedLocalAgentId)
				? null
				: "Set up the selected local agent on this computer before creating this Agent.";
	}
}

function resolveLocalAgentSelectionState(input: {
	onSetupChanged: () => Promise<void>;
	bindingTarget: ReturnType<typeof resolveProfileBindingCatalogExecutionTarget>;
	computerRecovery:
		| import("./agent-creation-computer-recovery").AgentCreationComputerRecovery
		| undefined;
	creationGuidance: ReturnType<typeof resolveLocalAgentCreationGuidance>;
	isResolvingLocalAgents: boolean;
	onRetry: () => void;
	orgSlug: string | null | undefined;
	ownerMode: AgentProfileOwnerMode;
	recovery: RecoveryController;
	selectedLocalAgentId: string;
}): AgentProfileLocalAgentSelectionState | null {
	if (input.ownerMode !== "self" || !input.selectedLocalAgentId) {
		return null;
	}
	const guide = getLocalAgentInstallGuide(input.selectedLocalAgentId);
	const displayName =
		guide?.displayName ??
		formatLocalAgentDisplayName(input.selectedLocalAgentId);
	const guideHref = guide
		? buildLocalAgentGuideDetailPath(guide.agentId)
		: undefined;
	const base = {
		agentId: input.selectedLocalAgentId,
		...resolveConnectionSetup(input),
		displayName,
		guideHref,
		onRetry: input.onRetry,
		selectionKey: [
			input.bindingTarget?.deviceId ?? input.recovery.deviceId ?? "no-device",
			input.bindingTarget?.runtimeLane ??
				input.recovery.runtimeLane ??
				"no-lane",
			input.selectedLocalAgentId,
		].join(":"),
	};
	if (
		input.computerRecovery &&
		input.computerRecovery.state !== "local_agents"
	) {
		return {
			...base,
			blocksCreation: true,
			kind:
				input.computerRecovery.state === "checking" ||
				input.computerRecovery.state === "check_failed"
					? input.computerRecovery.state
					: "computer",
		};
	}
	if (!input.bindingTarget) {
		return {
			...base,
			blocksCreation: true,
			kind:
				input.computerRecovery?.state === "local_agents" ||
				input.isResolvingLocalAgents
					? "checking"
					: "computer",
		};
	}
	return resolveLocalAgentSelectionStateForTarget({
		base,
		creationGuidance: input.creationGuidance,
		isResolvingLocalAgents: input.isResolvingLocalAgents,
		orgSlug: input.orgSlug,
		recovery: input.recovery,
		target: input.bindingTarget,
	});
}

function resolveConnectionSetup(input: {
	onSetupChanged: () => Promise<void>;
	selectedLocalAgentId: string;
	bindingTarget: ReturnType<typeof resolveProfileBindingCatalogExecutionTarget>;
	recovery: RecoveryController;
}) {
	if (
		input.selectedLocalAgentId !== "grok-bot" ||
		!input.bindingTarget?.localAgentControl.setupInstallations
	) {
		return {};
	}
	return {
		connectionSetup: {
			onChanged: input.onSetupChanged,
			target: {
				deviceId: input.bindingTarget.deviceId,
				runtimeLane: input.bindingTarget.runtimeLane,
			},
			storageScope: input.recovery.storageScope,
		},
	};
}

function requiresConnectionSignIn(agentId: string, status: string | undefined) {
	return (
		status === "unauthenticated" ||
		(agentId === "grok-bot" && status !== "authenticated")
	);
}

function resolveLocalAgentSelectionStateForTarget(input: {
	base: Pick<
		AgentProfileLocalAgentSelectionState,
		| "agentId"
		| "displayName"
		| "guideHref"
		| "onRetry"
		| "selectionKey"
		| "connectionSetup"
	>;
	creationGuidance: ReturnType<typeof resolveLocalAgentCreationGuidance>;
	isResolvingLocalAgents: boolean;
	orgSlug: string | null | undefined;
	recovery: RecoveryController;
	target: NonNullable<
		ReturnType<typeof resolveProfileBindingCatalogExecutionTarget>
	>;
}): AgentProfileLocalAgentSelectionState {
	const { base, target } = input;
	const entry = target.localAgentCatalog.entries.find(
		(candidate) => candidate.agentId === base.agentId
	);
	if (!entry) {
		return {
			...base,
			blocksCreation: true,
			kind: input.isResolvingLocalAgents ? "checking" : "check_failed",
		};
	}
	const agentControllerRef = buildBuiltinAgentControllerRef(base.agentId);
	const capability = target.capabilities.find(
		(candidate) => candidate.agentControllerRef === agentControllerRef
	);
	const snapshot = capability?.agentControllerInterface;
	const manageHref = input.orgSlug
		? buildOrganizationComputerPath({
				deviceId: target.deviceId,
				orgSlug: input.orgSlug,
			})
		: null;
	const bindable = bindableLocalAgentIdsFromTarget(target).includes(
		base.agentId
	);
	const usage = {
		usageLimits: snapshot?.usageLimits,
		usageLoading: Boolean(
			!snapshot && input.recovery.localRuntimesQuery.isPending
		),
	};
	if (!entry.detected) {
		return {
			...base,
			...usage,
			blocksCreation: true,
			kind: "not_installed",
			manageHref,
		};
	}
	if (!entry.enabled || entry.lifecycleStatus === "suspended") {
		return {
			...base,
			...usage,
			blocksCreation: true,
			canEnable: target.localAgentControl.setEnabled,
			kind: "disabled",
			manageHref,
			onEnable: () =>
				enableLocalAgentWithOutcomeConfirmation({
					agentId: base.agentId,
					recovery: input.recovery,
					target,
				}),
		};
	}
	if (!bindable) {
		return {
			...base,
			...usage,
			blocksCreation: true,
			kind:
				input.creationGuidance === "check_failed" ||
				snapshot?.check?.status === "failed"
					? "check_failed"
					: "unavailable",
			manageHref,
			message: snapshot?.message,
		};
	}
	if (requiresConnectionSignIn(base.agentId, snapshot?.auth?.status)) {
		return {
			...base,
			...usage,
			blocksCreation: base.agentId === "grok-bot",
			kind: "signed_out",
			manageHref,
		};
	}
	if (
		snapshot?.check?.status === "failed" ||
		entry.launchStatus === "needs_repair" ||
		snapshot?.status === "error" ||
		snapshot?.status === "unavailable"
	) {
		return {
			...base,
			...usage,
			blocksCreation: false,
			kind:
				snapshot?.check?.status === "failed" ? "check_failed" : "unavailable",
			manageHref,
			message:
				snapshot?.message ??
				`${base.displayName} needs attention before it can run.`,
		};
	}
	return {
		...base,
		...usage,
		blocksCreation: false,
		kind: "available",
		manageHref,
	};
}

async function enableLocalAgentWithOutcomeConfirmation(input: {
	agentId: string;
	recovery: RecoveryController;
	target: PeopleComputerTarget;
}): Promise<void> {
	try {
		await input.recovery.setLocalAgentEnabled({
			agentId: input.agentId,
			deviceId: input.target.deviceId,
			enabled: true,
			runtimeLane: input.target.runtimeLane,
		});
		return;
	} catch (error) {
		if (!isLocalAgentControlStillRunningError(error)) {
			throw error;
		}
		for (const delayMs of LOCAL_AGENT_ENABLE_CONFIRMATION_DELAYS_MS) {
			if (delayMs > 0) {
				await new Promise<void>((resolve) => {
					setTimeout(resolve, delayMs);
				});
			}
			const refreshed = await input.recovery.localRuntimesQuery
				.refetch()
				.catch(() => null);
			const refreshedTarget = refreshed?.data?.localRuntimes
				.flatMap((computer) => computer.executionTargets)
				.find(
					(candidate) =>
						candidate.deviceId === input.target.deviceId &&
						candidate.runtimeLane === input.target.runtimeLane
				);
			const enabled = refreshedTarget?.localAgentCatalog.entries.some(
				(candidate) =>
					candidate.agentId === input.agentId &&
					candidate.enabled &&
					candidate.lifecycleStatus !== "suspended"
			);
			if (enabled) {
				return;
			}
		}
		throw error;
	}
}

type CreateProfileSubmissionInput = {
	sharedConversation?: { conversationId: string; acknowledged: true };
	agentControllerConversationId: string | null;
	agentControllerCollaborationMode: AgentControllerCollaborationMode | null;
	agentControllerPermissionMode: AgentControllerPermissionMode | null;
	agentControllerRef: string;
	bindingTarget: ReturnType<typeof resolveProfileBindingCatalogExecutionTarget>;
	boundAgentId: string;
	boundModelId: string;
	boundOpenCodePermission: AgentProfileBindingOpenCodePermission | null;
	boundReasoningLevel: string;
	currentUserId: string;
	idempotencyKey: string;
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	onAgentRequestAccepted?: (
		request: AgentProfileCreationRequest,
		optimisticId: string
	) => void | Promise<void>;
	onAgentRequestFailed?: (creation: OptimisticAgentProfileCreation) => void;
	onAgentRequestStarted?: (creation: OptimisticAgentProfileCreation) => void;
	waitForAgentRequestCompletion?: boolean;
	intentStorageScope?: string;
	clearIntentOnAcceptance?: boolean;
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
	if (
		input.profileKind === "agent" ||
		input.ownerMode === "teammate" ||
		input.sessionStrategy === "fork"
	) {
		return await requestAgentProfile(input);
	}
	return await createHumanProfile(input);
}

async function handleProfileCreationSuccess(input: {
	manageAgentCreationCachesExternally?: boolean;
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	onAgentRequestCreated?: (
		request: AgentProfileCreationRequest,
		customWorkingFolderIssue: string | null
	) => void | Promise<void>;
	onClose: () => void;
	onProfileCreated?: (profile: AuthProfileView) => void | Promise<void>;
	onReset: () => void;
	organizationId: string;
	queryClient: QueryClient;
	result: Awaited<ReturnType<typeof submitProfileCreation>>;
	spaceContext: CreateProfileSpaceContext | undefined;
	storageScope: string;
}) {
	if (input.result.kind === "request") {
		showCreatedAgentRequestToast({
			customWorkingFolderIssue: input.result.customWorkingFolderIssue,
			request: input.result.request,
		});
		// Creation is committed. Mark caches stale immediately, but don't hold
		// navigation or the submit state hostage to background network reads.
		if (!input.manageAgentCreationCachesExternally) {
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
		}
		await Promise.resolve(
			input.onAgentRequestCreated?.(
				input.result.request,
				input.result.customWorkingFolderIssue
			)
		).catch((error) => {
			console.warn(
				"OpenMeld created the Agent but could not open its current profile.",
				error
			);
		});
		if (
			input.result.customWorkingFolderIssue &&
			!input.result.request.createdAgentProfileId
		) {
			return;
		}
		if (input.result.request.status === "completed") {
			input.onReset();
		}
		input.onClose();
		return;
	}
	showCreatedProfileToast({
		creationDefaultsUpdateFailed: input.result.creationDefaultsUpdateFailed,
		followUpIssues: input.result.creationOutcome.followUpIssues,
		profile: input.result.profile,
		spaceContext: input.spaceContext,
	});
	await Promise.resolve(input.onProfileCreated?.(input.result.profile)).catch(
		(error) => {
			console.warn(
				"OpenMeld created the profile but could not open its current details.",
				error
			);
		}
	);
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
			...organizationDirectoryQueryFilters({
				organizationId: input.organizationId,
			}),
			refetchType: "active",
		}),
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
			// Core assigned the new Profile to its Harness's Agent when it
			// accepted the Binding.
			input.queryClient.invalidateQueries({
				queryKey: memberAgentQueryKeys.all(input.organizationId),
				exact: true,
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
	}
	await Promise.all(refreshes);
}

async function requestAgentProfile(input: CreateProfileSubmissionInput) {
	const defaultProjectId = input.selectedProjectId || null;
	const customWorkspacePath =
		input.waitForAgentRequestCompletion === false &&
		input.ownerMode === "self" &&
		input.boundAgentId &&
		!defaultProjectId &&
		input.projectFolderPath.trim()
			? input.projectFolderPath
			: null;
	const connection = resolveRequestedAgentConnection(input);
	if (!(connection.agentControllerRef && connection.targetComputerId)) {
		throw new Error(
			"Choose a local agent on a connected computer to continue."
		);
	}
	const result = await createAgentProfileCreationRequest({
		queryClient: input.queryClient,
		configuration: {
			sharedConversation: input.sharedConversation,
			agentControllerCollaborationMode: input.sharedConversation
				? null
				: input.agentControllerCollaborationMode,
			agentControllerPermissionMode: input.sharedConversation
				? null
				: input.agentControllerPermissionMode,
			agentControllerRef: connection.agentControllerRef,
			localAgentConnectionCandidateId:
				connection.localAgentConnectionCandidateId,
			authorizeForOrganization: true,
			defaultProjectId: input.sharedConversation ? null : defaultProjectId,
			modelId:
				!input.sharedConversation && input.boundAgentId && input.boundModelId
					? input.boundModelId
					: null,
			openCodePermission:
				input.boundAgentId && isOpenCodeAgentId(input.boundAgentId)
					? input.boundOpenCodePermission
					: null,
			reasoningLevel:
				!input.sharedConversation &&
				input.boundAgentId &&
				input.boundReasoningLevel
					? input.boundReasoningLevel
					: null,
			targetComputerId: connection.targetComputerId,
		},
		idempotencyKey: input.idempotencyKey,
		intentStorageScope: input.intentStorageScope,
		clearIntentOnAcceptance: input.clearIntentOnAcceptance,
		nativeSessionId:
			input.sessionStrategy === "new"
				? null
				: (input.sessionPreset?.nativeSessionId ?? null),
		organizationId: input.organizationId,
		onAccepted: input.onAgentRequestAccepted,
		onFailed: input.onAgentRequestFailed,
		onStarted:
			customWorkspacePath && input.intentStorageScope
				? (creation) => {
						const intent = readAgentCreationIntent(
							input.intentStorageScope ?? "",
							input.organizationId
						);
						if (intent) {
							rememberAgentCreationIntent({
								...intent,
								customWorkspacePath,
								organizationId: input.organizationId,
								scope: input.intentStorageScope ?? "",
							});
						}
						input.onAgentRequestStarted?.(creation);
					}
				: input.onAgentRequestStarted,
		profileName: input.profileName,
		requestedSpaceId: input.spaceContext?.spaceId ?? null,
		waitForCompletion: input.waitForAgentRequestCompletion,
		sessionStrategy: input.sessionStrategy,
		targetOwnerUserId: resolveRequestedAgentOwnerUserId(input),
	});
	const customWorkingFolderIssue =
		await configureRequestedAgentCustomWorkingFolder({
			defaultProjectId,
			deferUntilCommitted: input.waitForAgentRequestCompletion === false,
			request: result.request,
			submission: input,
		});
	return {
		customWorkingFolderIssue,
		kind: "request" as const,
		request: result.request,
	};
}

function canChooseCreationComputer(
	ownerMode: string,
	sessionPreset: CreateProfileAgentActivitySessionPreset | undefined
) {
	// A Session already fixes its computer; teammate choices belong to the
	// owner's candidate list rather than this user's Computer picker.
	return ownerMode === "self" && !sessionPreset;
}

function useCreationComputerReadiness(input: {
	bindingTarget: ReturnType<typeof resolveProfileBindingCatalogExecutionTarget>;
	enabled: boolean;
	recovery: RecoveryController;
}) {
	const target = input.bindingTarget;
	const needsSelectedRead = Boolean(
		target &&
			(target.deviceId !== input.recovery.deviceId ||
				target.runtimeLane !== input.recovery.runtimeLane)
	);
	const selectedRead = useQuery(
		currentLocalRuntimeReplyReadinessQueryOptions({
			enabled: input.enabled && needsSelectedRead,
			storageScope: input.recovery.storageScope,
			target: target
				? { deviceId: target.deviceId, runtimeLane: target.runtimeLane }
				: null,
		})
	);
	const readinessQuery = needsSelectedRead
		? selectedRead
		: input.recovery.currentLocalRuntimeReplyReadinessQuery;
	return {
		data: readinessQuery.data,
		isPending:
			input.recovery.localRuntimesQuery.isPending ||
			(Boolean(target) && readinessQuery.isPending),
		refetch: readinessQuery.refetch,
		isError:
			input.recovery.localRuntimesQuery.isError || readinessQuery.isError,
	};
}

function useOnlyCreationComputer(input: {
	choices: ReturnType<typeof resolveCreationComputerChoices>["choices"];
	enabled: boolean;
	canChooseComputer: boolean;
	isSubmitting: boolean;
	recovery: RecoveryController;
	onSelect: RecoveryController["selectComputer"];
}) {
	useEffect(() => {
		const target = input.choices.length === 1 ? input.choices[0]?.target : null;
		if (
			!(input.enabled && input.canChooseComputer) ||
			input.isSubmitting ||
			!(
				input.recovery.deviceId ||
				input.recovery.currentDeviceTargetQuery.isSuccess
			) ||
			!target
		) {
			return;
		}
		// Preserve the selected physical computer. A reconnect can replace its
		// legacy device ID; use its sole current session, never another computer.
		if (
			input.recovery.localRuntimesQuery.data?.peopleComputers.computers.some(
				(computer) =>
					computer.identityStatus === "enrolled" &&
					(computer.deviceId === input.recovery.deviceId ||
						computer.legacyDeviceIds?.includes(
							input.recovery.deviceId ?? ""
						)) &&
					computer.deviceId !== target.deviceId &&
					!computer.legacyDeviceIds?.includes(target.deviceId)
			)
		) {
			return;
		}
		if (
			target.deviceId === input.recovery.deviceId &&
			target.runtimeLane === input.recovery.runtimeLane
		) {
			return;
		}
		input.onSelect(target);
	}, [input]);
}

function CreationComputerSelector(input: {
	choices: ReturnType<typeof resolveCreationComputerChoices>["choices"];
	selectedChoice: ReturnType<
		typeof resolveCreationComputerChoices
	>["selectedChoice"];
	disabled: boolean;
	onSelect: RecoveryController["selectComputer"];
}) {
	if (
		input.choices.length === 0 ||
		(input.choices.length === 1 && input.selectedChoice)
	) {
		return null;
	}
	return (
		<>
			<p>Computer</p>
			<Select
				disabled={input.disabled}
				onValueChange={(value) => {
					const choice = input.choices.find((entry) => entry.value === value);
					if (choice?.target) {
						input.onSelect(choice.target);
					}
				}}
				value={input.selectedChoice?.value ?? ""}
			>
				<SelectTrigger
					aria-label="Computer"
					displayValue={input.selectedChoice?.label}
					placeholder="Choose a computer"
				/>
				<SelectContent>
					{input.choices.map((choice, index) => (
						<SelectItem
							disabled={!choice.target}
							index={index}
							key={choice.value}
							value={choice.value}
						>
							{choice.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</>
	);
}

function AdvancedCreationConnectionSelector(input: {
	choices: ReturnType<
		typeof resolveCreationComputerChoices
	>["connectionChoices"];
	disabled: boolean;
	onSelect: RecoveryController["selectComputer"];
}) {
	if (input.choices.length === 0) {
		return null;
	}
	return (
		<details className="rounded-md border p-3">
			<summary className="cursor-pointer text-muted-foreground">
				Advanced connection selection
			</summary>
			<p className="my-2 text-muted-foreground text-xs">
				Multiple Service connections were found on a computer. Choose the
				connection this Agent should use.
			</p>
			<Select
				disabled={input.disabled}
				onValueChange={(value) => {
					const choice = input.choices.find((entry) => entry.value === value);
					if (choice) {
						input.onSelect(choice.target);
					}
				}}
				value=""
			>
				<SelectTrigger
					aria-label="Service connection"
					placeholder="Choose a connection"
				/>
				<SelectContent>
					{input.choices.map((choice, index) => (
						<SelectItem index={index} key={choice.value} value={choice.value}>
							{choice.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</details>
	);
}

function availableCreationComputerSessions(computer: PeopleComputer) {
	if (
		computer.connection.status !== "connected" ||
		computer.connection.reasonCodes.includes("daemon.session.reject_conflict")
	) {
		return [];
	}
	return computer.connection.sessions.filter(
		(session) =>
			session.executionCompatibility.status === "compatible" &&
			!session.serviceUpdate.wakeBlocked
	);
}

function resolveCreationComputerChoices(recovery: RecoveryController) {
	const computers =
		recovery.localRuntimesQuery.data?.peopleComputers.computers ?? [];
	const connectionChoices: {
		value: string;
		label: string;
		target: Parameters<RecoveryController["selectComputer"]>[0];
	}[] = [];
	const choices = computers.flatMap((computer) => {
		const sessions = availableCreationComputerSessions(computer);
		if (sessions.length === 0) {
			return [];
		}
		const targets = new Map(
			sessions.map((target) => [
				JSON.stringify({
					deviceId: target.deviceId,
					runtimeLane: target.runtimeLane,
				}),
				target,
			])
		);
		const selected = [...targets.values()].find(
			(target) =>
				target.deviceId === recovery.deviceId &&
				target.runtimeLane === recovery.runtimeLane
		);
		let target = selected;
		if (!target && targets.size === 1) {
			target = [...targets.values()][0];
		}
		if (!target) {
			for (const [value, connection] of targets) {
				connectionChoices.push({
					value,
					target: {
						deviceId: connection.deviceId,
						runtimeLane: connection.runtimeLane,
					},
					label: `${computer.deviceDisplayName} · ${connection.runtimeLane} · ${connection.deviceId.slice(-6)} · Connected`,
				});
			}
		}
		const sameName =
			computers.filter(
				(entry) => entry.deviceDisplayName === computer.deviceDisplayName
			).length > 1;
		return [
			{
				value: computer.deviceId,
				target: target
					? { deviceId: target.deviceId, runtimeLane: target.runtimeLane }
					: null,
				label: `${computer.deviceDisplayName}${sameName ? ` · ${computer.deviceId.slice(-6)}` : ""} · Connected`,
			},
		];
	});
	return {
		choices,
		connectionChoices,
		selectedChoice: choices.find(
			(choice) =>
				choice.target?.deviceId === recovery.deviceId &&
				choice.target.runtimeLane === recovery.runtimeLane
		),
	};
}

function resolveRequestedAgentConnection(input: CreateProfileSubmissionInput): {
	agentControllerRef: string | null;
	localAgentConnectionCandidateId: string | null;
	targetComputerId: string | null;
} {
	const agentControllerRef =
		input.ownerMode === "self"
			? input.agentControllerRef || null
			: (input.selectedTeammateBinding?.agentControllerRef ?? null);
	if (!agentControllerRef) {
		return {
			agentControllerRef: null,
			localAgentConnectionCandidateId: null,
			targetComputerId: null,
		};
	}
	const targetComputerId =
		input.ownerMode === "self"
			? input.profileCreationExecutionTarget.deviceId
			: (input.selectedTeammateBinding?.targetComputerId ?? null);
	let localAgentConnectionCandidateId: string | null = null;
	if (input.ownerMode === "self") {
		const selection = input.profileCreationExecutionTarget;
		const target = input.recovery.localRuntimesQuery.data?.localRuntimes
			.flatMap((computer) => computer.executionTargets)
			.find(
				(item) =>
					item.deviceId === selection.deviceId &&
					item.runtimeLane === selection.runtimeLane
			);
		if (!target?.openMeldServiceRuntimeId) {
			throw new Error(
				"The selected computer's local agents are no longer available. Refresh and try again."
			);
		}
		localAgentConnectionCandidateId = buildLocalAgentConnectionCandidateId({
			agentControllerRef,
			deviceId: target.deviceId,
			runtimeLane: target.runtimeLane,
			openMeldServiceRuntimeId: target.openMeldServiceRuntimeId.value,
		});
	}
	return {
		agentControllerRef,
		localAgentConnectionCandidateId,
		targetComputerId,
	};
}

function resolveRequestedAgentOwnerUserId(
	input: CreateProfileSubmissionInput
): string {
	if (input.ownerMode === "teammate") {
		return input.targetOwnerUserId;
	}
	return (
		input.sessionPreset?.ownerUserId ||
		input.currentUserId.trim() ||
		input.selectedHumanProfile?.ownerUserId ||
		""
	);
}

async function configureRequestedAgentCustomWorkingFolder(input: {
	defaultProjectId: string | null;
	deferUntilCommitted?: boolean;
	request: AgentProfileCreationRequest;
	submission: CreateProfileSubmissionInput;
}): Promise<string | null> {
	if (
		input.submission.ownerMode === "self" &&
		input.submission.boundAgentId &&
		!input.defaultProjectId &&
		input.submission.projectFolderPath.trim()
	) {
		const pendingSetup = {
			agentProfileId: input.request.createdAgentProfileId ?? null,
			workspacePath: input.submission.projectFolderPath,
		};
		const remembered = rememberPendingAgentProfileCreationLocalSetup({
			...pendingSetup,
			organizationId: input.submission.organizationId,
			requestId: input.request.id,
			storageScope: input.submission.recovery.storageScope,
		});
		if (input.deferUntilCommitted) {
			return remembered
				? null
				: "OpenMeld couldn't keep your custom working folder for retry. Keep this window open and try again.";
		}
		const continuation = await continuePendingAgentProfileCreationLocalSetup({
			organizationId: input.submission.organizationId,
			pendingSetup,
			request: input.request,
			selectedHumanProfileId:
				input.submission.selectedHumanProfile?.openMeldProfileId ?? null,
			storageScope: input.submission.recovery.storageScope,
		});
		if (continuation.failureMessage) {
			return continuation.failureMessage;
		}
		if (continuation.pending && !remembered) {
			return "OpenMeld couldn't keep your custom working folder for retry. Keep this window open and try again.";
		}
	}
	return null;
}

async function createHumanProfile(input: CreateProfileSubmissionInput) {
	const creationOutcome = await createProfileWithFollowUps({
		agentControllerConversationId: null,
		boundAgentId: "",
		currentServiceCanSetProfileWorkspace: false,
		defaultProjectId: null,
		deviceId: null,
		idempotencyKey: input.idempotencyKey,
		modelId: null,
		onAfterJoin: input.onAfterJoin,
		openCodePermission: null,
		organizationId: input.organizationId || null,
		profileKind: input.profileKind,
		profileName: input.profileName,
		projectFolderPath: null,
		queryClient: input.queryClient,
		reasoningLevel: null,
		runtimeLane: null,
		selectedHumanProfile: input.selectedHumanProfile,
		selectedHumanProfileId:
			input.selectedHumanProfile?.openMeldProfileId ?? null,
		spaceContext: input.spaceContext,
	});
	const { profile } = creationOutcome;
	refreshCreatedProfileCaches({
		boundAgentId: "",
		createdProfile: profile,
		onAfterJoin: input.onAfterJoin,
		organizationId: input.organizationId,
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
		creationDefaultsUpdateFailed: false,
		creationOutcome,
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

function renderProjectSelectionSlot(input: {
	target?: PeopleComputerTarget;
	onUseManagedWorkingFolder: () => void;
	creationDefaultsEditedRef: { current: boolean };
	disabled: boolean;
	onErrorClear: () => void;
	organizationId: string;
	ownerMode: AgentProfileOwnerMode;
	projectFolderPath: string;
	projects: ListProjectsResponse | undefined;
	projectsError: boolean;
	projectsPending: boolean;
	projectWorkspaceFallback: "advanced" | "managed" | "project" | null;
	selectedProjectBindingGeneration: string | null;
	selectedProjectId: string;
	setProjectFolderPath: (value: string) => void;
	setProjectWorkspaceFallback: (
		value: "advanced" | "managed" | "project" | null
	) => void;
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
				if (!connection) {
					input.setSelectedProjectBindingGeneration(null);
					return;
				}
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
			onUseManagedWorkspace={input.onUseManagedWorkingFolder}
			onUseProjectWorkspace={() => input.setProjectWorkspaceFallback("project")}
			organizationId={input.organizationId}
			projectId={input.selectedProjectId}
			projects={input.projects?.projects ?? []}
			selectedBindingGeneration={input.selectedProjectBindingGeneration}
			target={input.target}
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
	return [...input.options.map((option) => option.choice)];
}

function resolveCreateProfileOwnerChoice(input: {
	hasInitialSessionPreset: boolean;
	render: () => ReactNode;
}): ReactNode {
	return input.hasInitialSessionPreset ? null : input.render();
}

function resolveOwnerBindingChoices(input: {
	ownerMode: AgentProfileOwnerMode;
	teammateBindingChoices: readonly AgentProfileBindingChoice[] | undefined;
}): readonly AgentProfileBindingChoice[] | undefined {
	return input.ownerMode === "teammate"
		? input.teammateBindingChoices
		: undefined;
}

function resolveOwnerBindingValue(input: {
	agentBindingValue: string;
	boundAgentId: string;
	ownerMode: AgentProfileOwnerMode;
}): string {
	return input.ownerMode === "self"
		? input.agentBindingValue || input.boundAgentId
		: input.agentBindingValue;
}

function resolveOwnerLocalFolderPickerDeviceId(input: {
	localFolderPickerDeviceId: string | null;
	ownerMode: AgentProfileOwnerMode;
}): string | null {
	return input.ownerMode === "self" ? input.localFolderPickerDeviceId : null;
}

function filterPinnedHarnessAgentIds(
	agentIds: readonly string[],
	pinnedHarnessKind: string | undefined
): string[] {
	return agentIds.filter(
		(agentId) => !pinnedHarnessKind || agentId === pinnedHarnessKind
	);
}

function isLocalAgentSelectionLocked(input: {
	pinnedHarnessKind: string | undefined;
	sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
}): boolean {
	return Boolean(input.sessionPreset) || Boolean(input.pinnedHarnessKind);
}

function resolveOwnerBoundAgentId(input: {
	ownerMode: AgentProfileOwnerMode;
	teammateBindingOptions: readonly TeammateBindingOption[];
	value: string;
}): string {
	if (input.ownerMode !== "teammate") {
		return input.value;
	}
	return (
		input.teammateBindingOptions.find(
			(option) => option.choice.value === input.value
		)?.agentId ?? ""
	);
}

function resolveOwnerProjectWorkspaceFallback(
	ownerMode: AgentProfileOwnerMode
): "managed" | null {
	return ownerMode === "self" ? "managed" : null;
}

function resolveCreateProfileSubmitLabels(
	ownerMode: AgentProfileOwnerMode
): Pick<
	ComponentProps<typeof CreateProfileForm>,
	"submitLabel" | "submittingLabel"
> {
	if (ownerMode === "teammate") {
		return {
			submitLabel: "Request Agent",
			submittingLabel: "Requesting Agent…",
		};
	}
	return {
		submitLabel: undefined,
		submittingLabel: undefined,
	};
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
	hasInitialSessionPreset: boolean;
	initialOwnerMode: AgentProfileOwnerMode;
}): boolean {
	const initialSessionAllowsTeammateRequest =
		!input.hasInitialSessionPreset || input.initialOwnerMode === "teammate";
	return (
		initialSessionAllowsTeammateRequest &&
		TEAMMATE_AGENT_REQUESTS_ENABLED &&
		input.allowTeammateRequests === true &&
		Boolean(input.currentUserId)
	);
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

function resolveAgentControllerRef(boundAgentId: string): string {
	return boundAgentId ? buildBuiltinAgentControllerRef(boundAgentId) : "";
}

function resolveLocalAgentEmptyState(input: {
	centerAgentHref: string | null;
	computerHref: string | null;
	guidance: ReturnType<typeof resolveLocalAgentCreationGuidance>;
	onRetry: () => void;
	ownerMode: AgentProfileOwnerMode;
	recoveryActionHref: string;
}): AgentProfileLocalAgentEmptyState {
	if (input.ownerMode === "teammate") {
		return {
			centerAgentHref: input.centerAgentHref,
			kind: "teammate_local_agents_unavailable",
			primaryActionHref: null,
		};
	}
	if (input.guidance === "check_failed" || input.guidance === "checking") {
		return {
			kind: input.guidance,
			centerAgentHref: input.centerAgentHref,
			primaryActionHref: null,
			onRetry: input.onRetry,
		};
	}
	if (input.guidance === "set_up_local_agents") {
		return {
			centerAgentHref: input.centerAgentHref,
			kind: "set_up_local_agents",
			primaryActionHref: input.computerHref,
		};
	}
	return {
		centerAgentHref: input.centerAgentHref,
		kind: "connect_computer",
		primaryActionHref: input.recoveryActionHref,
	};
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
	projectWorkspaceFallback: "advanced" | "managed" | "project" | null;
	selectedProjectBindingGeneration: string | null;
	selectedProjectId: string;
}): string | null {
	if (input.ownerMode !== "self") {
		return null;
	}
	if (
		input.boundAgentId &&
		input.projectsPending &&
		input.projectWorkspaceFallback !== "managed"
	) {
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
		: "Create an Agent";
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
				controller?.kind !== "builtin" ||
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
		agentControllerRef,
		authType:
			snapshot?.auth.status === "authenticated" ? snapshot.auth.type : null,
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

function showCreatedAgentRequestToast(input: {
	customWorkingFolderIssue: string | null;
	request: AgentProfileCreationRequest;
}): void {
	if (input.customWorkingFolderIssue) {
		if (input.request.createdAgentProfileId) {
			toast.warning(
				`${input.request.profileName} was created, but working folder setup isn't complete. ${input.customWorkingFolderIssue} Open the Agent to finish setup.`
			);
		} else {
			toast.error(input.customWorkingFolderIssue);
		}
		return;
	}
	switch (input.request.status) {
		case "completed":
			toast.success(
				input.request.requesterUserId === input.request.targetOwnerUserId
					? "Agent created."
					: "Agent created for your teammate."
			);
			return;
		case "declined":
			toast.error("This teammate doesn't allow Agent creation requests.");
			return;
		case "failed":
			if (input.request.createdAgentProfileId) {
				toast.warning(
					"Your Agent was created, but setup needs attention. Open Creation history to review the issue and retry setup."
				);
				return;
			}
			toast.error("OpenMeld couldn't create this Agent.");
			return;
		case "approved":
			toast.info(
				input.request.createdAgentProfileId
					? "Agent created. Finishing setup in the background."
					: "Creating Agent. You can check progress in Creation history."
			);
			return;
		default:
			toast.success("Request sent.");
	}
}

function resolveProjectSelectionBlockReason(input: {
	boundAgentId: string;
	projectFolderPath: string;
	projectWorkspaceFallback: "advanced" | "managed" | "project" | null;
	selectedProjectBindingGeneration: string | null;
	selectedProjectId: string;
}): string | null {
	if (!input.boundAgentId) {
		return null;
	}
	if (
		input.projectWorkspaceFallback === "project" &&
		!input.selectedProjectId
	) {
		return "Choose a project to continue.";
	}
	if (
		input.projectWorkspaceFallback === "advanced" &&
		!input.projectFolderPath.trim()
	) {
		return "Choose a folder to continue.";
	}
	if (!input.selectedProjectId) {
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
	return "This Project's folder is not connected. Let OpenMeld choose a folder, or change it in Advanced Agent Settings.";
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

function showCreatedProfileToast(input: {
	creationDefaultsUpdateFailed: boolean;
	followUpIssues: CreatedProfileFollowUpIssue[];
	profile: AuthProfileView;
	spaceContext: CreateProfileSpaceContext | undefined;
}) {
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
			`${input.profile.profileName} was created, but OpenMeld couldn't add it to ${input.spaceContext?.spaceName ?? "the Space"}. Add the existing profile from the Members panel.${localSetupSentence}`
		);
		return;
	}
	if (localSetupIssue) {
		toast.warning(
			`${input.profile.profileName} was created${input.spaceContext ? ` and added to ${input.spaceContext.spaceName ?? "this Space"}` : ""}, but local setup isn't complete. ${localSetupIssue.message}`
		);
		return;
	}
	if (input.creationDefaultsUpdateFailed) {
		toast.warning(
			`${input.profile.profileName} was created, but OpenMeld couldn't remember these setup choices for next time.`
		);
		return;
	}

	toast.success(
		input.spaceContext
			? `${input.profile.profileName} was created and added to ${input.spaceContext.spaceName ?? "this Space"}.`
			: `${input.profile.profileName} was created.`
	);
}

function buildBuiltinAgentControllerRef(agentId: string): string {
	return `builtin:${agentId}`;
}

async function refreshCreatedProfileCaches(input: {
	boundAgentId: string;
	createdProfile: AuthProfileView;
	onAfterJoin?: (profile: SpaceJoinedProfileReference) => void | Promise<void>;
	organizationId: string;
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
			await Promise.all([
				input.queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.directory(input.organizationId),
					refetchType: "active",
				}),
				input.queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.profileDirectory(
						input.organizationId
					),
					refetchType: "active",
				}),
			]);
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

async function refreshCreatedAgentProfileLocalState(input: {
	createdProfile: AuthProfileView;
	organizationId: string;
	queryClient: QueryClient;
	recovery: RecoveryController;
}) {
	const results = await Promise.allSettled([
		refreshWebAgentReadinessFacts({
			agentProfileIds: [input.createdProfile.openMeldProfileId],
			maxAttempts: 3,
			organizationId: input.organizationId,
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
	organizationId: string;
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
			organizationId: input.organizationId,
			storageScope: input.recovery.storageScope,
		})
	);
}

function isResolvingCreateProfileLocalAgents(
	recovery: RecoveryController
): boolean {
	return (
		(recovery.currentDeviceTargetQuery.isPending &&
			recovery.currentDeviceTargetQuery.fetchStatus === "fetching") ||
		(recovery.localRuntimesQuery.isPending &&
			recovery.localRuntimesQuery.fetchStatus === "fetching") ||
		(recovery.currentLocalRuntimeReplyReadinessQuery.isPending &&
			recovery.currentLocalRuntimeReplyReadinessQuery.fetchStatus ===
				"fetching")
	);
}

function resolveSubmitBlockSection(input: {
	ownerSubmitBlockReason: string | null;
	sessionPresetBindingBlockReason: string | null;
	sessionMode: AgentProfileSessionMode;
	sessionPreset: CreateProfileAgentActivitySessionPreset | undefined;
}): "session" | "owner" | undefined {
	if (
		input.sessionPresetBindingBlockReason ||
		(input.sessionMode !== "new" && !input.sessionPreset)
	) {
		return "session";
	}
	return input.ownerSubmitBlockReason ? "owner" : undefined;
}
