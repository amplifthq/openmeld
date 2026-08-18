"use client";

import {
	getAgentControllerPermissionModeDisplayMetadata,
	listAgentControllerPermissionModeOptions,
} from "@openmeld/agent-runtime";
import type {
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
import { Link } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { LocalFolderPickerButton } from "#/components/local-runtimes/local-folder-picker-button";
import { SelectedLocalFolder } from "#/components/local-runtimes/selected-local-folder";
import { SpinnerButton } from "#/components/spinner-button";
import type {
	NewProfileErrorState,
	NewProfileKind,
} from "#/lib/profiles/create-profile-flow";
import { AgentProfileBindingChoiceList } from "./agent-binding-choice-list";
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
		description: "Create another human profile on this account.",
		kind: "human",
		title: "Human profile",
	},
] as const satisfies readonly {
	description: string;
	kind: NewProfileKind;
	title: string;
}[];
const REASONING_LEVEL_SPLIT_PATTERN = /[-_]/u;

// Presentational, route-free Create Profile form. All state lives in the
// parent dialog; this component only renders the kind choice, the name input,
// the agent binding radio, and the recoverable error block. It performs no
// navigation, no StartFlow reads/writes, and no mutation.
export function CreateProfileForm(input: {
	additionalHumanProfileCreationEnabled: boolean;
	availableLocalAgentIds: readonly string[];
	boundAgentId: string;
	boundAgentControllerPermissionMode: AgentControllerPermissionMode;
	boundAgentControllerPermissionModeConfirmed: boolean;
	boundModelId: string;
	boundOpenCodePermission: AgentProfileBindingOpenCodePermission | null;
	boundReasoningLevel: string;
	errorState: NewProfileErrorState | null;
	isResolvingAccount: boolean;
	isResolvingLocalAgents: boolean;
	isSubmitting: boolean;
	modelCatalog: ModelCatalog | null;
	localFolderPickerDeviceId: string | null;
	organizationWakeAccessSlot?: ReactNode;
	projectSelectionBlockReason?: string | null;
	projectSelectionSlot?: ReactNode;
	projectFolderPath: string;
	profileKind: NewProfileKind | null;
	profileName: string;
	recoveryActionHref: string;
	onChangeBoundAgentId: (agentId: string) => void;
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
}) {
	const submitBlockReasonId = useId();
	// Block submit until the account profiles have resolved, so the acting human
	// (creatorProfileId / Space-join actor) is populated before create runs.
	const submitBlockReason = resolveCreateProfileSubmitBlockReason(input);
	const canSubmit = submitBlockReason === null;
	const agentBindingHelpText = resolveAgentBindingHelpText({
		availableLocalAgentCount: input.availableLocalAgentIds.length,
		isResolvingLocalAgents: input.isResolvingLocalAgents,
	});

	return (
		<div
			className="grid w-full min-w-0 gap-4"
			data-testid="create-profile-panel"
		>
			<ProfileKindTabs
				additionalHumanProfileCreationEnabled={
					input.additionalHumanProfileCreationEnabled
				}
				onSelect={input.onSelectProfileKind}
				value={input.profileKind}
			/>
			<form className="grid min-w-0 gap-4" onSubmit={input.onSubmit}>
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
					<AgentProfileBindingChoiceList
						availableLocalAgentIds={input.availableLocalAgentIds}
						disabled={input.isSubmitting}
						isResolving={input.isResolvingLocalAgents}
						onChange={input.onChangeBoundAgentId}
						value={input.boundAgentId}
					/>
				) : null}
				{input.profileKind === "agent" &&
				input.boundAgentId &&
				input.projectSelectionSlot
					? input.projectSelectionSlot
					: null}
				{input.profileKind === "agent" &&
				input.boundAgentId &&
				!input.projectSelectionSlot ? (
					<ProjectFolderField
						disabled={input.isSubmitting}
						onChange={input.onChangeProjectFolderPath}
						pickerDeviceId={input.localFolderPickerDeviceId}
						value={input.projectFolderPath}
					/>
				) : null}
				{input.profileKind === "agent" && input.boundAgentId ? (
					<AgentProfileModelSelectionFields
						agentId={input.boundAgentId}
						disabled={input.isSubmitting}
						modelCatalog={input.modelCatalog}
						modelId={input.boundModelId}
						onChangeModelId={input.onChangeBoundModelId}
						onChangeReasoningLevel={input.onChangeBoundReasoningLevel}
						reasoningLevel={input.boundReasoningLevel}
					/>
				) : null}
				{input.profileKind === "agent" && input.boundAgentId ? (
					<AgentControllerPermissionModeFields
						agentId={input.boundAgentId}
						confirmed={input.boundAgentControllerPermissionModeConfirmed}
						disabled={input.isSubmitting}
						onChange={input.onChangeBoundAgentControllerPermissionMode}
						onConfirmChange={
							input.onChangeBoundAgentControllerPermissionModeConfirmed
						}
						value={input.boundAgentControllerPermissionMode}
					/>
				) : null}
				{input.profileKind === "agent" &&
				isOpenCodeAgentId(input.boundAgentId) ? (
					<OpenCodePermissionsField
						disabled={input.isSubmitting}
						onChange={input.onChangeBoundOpenCodePermission}
						value={input.boundOpenCodePermission}
					/>
				) : null}
				{input.profileKind === "agent" ? (
					<div className="grid gap-1">
						<p className="text-muted-foreground text-xs">
							{agentBindingHelpText}
						</p>
					</div>
				) : null}
				{input.organizationWakeAccessSlot}
				{input.errorState ? (
					<div className="grid gap-3 rounded-md border border-destructive/40 p-4">
						<p className="text-destructive text-sm">
							{input.errorState.message}
						</p>
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
				) : null}
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
						type="submit"
					>
						Create profile
					</SpinnerButton>
				</div>
			</form>
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
}) {
	if (input.isResolvingLocalAgents) {
		return "Checking local agents on this computer.";
	}
	if (input.availableLocalAgentCount === 0) {
		return "No available local agents were detected on this computer, so you can choose one later.";
	}
	return "Choose a local agent now, or choose later if you only need the profile name today.";
}

