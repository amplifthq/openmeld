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
	AgentProfileBindingSessionInventorySelection,
	AuthProfileView,
	DaemonServiceLane,
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
import { type ReactNode, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { resolveLocalFolderPickerDeviceId } from "#/lib/connect/local-folder-picker";
import { useOptionalCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import {
	resolveRememberedAgentProfileCreationDefaults,
	setAgentProfileCreationDefaults,
} from "#/lib/profiles/agent-profile-creation-defaults";
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
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { projectsQueryOptions } from "#/query/organizations/projects";
import {
	agentProfileCreationDefaultsQueryKeys,
	agentProfileCreationDefaultsQueryOptions,
} from "#/query/profiles/agent-profile-creation-defaults";
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
import { formatLocalAgentDisplayName } from "./local-agent-display-name";
import { isOpenCodeAgentId } from "./open-code-permissions-field";

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
	mode: "create" | "resume";
	nativeSessionId: string;
	nativeSessionTitle: string | null;
	organizationId: string;
	ownerUserId: string;
	projectId: string;
	provider: AgentProfileBindingSessionInventorySelection["provider"];
	status: "working" | "idle" | "ended" | "error" | "unknown";
};

// Standalone, route-free Create Profile dialog. Reused from Profiles, legacy
// agent redirects, and Spaces — the only difference is `spaceContext`: when
// present, the freshly created profile is also joined to that Space (always as a
// human acting profile); when absent, it is created in the selected Organization
// without Space membership. Carries zero dependency on retired start pages or
// route intents.
export function CreateProfileDialog(input: {
	agentActivitySessionPreset?: CreateProfileAgentActivitySessionPreset;
	onAfterJoin?: (profile: AuthProfileView) => void | Promise<void>;
	onOpenChange: (open: boolean) => void;
	onProfileCreated?: (profile: AuthProfileView) => void;
	open: boolean;
	organizationId: string;
	organizationAuthorizationContext?: CreateProfileOrganizationAuthorizationContext;
	orgSlug?: string;
	recovery: RecoveryController;
	spaceContext?: CreateProfileSpaceContext;
}) {
	const sessionPreset = input.agentActivitySessionPreset;
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
	const [profileKind, setProfileKind] = useState<NewProfileKind | null>(() =>
		sessionPreset ? "agent" : null
	);
	const selectableProfileKind =
		profileKind === "human" && !additionalHumanProfileCreationEnabled
			? null
			: profileKind;
	const [profileName, setProfileName] = useState(() =>
		resolveSessionPresetProfileName(sessionPreset)
	);
	const [boundAgentId, setBoundAgentId] = useState(
		() => sessionPresetAgentId ?? ""
	);
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
	const [selectedProjectId, setSelectedProjectId] = useState(
		() => sessionPreset?.projectId ?? ""
	);
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
	const [initialSessionPresetKey] = useState(() =>
		resolveSessionPresetKey(sessionPreset)
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
		hasSessionPreset: Boolean(sessionPreset),
	});
	const projectsQuery = useQuery(
		projectsQueryOptions({
			enabled: Boolean(organizationId),
			organizationId,
		})
	);
	const agentControllerRef = boundAgentId
		? buildBuiltinAgentControllerRef(boundAgentId)
		: "";
	const creationDefaultsQuery = useQuery(
		agentProfileCreationDefaultsQueryOptions({
			agentControllerRef,
			enabled: Boolean(input.open && organizationId && agentControllerRef),
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
	const bindingTarget = resolveProfileBindingCatalogExecutionTarget(
		recovery,
		sessionPreset
			? {
					connectedComputerId: sessionPreset.computerId,
					localAgentId: sessionPresetAgentId ?? "",
				}
			: undefined
	);
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
	const sessionPresetBindingBlockReason =
		resolveSessionPresetBindingBlockReason({
			bindingTarget,
			boundAgentId,
			hasSessionPreset: Boolean(sessionPreset),
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

	useEffect(() => {
		if (
			!boundAgentId ||
			creationDefaultsEditedRef.current ||
			!creationDefaultsQuery.data ||
			!modelCatalog ||
			projectsQuery.isPending
		) {
			return;
		}
		const applyKey = `${organizationId}:${agentControllerRef}:${creationDefaultsQuery.data.updatedAt ?? "empty"}`;
		if (appliedCreationDefaultsKeyRef.current === applyKey) {
			return;
		}
		const remembered = resolveRememberedAgentProfileCreationDefaults({
			agentId: boundAgentId,
			defaults: creationDefaultsQuery.data,
			modelCatalog,
			projects: projectsQuery.data?.projects ?? [],
		});
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
		setProjectWorkspaceFallback(remembered.defaultProjectId ? null : "managed");
		appliedCreationDefaultsKeyRef.current = applyKey;
	}, [
		agentControllerRef,
		boundAgentId,
		creationDefaultsQuery.data,
		modelCatalog,
		organizationId,
		projectsQuery.data?.projects,
		projectsQuery.isPending,
	]);

	const resetForm = () => {
		submissionInFlightRef.current = false;
		creationIntentRef.current = null;
		appliedCreationDefaultsKeyRef.current = null;
		creationDefaultsEditedRef.current = false;
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
		mutationFn: async (submission: { idempotencyKey: string }) => {
			assertSessionPresetBindingReady(sessionPresetBindingBlockReason);
			const agentControllerPermissionMode =
				resolveCreateAgentControllerPermissionMode({
					boundAgentControllerPermissionMode,
					boundAgentId,
				});
			const creationOutcome = await createProfileWithFollowUps({
				agentControllerConversationId,
				...(agentControllerPermissionMode
					? { agentControllerPermissionMode }
					: {}),
				boundAgentId,
				currentServiceCanSetProfileWorkspace:
					bindingTarget?.localAgentControl.setProfileWorkspace === true,
				deviceId: profileCreationExecutionTarget.deviceId,
				idempotencyKey: submission.idempotencyKey,
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
				runtimeLane: profileCreationExecutionTarget.runtimeLane,
				...toSessionInventorySelectionInput(sessionInventorySelection),
				queryClient,
				selectedHumanProfileId: selectedHumanProfile?.openMeldProfileId ?? null,
				selectedHumanProfile,
				spaceContext,
			});
			const { profile } = creationOutcome;
			const [creationDefaultsUpdateFailed, organizationAuthorization] =
				await Promise.all([
					rememberSuccessfulAgentProfileCreationDefaults({
						agentControllerPermissionMode,
						agentControllerRef,
						boundAgentId,
						defaultProjectId: resolveSelectedDefaultProjectId({
							selectedProjectBindingGeneration,
							selectedProjectId,
						}),
						followUpIssues: creationOutcome.followUpIssues,
						modelId: boundModelId || null,
						openCodePermission: isOpenCodeAgentId(boundAgentId)
							? boundOpenCodePermission
							: null,
						organizationId,
						queryClient,
						reasoningLevel: boundReasoningLevel || null,
					}),
					applyCreatedProfileOrganizationAuthorization({
						authorizeForOrganization,
						autoAuthorizeAgentProfileBindings:
							organizationAuthorizationPreferenceQuery.data
								?.autoAuthorizeAgentProfileBindings ?? false,
						boundAgentId,
						enableFutureOrganizationAuthorization,
						organizationAuthorizationContext,
						profile,
						queryClient,
					}),
				]);
			refreshCreatedProfileCaches({
				boundAgentId,
				createdProfile: profile,
				onAfterJoin: input.onAfterJoin,
				organizationAuthorization,
				queryClient,
				recovery,
				spaceJoined: creationOutcome.spaceJoined,
				spaceContext,
			}).catch((error) => {
				console.warn(
					"OpenMeld created the profile but could not refresh profile caches.",
					error
				);
			});
			return {
				creationDefaultsUpdateFailed,
				creationOutcome,
				organizationAuthorization,
				profile,
			};
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
		onSuccess: ({
			creationDefaultsUpdateFailed,
			creationOutcome,
			organizationAuthorization,
			profile,
		}) => {
			showCreatedProfileToast({
				creationDefaultsUpdateFailed,
				followUpIssues: creationOutcome.followUpIssues,
				organizationAuthorization,
				profile,
				spaceContext,
			});
			input.onProfileCreated?.(profile);
			resetForm();
			input.onOpenChange(false);
		},
		onSettled: () => {
			submissionInFlightRef.current = false;
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
	const projectSelectionBlockReason =
		sessionPresetBindingBlockReason ??
		resolveProjectSelectionBlockReason({
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
					creationDefaultsEditedRef.current = true;
					setSelectedProjectBindingGeneration(connection.bindingGeneration);
					setProjectFolderPath(connection.path);
					setProjectWorkspaceFallback(null);
					setErrorState(null);
				}}
				onManualPathChange={(path) => {
					creationDefaultsEditedRef.current = true;
					setProjectWorkspaceFallback("advanced");
					setProjectFolderPath(path);
					setErrorState(null);
				}}
				onProjectChange={(projectId) => {
					creationDefaultsEditedRef.current = true;
					setSelectedProjectId(projectId);
					setSelectedProjectBindingGeneration(null);
					setProjectFolderPath("");
					setProjectWorkspaceFallback(null);
					setErrorState(null);
				}}
				onUseAdvancedWorkspace={() => {
					creationDefaultsEditedRef.current = true;
					setSelectedProjectBindingGeneration(null);
					setProjectWorkspaceFallback("advanced");
					setErrorState(null);
				}}
				onUseManagedWorkspace={() => {
					creationDefaultsEditedRef.current = true;
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
			<DialogContent className="flex max-h-[min(42rem,calc(100dvh-2rem))] min-w-0 flex-col overflow-hidden sm:max-w-xl">
				<DialogHeader>
					<DialogTitle>{dialogTitle}</DialogTitle>
					<DialogDescription>
						{resolveCreateProfileDialogDescription({
							agentActivitySessionPreset: input.agentActivitySessionPreset,
							additionalHumanProfileCreationEnabled,
							spaceContext,
						})}
					</DialogDescription>
				</DialogHeader>
				<div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
					<CreateProfileForm
						additionalHumanProfileCreationEnabled={
							additionalHumanProfileCreationEnabled
						}
						allowProfileKindSelection={!sessionPreset}
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
						lockLocalAgentSelection={Boolean(sessionPreset)}
						modelCatalog={modelCatalog}
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
							if (sessionPreset) {
								return;
							}
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
							if (submissionInFlightRef.current) {
								return;
							}
							submissionInFlightRef.current = true;
							const fingerprint = JSON.stringify([
								organizationId,
								selectableProfileKind,
								profileName.trim(),
								selectedHumanProfile?.openMeldProfileId ?? null,
							]);
							if (creationIntentRef.current?.fingerprint !== fingerprint) {
								creationIntentRef.current = {
									fingerprint,
									idempotencyKey: crypto.randomUUID(),
								};
							}
							setErrorState(null);
							createProfileMutation.mutate({
								idempotencyKey: creationIntentRef.current.idempotencyKey,
							});
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

function resolveCreateProfileDialogTitle(input: {
	additionalHumanProfileCreationEnabled: boolean;
	hasSessionPreset: boolean;
}): string {
	if (input.hasSessionPreset) {
		return "Create a new Agent Profile";
	}
	return input.additionalHumanProfileCreationEnabled
		? "Create a new profile"
		: "Create a new Agent";
}

function resolveCreateProfileDialogDescription(input: {
	agentActivitySessionPreset:
		| CreateProfileAgentActivitySessionPreset
		| undefined;
	additionalHumanProfileCreationEnabled: boolean;
	spaceContext: CreateProfileSpaceContext | undefined;
}): string {
	if (input.agentActivitySessionPreset?.mode === "resume") {
		return input.agentActivitySessionPreset.status === "working"
			? "Connect this working Session to a new Agent Profile. Forking preserves the current work when your Local Agent supports it."
			: "Connect this Session to a new Agent Profile so it can continue with the same Local Agent context.";
	}
	if (input.agentActivitySessionPreset?.mode === "create") {
		return "Create a new Agent Profile with this Local Agent and Project. The existing Session stays unchanged.";
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
	const normalized = agentControllerRef.trim();
	if (!normalized.startsWith("builtin:")) {
		return null;
	}
	const agentId = normalized.slice("builtin:".length).trim();
	return agentId.length > 0 ? agentId : null;
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

function resolveSessionPresetBindingBlockReason(input: {
	bindingTarget: ReturnType<typeof resolveProfileBindingCatalogExecutionTarget>;
	boundAgentId: string;
	hasSessionPreset: boolean;
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
