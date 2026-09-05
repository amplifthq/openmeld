"use client";

import {
	getAgentControllerPermissionModeDisplayMetadata,
	listAgentControllerCollaborationModeOptions,
	listAgentControllerPermissionModeOptions,
} from "@openmeld/agent-runtime";
import type {
	AgentControllerCollaborationMode,
	AgentControllerPermissionMode,
	AgentProfileBindingOpenCodePermission,
	ModelCatalog,
	ModelCatalogModel,
} from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import {
	BrainIcon,
	FolderOpenIcon,
	HandIcon,
	LockKeyIcon,
	UserCircleIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { LocalFolderPickerButton } from "#/components/local-runtimes/local-folder-picker-button";
import { SelectedLocalFolder } from "#/components/local-runtimes/selected-local-folder";
import { SpinnerButton } from "#/components/spinner-button";
import type {
	NewProfileErrorState,
	NewProfileKind,
} from "#/lib/profiles/create-profile-flow";
import {
	type AgentProfileBindingChoice,
	AgentProfileBindingChoiceList,
} from "./agent-binding-choice-list";
import {
	AgentConfigurationCard,
	AgentConfigurationGrid,
} from "./agent-configuration-card";
import {
	buildBuiltinAgentControllerRef,
	formatModelOptionLabel,
	formatReasoningLevelLabel,
	type ResolvedModelCompatibility,
	resolveAgentProfileConfigurationSummaries,
	resolveCreateProfileSubmitBlockReason,
	resolveModelCompatibility,
	resolveSelectedModelCompatibility,
} from "./create-profile-form-logic";
import {
	isOpenCodeAgentId,
	OpenCodePermissionsField,
} from "./open-code-permissions-field";

const PROFILE_KIND_TABS = [
	{
		description:
			"Create an agent profile and optionally bind it to one of the available local agents.",
		kind: "agent",
		title: "Agent profile",
	},
	{
		description: "Create another personal profile on this account.",
		kind: "human",
		title: "Person",
	},
] as const satisfies readonly {
	description: string;
	kind: NewProfileKind;
	title: string;
}[];
export type AgentProfileModelCompatibilityContext = {
	agentControllerId: string;
	controllerDisplayName: string;
	installedVersion: string | null;
	managePath: string | null;
	reportedModelIds: readonly string[] | null;
};

export type AgentProfileLocalAgentEmptyState = {
	centerAgentHref: string | null;
	kind:
		| "connect_computer"
		| "set_up_local_agents"
		| "teammate_local_agents_unavailable";
	primaryActionHref: string | null;
};

// Presentational, route-free Create Profile form. All state lives in the
// parent dialog; this component only renders an available kind choice, the
// name input, the agent binding radio, and the recoverable error block. It
// performs no navigation, no StartFlow reads/writes, and no mutation.
export type CreateProfileFormProps = {
	additionalHumanProfileCreationEnabled: boolean;
	additionalSubmitBlockReason?: string | null;
	agentBindingChoices?: readonly AgentProfileBindingChoice[];
	agentBindingValue?: string;
	agentOwnershipSlot?: ReactNode;
	agentOwnershipSummary?: string;
	agentSessionSlot?: ReactNode;
	agentSessionSummary?: string;
	availableLocalAgentIds: readonly string[];
	boundAgentId: string;
	boundAgentControllerCollaborationMode: AgentControllerCollaborationMode | null;
	boundAgentControllerPermissionMode: AgentControllerPermissionMode;
	boundAgentControllerPermissionModeConfirmed: boolean;
	boundModelId: string;
	boundOpenCodePermission: AgentProfileBindingOpenCodePermission | null;
	boundReasoningLevel: string;
	errorState: NewProfileErrorState | null;
	isResolvingAccount: boolean;
	isResolvingLocalAgents: boolean;
	isSubmitting: boolean;
	allowProfileKindSelection?: boolean;
	lockLocalAgentSelection?: boolean;
	modelCatalog: ModelCatalog | null;
	modelCompatibilityContext?: AgentProfileModelCompatibilityContext | null;
	localFolderPickerDeviceId: string | null;
	localAgentEmptyState?: AgentProfileLocalAgentEmptyState;
	projectSelectionBlockReason?: string | null;
	projectSelectionSlot?: ReactNode;
	projectSelectionSummary?: string;
	projectFolderPath: string;
	profileKind: NewProfileKind | null;
	profileName: string;
	recoveryActionHref: string;
	onChangeBoundAgentId: (agentId: string) => void;
	onChangeBoundAgentControllerCollaborationMode: (
		agentControllerCollaborationMode: AgentControllerCollaborationMode
	) => void;
	onChangeAgentBindingValue?: (value: string) => void;
	onChangeBoundAgentControllerPermissionMode: (
		agentControllerPermissionMode: AgentControllerPermissionMode
	) => void;
	onChangeBoundAgentControllerPermissionModeConfirmed: (
		confirmed: boolean
	) => void;
	onChangeBoundModelId: (modelId: string) => void;
	onChangeBoundOpenCodePermission: (
		openCodePermission: AgentProfileBindingOpenCodePermission | null
	) => void;
	onChangeProjectFolderPath: (projectFolderPath: string) => void;
	onChangeBoundReasoningLevel: (reasoningLevel: string) => void;
	onChangeProfileName: (profileName: string) => void;
	onSelectProfileKind: (profileKind: NewProfileKind) => void;
	onSubmit: (event: FormEvent<HTMLFormElement>) => void;
	submitLabel?: string;
	submittingLabel?: string;
};

export function CreateProfileForm(input: CreateProfileFormProps) {
	const submitBlockReasonId = useId();
	// Block submit until the account profiles have resolved, so the acting human
	// (creatorProfileId / Space-join actor) is populated before create runs.
	const submitBlockReason = resolveCreateProfileSubmitBlockReason(input);
	const canSubmit = submitBlockReason === null;
	const agentBindingHelpText = resolveAgentBindingHelpText({
		availableLocalAgentCount: input.availableLocalAgentIds.length,
		isResolvingLocalAgents: input.isResolvingLocalAgents,
		locked: input.lockLocalAgentSelection === true,
	});

	return (
		<form
			className="flex min-h-0 w-full min-w-0 flex-1 flex-col"
			data-testid="create-profile-panel"
			onSubmit={input.onSubmit}
		>
			<div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
				<div className="grid min-w-0 gap-4 pb-4">
					{input.additionalHumanProfileCreationEnabled &&
					input.allowProfileKindSelection !== false ? (
						<ProfileKindTabs
							onSelect={input.onSelectProfileKind}
							value={input.profileKind}
						/>
					) : null}
					{input.profileKind === "agent" ? input.agentOwnershipSlot : null}
					{input.profileKind === "agent" ? input.agentSessionSlot : null}
					<div className="grid min-w-0 gap-2">
						<Label htmlFor="create-profile-name-input">Profile name</Label>
						<Input
							disabled={input.isSubmitting}
							id="create-profile-name-input"
							onChange={(event) => {
								input.onChangeProfileName(event.target.value);
							}}
							placeholder={
								input.profileKind === "human" ? "Work" : "Research Agent"
							}
							value={input.profileName}
						/>
					</div>
					{input.profileKind === "agent" ? (
						<AgentProfileFields
							agentBindingHelpText={agentBindingHelpText}
							input={input}
						/>
					) : null}
					<CreateProfileErrorNotice
						errorState={input.errorState}
						recoveryActionHref={input.recoveryActionHref}
					/>
				</div>
			</div>
			<div
				className="shrink-0 border-border border-t bg-background pt-4"
				data-testid="create-profile-actions"
			>
				<div className="grid justify-items-end gap-2">
					{submitBlockReason ? (
						<p
							className="text-muted-foreground text-xs"
							id={submitBlockReasonId}
						>
							{submitBlockReason}
						</p>
					) : null}
					<SpinnerButton
						aria-describedby={
							submitBlockReason ? submitBlockReasonId : undefined
						}
						buttonState={input.isSubmitting ? "loading" : "idle"}
						className="w-full sm:w-auto"
						disabled={!canSubmit}
						loadingLabel={input.submittingLabel ?? "Creating profile…"}
						type="submit"
					>
						{input.submitLabel ?? "Create profile"}
					</SpinnerButton>
				</div>
			</div>
		</form>
	);
}

function AgentProfileFields(input: {
	agentBindingHelpText: string;
	input: CreateProfileFormProps;
}) {
	const form = input.input;
	return (
		<>
			<AgentProfileBindingChoiceList
				availableLocalAgentIds={form.availableLocalAgentIds}
				choices={form.agentBindingChoices}
				disabled={form.isSubmitting}
				isResolving={form.isResolvingLocalAgents}
				locked={form.lockLocalAgentSelection}
				onChange={form.onChangeAgentBindingValue ?? form.onChangeBoundAgentId}
				value={form.agentBindingValue ?? form.boundAgentId}
			/>
			<AgentProfileAdvancedFields input={form} />
			<div className="grid gap-1">
				<p className="text-muted-foreground text-xs">
					{input.agentBindingHelpText}
				</p>
			</div>
		</>
	);
}

export function AgentProfileAdvancedFields(input: {
	input: CreateProfileFormProps;
}) {
	const form = input.input;
	if (!form.boundAgentId) {
		return null;
	}
	return (
		<>
			{form.projectSelectionSlot ? form.projectSelectionSlot : null}
			{form.projectSelectionSlot ? null : (
				<ProjectFolderField
					disabled={form.isSubmitting}
					onChange={form.onChangeProjectFolderPath}
					pickerDeviceId={form.localFolderPickerDeviceId}
					value={form.projectFolderPath}
				/>
			)}
			<AgentProfileModelSelectionFields
				agentId={form.boundAgentId}
				disabled={form.isSubmitting}
				modelCatalog={form.modelCatalog}
				modelCompatibilityContext={form.modelCompatibilityContext}
				modelId={form.boundModelId}
				onChangeModelId={form.onChangeBoundModelId}
				onChangeReasoningLevel={form.onChangeBoundReasoningLevel}
				reasoningLevel={form.boundReasoningLevel}
			/>
			<AgentControllerCollaborationModeFields
				agentId={form.boundAgentId}
				disabled={form.isSubmitting}
				onChange={form.onChangeBoundAgentControllerCollaborationMode}
				value={form.boundAgentControllerCollaborationMode}
			/>
			<AgentControllerPermissionModeFields
				agentId={form.boundAgentId}
				confirmed={form.boundAgentControllerPermissionModeConfirmed}
				disabled={form.isSubmitting}
				onChange={form.onChangeBoundAgentControllerPermissionMode}
				onConfirmChange={
					form.onChangeBoundAgentControllerPermissionModeConfirmed
				}
				value={form.boundAgentControllerPermissionMode}
			/>
			{isOpenCodeAgentId(form.boundAgentId) ? (
				<OpenCodePermissionsField
					disabled={form.isSubmitting}
					onChange={form.onChangeBoundOpenCodePermission}
					value={form.boundOpenCodePermission}
				/>
			) : null}
		</>
	);
}

export function AgentProfileConfigurationCards(input: {
	input: CreateProfileFormProps;
}) {
	const form = input.input;
	if (!form.boundAgentId) {
		return null;
	}
	const summaries = resolveAgentProfileConfigurationSummaries(form);

	return (
		<AgentConfigurationGrid>
			<AgentConfigurationCard
				description="What this Agent can do without asking."
				icon={<LockKeyIcon aria-hidden="true" />}
				itemId="permissions"
				label="Permissions"
				summary={summaries.permission}
			>
				<div className="grid gap-4">
					<AgentControllerPermissionModeFields
						agentId={form.boundAgentId}
						confirmed={form.boundAgentControllerPermissionModeConfirmed}
						disabled={form.isSubmitting}
						onChange={form.onChangeBoundAgentControllerPermissionMode}
						onConfirmChange={
							form.onChangeBoundAgentControllerPermissionModeConfirmed
						}
						value={form.boundAgentControllerPermissionMode}
					/>
					{isOpenCodeAgentId(form.boundAgentId) ? (
						<OpenCodePermissionsField
							disabled={form.isSubmitting}
							onChange={form.onChangeBoundOpenCodePermission}
							value={form.boundOpenCodePermission}
						/>
					) : null}
				</div>
			</AgentConfigurationCard>
			{form.agentOwnershipSlot ? (
				<AgentConfigurationCard
					description="Who owns and maintains this Agent."
					icon={<UserCircleIcon aria-hidden="true" />}
					itemId="owner"
					label="Owner"
					summary={summaries.owner}
				>
					{form.agentOwnershipSlot}
				</AgentConfigurationCard>
			) : null}
			{form.agentSessionSlot ? (
				<AgentConfigurationCard
					description="Start fresh or continue existing work."
					icon={<WaveformIcon aria-hidden="true" />}
					itemId="session"
					label="Session"
					summary={summaries.session}
				>
					{form.agentSessionSlot}
				</AgentConfigurationCard>
			) : null}
			<AgentConfigurationCard
				description="Where this Agent starts work."
				icon={<FolderOpenIcon aria-hidden="true" />}
				itemId="working-folder"
				label="Working folder"
				summary={summaries.workingFolder}
			>
				{form.projectSelectionSlot ?? (
					<ProjectFolderField
						disabled={form.isSubmitting}
						onChange={form.onChangeProjectFolderPath}
						pickerDeviceId={form.localFolderPickerDeviceId}
						value={form.projectFolderPath}
					/>
				)}
			</AgentConfigurationCard>
			<AgentConfigurationCard
				description="Choose the model and how deeply it reasons."
				icon={<BrainIcon aria-hidden="true" />}
				itemId="model"
				label="Model"
				summary={summaries.model}
			>
				<AgentProfileModelSelectionFields
					agentId={form.boundAgentId}
					disabled={form.isSubmitting}
					modelCatalog={form.modelCatalog}
					modelCompatibilityContext={form.modelCompatibilityContext}
					modelId={form.boundModelId}
					onChangeModelId={form.onChangeBoundModelId}
					onChangeReasoningLevel={form.onChangeBoundReasoningLevel}
					reasoningLevel={form.boundReasoningLevel}
				/>
			</AgentConfigurationCard>
			{summaries.collaboration ? (
				<AgentConfigurationCard
					description="How Codex works with you during a task."
					icon={<HandIcon aria-hidden="true" />}
					itemId="collaboration"
					label="Collaboration"
					summary={summaries.collaboration}
				>
					<AgentControllerCollaborationModeFields
						agentId={form.boundAgentId}
						disabled={form.isSubmitting}
						onChange={form.onChangeBoundAgentControllerCollaborationMode}
						value={form.boundAgentControllerCollaborationMode}
					/>
				</AgentConfigurationCard>
			) : null}
		</AgentConfigurationGrid>
	);
}

export function CreateProfileErrorNotice(input: {
	errorState: NewProfileErrorState | null;
	recoveryActionHref: string;
}) {
	if (!input.errorState) {
		return null;
	}
	return (
		<div
			className="grid gap-3 rounded-md border border-destructive/40 p-4"
			role="alert"
		>
			<p className="text-destructive text-sm">{input.errorState.message}</p>
			{input.errorState.setupRefreshAvailable ? (
				<div>
					<Link
						className={buttonVariants({ size: "sm", variant: "outline" })}
						to={input.recoveryActionHref}
					>
						{input.errorState.setupRefreshActionLabel}
					</Link>
				</div>
			) : null}
		</div>
	);
}

export function AgentControllerCollaborationModeFields(input: {
	agentId: string;
	disabled: boolean;
	onChange: (mode: AgentControllerCollaborationMode) => void;
	value: AgentControllerCollaborationMode | null;
}) {
	const selectId = useId();
	const options = listAgentControllerCollaborationModeOptions({
		agentControllerRef: buildBuiltinAgentControllerRef(input.agentId),
	});
	const selectedOption =
		options.find((option) => option.value === input.value) ?? options[0];
	if (!selectedOption) {
		return null;
	}
	return (
		<div className="grid min-w-0 gap-2">
			<Label htmlFor={selectId}>Codex collaboration mode</Label>
			<Select
				disabled={input.disabled || options.length <= 1}
				onValueChange={(value) => {
					input.onChange(value as AgentControllerCollaborationMode);
				}}
				value={selectedOption.value}
			>
				<SelectTrigger
					aria-label="Codex collaboration mode"
					className="h-10 w-full px-3 text-sm"
					displayValue={selectedOption.label}
					id={selectId}
					placeholder="Codex collaboration mode"
				/>
				<SelectContent>
					{options.map((option, index) => (
						<SelectItem index={index} key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-muted-foreground text-xs leading-5">
				{selectedOption.description}
			</p>
		</div>
	);
}

function ProjectFolderField(input: {
	disabled: boolean;
	onChange: (projectFolderPath: string) => void;
	pickerDeviceId: string | null;
	value: string;
}) {
	const [manualPathOpen, setManualPathOpen] = useState(false);
	return (
		<div className="grid min-w-0 gap-3 border border-border/70 p-3">
			<div className="grid gap-1">
				<p className="font-medium text-sm">Working folder</p>
				<p className="text-muted-foreground text-xs leading-5">
					Choose where this Agent starts work on this computer.
				</p>
			</div>
			{input.pickerDeviceId ? (
				<LocalFolderPickerButton
					allowMultiple={false}
					deviceId={input.pickerDeviceId}
					disabled={input.disabled}
					label="Choose folder on this computer"
					onSelect={(paths) => {
						const path = paths[0];
						if (path !== undefined) {
							setManualPathOpen(false);
							input.onChange(path);
						}
					}}
					purpose="agent_profile_working_folder"
					variant="default"
				/>
			) : null}
			{input.value && !manualPathOpen ? (
				<SelectedLocalFolder path={input.value} />
			) : null}
			{input.pickerDeviceId && !manualPathOpen ? (
				<Button
					className="justify-self-start"
					onClick={() => setManualPathOpen(true)}
					size="sm"
					type="button"
					variant="ghost"
				>
					Enter path manually
				</Button>
			) : null}
			{!input.pickerDeviceId || manualPathOpen ? (
				<div className="grid min-w-0 gap-2">
					<Label htmlFor="create-profile-project-folder-input">
						Custom working folder path
					</Label>
					<Input
						disabled={input.disabled}
						id="create-profile-project-folder-input"
						onChange={(event) => {
							input.onChange(event.target.value);
						}}
						placeholder="/full/path/to/folder"
						value={input.value}
					/>
				</div>
			) : null}
			<p className="text-muted-foreground text-xs leading-5">
				Leave this blank to use a folder managed by OpenMeld.
			</p>
		</div>
	);
}

function resolveAgentBindingHelpText(input: {
	availableLocalAgentCount: number;
	isResolvingLocalAgents: boolean;
	locked: boolean;
}) {
	if (input.locked) {
		return "The Agent Profile must use the same local agent as this Session.";
	}
	if (input.isResolvingLocalAgents) {
		return "Checking local agents on this computer.";
	}
	if (input.availableLocalAgentCount === 0) {
		return "No available local agents were detected on this computer, so you can choose one later.";
	}
	return "Choose a local agent now, or choose later if you only need the profile name today.";
}

export function AgentControllerPermissionModeFields(input: {
	agentId: string;
	confirmed: boolean;
	disabled: boolean;
	onChange: (
		agentControllerPermissionMode: AgentControllerPermissionMode
	) => void;
	onConfirmChange: (confirmed: boolean) => void;
	value: AgentControllerPermissionMode;
}) {
	const selectId = useId();
	const confirmationId = useId();
	const agentControllerRef = buildBuiltinAgentControllerRef(input.agentId);
	const options = listAgentControllerPermissionModeOptions({
		agentControllerRef,
	});
	if (options.length === 0) {
		return null;
	}
	const selectedOption =
		options.find((option) => option.value === input.value) ?? options[0];
	const selectedMetadata = getAgentControllerPermissionModeDisplayMetadata(
		input.value,
		{ agentControllerRef }
	);
	const requiresConfirmation =
		selectedMetadata.requiresExplicitConfirmation && options.length > 1;

	return (
		<div
			className="grid min-w-0 gap-2"
			data-testid="agent-controller-permission-mode-fields"
		>
			<Label htmlFor={selectId}>{selectedMetadata.fieldLabel}</Label>
			<Select
				disabled={input.disabled || options.length <= 1}
				onValueChange={(value) => {
					input.onChange(value as AgentControllerPermissionMode);
					input.onConfirmChange(false);
				}}
				value={selectedOption?.value}
			>
				<SelectTrigger
					aria-label={selectedMetadata.fieldLabel}
					className="h-10 w-full px-3 text-sm"
					displayValue={selectedOption?.label}
					id={selectId}
					placeholder={selectedMetadata.fieldLabel}
				/>
				<SelectContent className="max-h-64">
					{options.map((option, index) => (
						<SelectItem index={index} key={option.value} value={option.value}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-muted-foreground text-xs leading-5">
				{selectedMetadata.description}
			</p>
			{requiresConfirmation ? (
				<label
					className="flex items-start gap-2 text-destructive text-xs leading-5"
					htmlFor={confirmationId}
				>
					<input
						checked={input.confirmed}
						className="mt-0.5 size-4 shrink-0 accent-current"
						disabled={input.disabled}
						id={confirmationId}
						onChange={(event) => {
							input.onConfirmChange(event.target.checked);
						}}
						type="checkbox"
					/>
					<span>
						I understand this permissions mode can run with dangerous full
						access.
					</span>
				</label>
			) : null}
		</div>
	);
}

type AgentProfileModelSelectionFieldsProps = {
	agentId: string;
	disabled: boolean;
	modelCatalog: ModelCatalog | null;
	modelId: string;
	modelCompatibilityContext?: AgentProfileModelCompatibilityContext | null;
	onChangeModelId: (modelId: string) => void;
	onChangeReasoningLevel: (reasoningLevel: string) => void;
	reasoningLevel: string;
};

export function AgentProfileModelSelectionFields(
	input: AgentProfileModelSelectionFieldsProps
) {
	const modelSelectId = useId();
	const state = resolveAgentProfileModelSelectionState(input);

	if (!state) {
		return null;
	}

	return (
		<div className="grid min-w-0 gap-3">
			<div className="grid min-w-0 gap-2">
				<Label htmlFor={modelSelectId}>Model</Label>
				<Select
					disabled={input.disabled}
					onValueChange={input.onChangeModelId}
					value={state.effectiveModelId}
				>
					<SelectTrigger
						aria-label="Model"
						className="h-10 w-full px-3 text-sm"
						displayValue={state.modelDisplayValue}
						id={modelSelectId}
						placeholder="Select a model"
					/>
					<SelectContent className="max-h-64">
						{state.currentUnavailableModel ? (
							<SelectItem
								disabled
								index={0}
								value={state.currentUnavailableModel.id}
							>
								{formatUnavailableModelOptionLabel(
									state.currentUnavailableModel
								)}
							</SelectItem>
						) : null}
						{renderCompatibleModelOptions({
							controller: state.controller,
							context: state.modelCompatibilityContext,
							models: state.availableModels,
							startIndex: state.currentUnavailableModel ? 1 : 0,
						})}
					</SelectContent>
				</Select>
				<ModelCompatibilityNotice
					compatibility={state.selectedCompatibility}
					context={state.modelCompatibilityContext}
				/>
				<IndependentReasoningUnavailableNote
					agentId={input.agentId}
					supported={state.supportsIndependentReasoning}
				/>
			</div>
			<AgentProfileReasoningSelection input={input} state={state} />
		</div>
	);
}

type AgentProfileModelSelectionState = {
	availableModels: readonly ModelCatalogModel[];
	controller: NonNullable<ModelCatalog["agentControllers"][string]>;
	currentUnavailableModel: ModelCatalogModel | null;
	effectiveModelId: string;
	modelCompatibilityContext: AgentProfileModelCompatibilityContext | null;
	modelDisplayValue: string;
	reasoningDisplayValue: string | undefined;
	reasoningLevels: readonly string[];
	selectedCompatibility: ResolvedModelCompatibility | null;
	selectedModel: ModelCatalogModel | null;
	supportsIndependentReasoning: boolean;
};

function resolveAgentProfileModelSelectionState(
	input: AgentProfileModelSelectionFieldsProps
): AgentProfileModelSelectionState | null {
	const controller =
		input.modelCatalog?.agentControllers[input.agentId] ?? null;
	if (!controller) {
		return null;
	}
	const modelCompatibilityContext =
		input.modelCompatibilityContext?.agentControllerId === input.agentId
			? input.modelCompatibilityContext
			: null;
	const availableModels = controller.models.filter(
		(model) => !model.unavailable
	);
	if (availableModels.length === 0) {
		return null;
	}
	const currentUnavailableModel =
		controller.models.find(
			(model) => model.id === input.modelId && model.unavailable
		) ?? null;
	const effectiveModelId = input.modelId || controller.defaultModelId;
	const selectedModel =
		availableModels.find((model) => model.id === effectiveModelId) ??
		currentUnavailableModel;
	const reasoningLevels = selectedModel?.supportedReasoningLevels ?? [];
	return {
		availableModels,
		controller,
		currentUnavailableModel,
		effectiveModelId,
		modelCompatibilityContext,
		modelDisplayValue: resolveModelSelectDisplayValue({
			defaultModelId: controller.defaultModelId,
			modelId: effectiveModelId,
			selectedModel,
		}),
		reasoningDisplayValue: resolveReasoningSelectDisplayValue({
			reasoningLevel: input.reasoningLevel,
			selectedModel,
		}),
		reasoningLevels,
		selectedCompatibility: resolveSelectedModelCompatibility({
			agentId: input.agentId,
			modelCatalog: input.modelCatalog,
			modelCompatibilityContext,
			modelId: input.modelId,
		}),
		selectedModel,
		supportsIndependentReasoning: availableModels.some(
			(model) => model.supportedReasoningLevels.length > 0
		),
	};
}

function IndependentReasoningUnavailableNote(input: {
	agentId: string;
	supported: boolean;
}) {
	if (input.supported) {
		return null;
	}
	return (
		<p className="text-muted-foreground text-xs">
			{input.agentId === "cursor"
				? "Cursor includes reasoning in the exact model choice."
				: "This controller does not offer a separate reasoning setting."}
		</p>
	);
}

function AgentProfileReasoningSelection(input: {
	input: AgentProfileModelSelectionFieldsProps;
	state: AgentProfileModelSelectionState;
}) {
	const reasoningSelectId = useId();
	if (!input.state.supportsIndependentReasoning) {
		return null;
	}
	return (
		<div className="grid min-w-0 gap-2">
			<Label htmlFor={reasoningSelectId}>Reasoning effort</Label>
			<Select
				disabled={
					input.input.disabled ||
					!input.state.selectedModel ||
					input.state.reasoningLevels.length === 0
				}
				onValueChange={(reasoningLevel) =>
					applyReasoningLevelSelection({
						effectiveModelId: input.state.effectiveModelId,
						modelId: input.input.modelId,
						onChangeModelId: input.input.onChangeModelId,
						onChangeReasoningLevel: input.input.onChangeReasoningLevel,
						reasoningLevel,
					})
				}
				value={input.input.reasoningLevel}
			>
				<SelectTrigger
					aria-label="Reasoning effort"
					className="h-10 w-full px-3 text-sm"
					displayValue={input.state.reasoningDisplayValue}
					id={reasoningSelectId}
					placeholder="Use model default"
				/>
				<SelectContent className="max-h-64">
					<SelectItem index={0} value="">
						{formatDefaultReasoningSelectionLabel()}
					</SelectItem>
					{input.state.reasoningLevels.map((level, index) => (
						<SelectItem index={index + 1} key={level} value={level}>
							{formatReasoningLevelLabel(level)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<ReasoningUnavailableForModelNote
				hasSelectedModel={Boolean(input.state.selectedModel)}
				reasoningLevelCount={input.state.reasoningLevels.length}
			/>
		</div>
	);
}

function ReasoningUnavailableForModelNote(input: {
	hasSelectedModel: boolean;
	reasoningLevelCount: number;
}) {
	if (!(input.hasSelectedModel && input.reasoningLevelCount === 0)) {
		return null;
	}
	return (
		<p className="text-muted-foreground text-xs">
			Reasoning effort is not available for this model.
		</p>
	);
}

function applyReasoningLevelSelection(input: {
	effectiveModelId: string;
	modelId: string;
	onChangeModelId: (modelId: string) => void;
	onChangeReasoningLevel: (reasoningLevel: string) => void;
	reasoningLevel: string;
}): void {
	if (input.reasoningLevel && !input.modelId) {
		input.onChangeModelId(input.effectiveModelId);
	}
	input.onChangeReasoningLevel(input.reasoningLevel);
}

function resolveModelSelectDisplayValue(input: {
	defaultModelId: string;
	modelId: string;
	selectedModel: ModelCatalogModel | null;
}): string {
	if (!input.selectedModel) {
		return input.modelId;
	}
	return formatModelOptionLabel(input.selectedModel, input.defaultModelId);
}

function resolveReasoningSelectDisplayValue(input: {
	reasoningLevel: string;
	selectedModel: ModelCatalogModel | null;
}): string | undefined {
	if (input.reasoningLevel) {
		return formatReasoningLevelLabel(input.reasoningLevel);
	}
	if (!input.selectedModel) {
		return undefined;
	}
	return formatDefaultReasoningSelectionLabel();
}

function formatUnavailableModelOptionLabel(model: ModelCatalogModel): string {
	return `${model.displayName} (unavailable)`;
}

function formatCompatibleModelOptionLabel(input: {
	compatibility: ResolvedModelCompatibility;
	defaultModelId: string;
	model: ModelCatalogModel;
}): string {
	const label = formatModelOptionLabel(input.model, input.defaultModelId);
	return input.compatibility.knownIncompatible
		? `${label} (not available on this computer)`
		: label;
}

function renderCompatibleModelOptions(input: {
	controller: NonNullable<ModelCatalog["agentControllers"][string]>;
	context: AgentProfileModelCompatibilityContext | null;
	models: readonly ModelCatalogModel[];
	startIndex: number;
}) {
	return input.models.map((model, index) => {
		const compatibility = resolveModelCompatibility({
			controller: input.controller,
			context: input.context,
			modelId: model.id,
		});
		return (
			<SelectItem
				disabled={compatibility.knownIncompatible}
				index={index + input.startIndex}
				key={model.id}
				value={model.id}
			>
				{formatCompatibleModelOptionLabel({
					compatibility,
					defaultModelId: input.controller.defaultModelId,
					model,
				})}
			</SelectItem>
		);
	});
}

function ModelCompatibilityNotice(input: {
	compatibility: ResolvedModelCompatibility | null;
	context: AgentProfileModelCompatibilityContext | null;
}) {
	if (!input.compatibility?.knownIncompatible) {
		return null;
	}
	return (
		<div className="grid justify-items-start gap-2">
			<p className="text-destructive text-xs leading-5">
				{input.compatibility.message}
			</p>
			{input.context?.managePath ? (
				<Link
					className={buttonVariants({ size: "sm", variant: "outline" })}
					to={input.context.managePath}
				>
					Update or change {input.context.controllerDisplayName}
				</Link>
			) : null}
		</div>
	);
}

function formatDefaultReasoningSelectionLabel(): string {
	return "Use model default";
}

// The Profile kind switch is useful only when Auth allows both kinds. When
// Human creation is disabled, the dialog opens directly as Agent creation.
function ProfileKindTabs(input: {
	onSelect: (profileKind: NewProfileKind) => void;
	value: NewProfileKind | null;
}) {
	const idPrefix = useId();
	const selectedIndex = PROFILE_KIND_TABS.findIndex(
		(tab) => tab.kind === input.value
	);

	return (
		<TabsSubtle
			aria-label="Profile kind"
			// Keep the binary choice two-up at every width so TabsSubtle's x-axis
			// proximity hover tracks the correct card.
			className="grid grid-cols-2 items-stretch gap-3 bg-transparent"
			idPrefix={idPrefix}
			onSelect={(index) => {
				const tab = PROFILE_KIND_TABS[index];
				if (tab) {
					input.onSelect(tab.kind);
				}
			}}
			selectedIndex={selectedIndex}
		>
			{PROFILE_KIND_TABS.map((tab, index) => (
				<TabsSubtleItem
					className="h-auto min-h-24 w-full flex-col items-start justify-center gap-1.5 border border-border border-solid p-4 text-left sm:min-h-28"
					index={index}
					key={tab.kind}
					label={tab.title}
				>
					<span className="font-medium text-base text-foreground">
						{tab.title}
					</span>
					<span className="text-pretty text-muted-foreground text-sm leading-5">
						{tab.description}
					</span>
				</TabsSubtleItem>
			))}
		</TabsSubtle>
	);
}