function resolveCreateProfileSubmitBlockReason(input: {
	additionalHumanProfileCreationEnabled: boolean;
	boundAgentControllerPermissionMode: AgentControllerPermissionMode;
	boundAgentControllerPermissionModeConfirmed: boolean;
	boundAgentId: string;
	isResolvingAccount: boolean;
	profileKind: NewProfileKind | null;
	profileName: string;
	projectSelectionBlockReason?: string | null;
}): string | null {
	if (input.profileKind === null) {
		return input.additionalHumanProfileCreationEnabled
			? "Choose an Agent Profile or Human Profile."
			: "Choose an Agent Profile.";
	}
	if (input.profileName.trim().length === 0) {
		return "Enter a profile name.";
	}
	if (input.isResolvingAccount) {
		return "Loading account profiles.";
	}
	if (input.projectSelectionBlockReason) {
		return input.projectSelectionBlockReason;
	}
	if (requiresUnconfirmedAgentControllerPermissionMode(input)) {
		return "Confirm this permissions mode before creating the profile.";
	}
	return null;
}

function AgentControllerPermissionModeFields(input: {
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

function requiresUnconfirmedAgentControllerPermissionMode(input: {
	boundAgentControllerPermissionMode: AgentControllerPermissionMode;
	boundAgentControllerPermissionModeConfirmed: boolean;
	boundAgentId: string;
	profileKind: NewProfileKind | null;
}): boolean {
	if (input.profileKind !== "agent" || !input.boundAgentId) {
		return false;
	}
	const metadata = getAgentControllerPermissionModeDisplayMetadata(
		input.boundAgentControllerPermissionMode,
		{ agentControllerRef: buildBuiltinAgentControllerRef(input.boundAgentId) }
	);
	return (
		metadata.requiresExplicitConfirmation &&
		!input.boundAgentControllerPermissionModeConfirmed
	);
}

function buildBuiltinAgentControllerRef(agentId: string): string {
	return `builtin:${agentId}`;
}

export function AgentProfileModelSelectionFields(input: {
	agentId: string;
	disabled: boolean;
	modelCatalog: ModelCatalog | null;
	modelId: string;
	onChangeModelId: (modelId: string) => void;
	onChangeReasoningLevel: (reasoningLevel: string) => void;
	reasoningLevel: string;
}) {
	const modelSelectId = useId();
	const reasoningSelectId = useId();
	const controller =
		input.modelCatalog?.agentControllers[input.agentId] ?? null;
	const availableModels =
		controller?.models.filter((model) => !model.unavailable) ?? [];
	const defaultModel = availableModels.find(
		(model) => model.id === controller?.defaultModelId
	);
	const currentUnavailableModel =
		controller?.models.find(
			(model) => model.id === input.modelId && model.unavailable
		) ?? null;
	const selectedModel =
		availableModels.find((model) => model.id === input.modelId) ??
		currentUnavailableModel;
	const reasoningLevels = selectedModel?.supportedReasoningLevels ?? [];
	const supportsIndependentReasoning = availableModels.some(
		(model) => model.supportedReasoningLevels.length > 0
	);
	const modelDisplayValue = resolveModelSelectDisplayValue({
		defaultModel,
		modelId: input.modelId,
		selectedModel,
		defaultModelId: controller?.defaultModelId ?? "",
	});
	const reasoningDisplayValue = resolveReasoningSelectDisplayValue({
		reasoningLevel: input.reasoningLevel,
		selectedModel,
	});

	if (!controller || availableModels.length === 0) {
		return null;
	}

	return (
		<div className="grid min-w-0 gap-3">
			<div className="grid min-w-0 gap-2">
				<Label htmlFor={modelSelectId}>Model</Label>
				<Select
					disabled={input.disabled}
					onValueChange={input.onChangeModelId}
					value={input.modelId}
				>
					<SelectTrigger
						aria-label="Model"
						className="h-10 w-full px-3 text-sm"
						displayValue={modelDisplayValue}
						id={modelSelectId}
						placeholder="Use controller default"
					/>
					<SelectContent className="max-h-64">
						<SelectItem index={0} value="">
							{formatDefaultModelSelectionLabel(defaultModel)}
						</SelectItem>
						{currentUnavailableModel ? (
							<SelectItem disabled index={1} value={currentUnavailableModel.id}>
								{formatUnavailableModelOptionLabel(currentUnavailableModel)}
							</SelectItem>
						) : null}
						{availableModels.map((model, index) => (
							<SelectItem
								index={index + (currentUnavailableModel ? 2 : 1)}
								key={model.id}
								value={model.id}
							>
								{formatModelOptionLabel(model, controller.defaultModelId)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
				{supportsIndependentReasoning ? null : (
					<p className="text-muted-foreground text-xs">
						{input.agentId === "cursor"
							? "Cursor includes reasoning in the exact model choice."
							: "This controller does not offer a separate reasoning setting."}
					</p>
				)}
			</div>
			{supportsIndependentReasoning ? (
				<div className="grid min-w-0 gap-2">
					<Label htmlFor={reasoningSelectId}>Reasoning effort</Label>
					<Select
						disabled={
							input.disabled || !selectedModel || reasoningLevels.length === 0
						}
						onValueChange={input.onChangeReasoningLevel}
						value={input.reasoningLevel}
					>
						<SelectTrigger
							aria-label="Reasoning effort"
							className="h-10 w-full px-3 text-sm"
							displayValue={reasoningDisplayValue}
							id={reasoningSelectId}
							placeholder="Choose a model to set reasoning"
						/>
						<SelectContent className="max-h-64">
							<SelectItem index={0} value="">
								{formatDefaultReasoningSelectionLabel()}
							</SelectItem>
							{reasoningLevels.map((level, index) => (
								<SelectItem index={index + 1} key={level} value={level}>
									{formatReasoningLevelLabel(level)}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{selectedModel && reasoningLevels.length === 0 ? (
						<p className="text-muted-foreground text-xs">
							Reasoning effort is not available for this model.
						</p>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function resolveModelSelectDisplayValue(input: {
	defaultModel: ModelCatalogModel | null | undefined;
	defaultModelId: string;
	modelId: string;
	selectedModel: ModelCatalogModel | null;
}): string {
	if (!input.modelId) {
		return formatDefaultModelSelectionLabel(input.defaultModel);
	}
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

function formatDefaultModelSelectionLabel(
	defaultModel: ModelCatalogModel | null | undefined
): string {
	return defaultModel
		? `Use controller default (${defaultModel.displayName})`
		: "Use controller default";
}

function formatModelOptionLabel(
	model: ModelCatalogModel,
	defaultModelId: string
): string {
	if (model.unavailable) {
		return formatUnavailableModelOptionLabel(model);
	}
	return model.id === defaultModelId
		? `${model.displayName} (default)`
		: model.displayName;
}

function formatUnavailableModelOptionLabel(model: ModelCatalogModel): string {
	return `${model.displayName} (unavailable)`;
}

function formatDefaultReasoningSelectionLabel(): string {
	return "Use model default";
}

function formatReasoningLevelLabel(level: string): string {
	return level
		.split(REASONING_LEVEL_SPLIT_PATTERN)
		.filter(Boolean)
		.map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
		.join(" ");
}

// The Profile kind switch, built from the shared TabsSubtle primitive. It is a
// two-up card grid when both kinds are available and a single Agent card when
// Auth disables additional Human Profile creation.
function ProfileKindTabs(input: {
	additionalHumanProfileCreationEnabled: boolean;
	onSelect: (profileKind: NewProfileKind) => void;
	value: NewProfileKind | null;
}) {
	const idPrefix = useId();
	const availableTabs = input.additionalHumanProfileCreationEnabled
		? PROFILE_KIND_TABS
		: PROFILE_KIND_TABS.filter((tab) => tab.kind === "agent");
	const selectedIndex = availableTabs.findIndex(
		(tab) => tab.kind === input.value
	);

	return (
		<TabsSubtle
			aria-label="Profile kind"
			// Keep the binary choice two-up at every width so TabsSubtle's x-axis
			// proximity hover tracks the correct card. The disabled capability leaves
			// one full-width Agent card.
			className={`grid items-stretch gap-3 bg-transparent ${
				input.additionalHumanProfileCreationEnabled
					? "grid-cols-2"
					: "grid-cols-1"
			}`}
			idPrefix={idPrefix}
			onSelect={(index) => {
				const tab = availableTabs[index];
				if (tab) {
					input.onSelect(tab.kind);
				}
			}}
			selectedIndex={selectedIndex}
		>
			{availableTabs.map((tab, index) => (
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
