"use client";

import {
	getAgentControllerPermissionModeDisplayMetadata,
	listAgentControllerCollaborationModeOptions,
	listAgentControllerPermissionModeOptions,
	resolveAgentControllerModelCompatibility,
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

export type AgentProfileModelCompatibilityContext = {
	agentControllerId: string;
	controllerDisplayName: string;
	installedVersion: string | null;
	managePath: string | null;
	reportedModelIds: readonly string[] | null;
};

// Presentational, route-free Create Profile form. All state lives in the
// parent dialog; this component only renders an available kind choice, the
// name input, the agent binding radio, and the recoverable error block. It
// performs no navigation, no StartFlow reads/writes, and no mutation.
export function CreateProfileForm(input: {
	additionalHumanProfileCreationEnabled: boolean;
	additionalSubmitBlockReason?: string | null;
	agentBindingChoices?: readonly AgentProfileBindingChoice[];
	agentBindingValue?: string;
	agentOwnershipSlot?: ReactNode;
	agentSessionSlot?: ReactNode;
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
	organizationWakeAccessSlot?: ReactNode;
	projectSelectionBlockReason?: string | null;
	projectSelectionSlot?: ReactNode;
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
}) {
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
					{input.organizationWakeAccessSlot}
					{input.errorState ? (
						<div className="grid gap-3 rounded-md border border-destructive/40 p-4">
							<p className="text-destructive text-sm">
								{input.errorState.message}
							</p>
							{input.errorState.setupRefreshAvailable ? (
								<div>
									<Link
										className={buttonVariants({
											size: "sm",
											variant: "outline",
										})}
										to={input.recoveryActionHref}
									>
										{input.errorState.setupRefreshActionLabel}
									</Link>
								</div>
							) : null}
						</div>
					) : null}
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
	input: Parameters<typeof CreateProfileForm>[0];
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
			{form.boundAgentId && form.projectSelectionSlot
				? form.projectSelectionSlot
				: null}
			{form.boundAgentId && !form.projectSelectionSlot ? (
				<ProjectFolderField
					disabled={form.isSubmitting}
					onChange={form.onChangeProjectFolderPath}
					pickerDeviceId={form.localFolderPickerDeviceId}
					value={form.projectFolderPath}
				/>
			) : null}
			{form.boundAgentId ? (
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
			) : null}
			{form.boundAgentId ? (
				<AgentControllerCollaborationModeFields
					agentId={form.boundAgentId}
					disabled={form.isSubmitting}
					onChange={form.onChangeBoundAgentControllerCollaborationMode}
					value={form.boundAgentControllerCollaborationMode}
				/>
			) : null}
			{form.boundAgentId ? (
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
			) : null}
			{isOpenCodeAgentId(form.boundAgentId) ? (
				<OpenCodePermissionsField
					disabled={form.isSubmitting}
					onChange={form.onChangeBoundOpenCodePermission}
					value={form.boundOpenCodePermission}
				/>
			) : null}
			<div className="grid gap-1">
				<p className="text-muted-foreground text-xs">
					{input.agentBindingHelpText}
				</p>
			</div>
		</>
	);
}

function AgentControllerCollaborationModeFields(input: {
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

function resolveCreateProfileSubmitBlockReason(input: {
	additionalHumanProfileCreationEnabled: boolean;
	additionalSubmitBlockReason?: string | null;
	boundAgentControllerPermissionMode: AgentControllerPermissionMode;
	boundAgentControllerPermissionModeConfirmed: boolean;
	boundAgentId: string;
	boundModelId: string;
	isResolvingAccount: boolean;
	profileKind: NewProfileKind | null;
	profileName: string;
	projectSelectionBlockReason?: string | null;
	modelCatalog: ModelCatalog | null;
	modelCompatibilityContext?: AgentProfileModelCompatibilityContext | null;
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
	if (input.additionalSubmitBlockReason) {
		return input.additionalSubmitBlockReason;
	}
	if (input.projectSelectionBlockReason) {
		return input.projectSelectionBlockReason;
	}
	if (
		resolveSelectedModelCompatibility({
			agentId: input.boundAgentId,
			modelCatalog: input.modelCatalog,
			modelCompatibilityContext: input.modelCompatibilityContext,
			modelId: input.boundModelId,
		})?.knownIncompatible
	) {
		return `Choose a model available in ${input.modelCompatibilityContext?.controllerDisplayName ?? "this local agent"} on this computer.`;
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
	modelCompatibilityContext?: AgentProfileModelCompatibilityContext | null;
	onChangeModelId: (modelId: string) => void;
	onChangeReasoningLevel: (reasoningLevel: string) => void;
	reasoningLevel: string;
}) {
	const modelSelectId = useId();
	const reasoningSelectId = useId();
	const controller =
		input.modelCatalog?.agentControllers[input.agentId] ?? null;
	const modelCompatibilityContext =
		input.modelCompatibilityContext?.agentControllerId === input.agentId
			? input.modelCompatibilityContext
			: null;
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
	const selectedCompatibility = resolveSelectedModelCompatibility({
		agentId: input.agentId,
		modelCatalog: input.modelCatalog,
		modelCompatibilityContext,
		modelId: input.modelId,
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
						<SelectItem
							disabled={
								resolveModelCompatibility({
									controller,
									context: modelCompatibilityContext,
									modelId: controller.defaultModelId,
								}).knownIncompatible
							}
							index={0}
							value=""
						>
							{formatDefaultModelSelectionLabel(defaultModel)}
						</SelectItem>
						{currentUnavailableModel ? (
							<SelectItem disabled index={1} value={currentUnavailableModel.id}>
								{formatUnavailableModelOptionLabel(currentUnavailableModel)}
							</SelectItem>
						) : null}
						{renderCompatibleModelOptions({
							controller,
							context: modelCompatibilityContext,
							models: availableModels,
							startIndex: currentUnavailableModel ? 2 : 1,
						})}
					</SelectContent>
				</Select>
				<ModelCompatibilityNotice
					compatibility={selectedCompatibility}
					context={modelCompatibilityContext}
				/>
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

type ResolvedModelCompatibility = {
	knownIncompatible: boolean;
	message: string | null;
	status:
		| "catalog_unavailable"
		| "not_offered"
		| "requires_newer_controller"
		| "supported"
		| "unknown";
};

function resolveSelectedModelCompatibility(input: {
	agentId: string;
	modelCatalog: ModelCatalog | null;
	modelCompatibilityContext?: AgentProfileModelCompatibilityContext | null;
	modelId: string;
}): ResolvedModelCompatibility | null {
	const controller = input.modelCatalog?.agentControllers[input.agentId];
	if (!controller) {
		return null;
	}
	return resolveModelCompatibility({
		controller,
		context:
			input.modelCompatibilityContext?.agentControllerId === input.agentId
				? input.modelCompatibilityContext
				: null,
		modelId: input.modelId || controller.defaultModelId,
	});
}

function resolveModelCompatibility(input: {
	controller: NonNullable<ModelCatalog["agentControllers"][string]>;
	context?: AgentProfileModelCompatibilityContext | null;
	modelId: string;
}): ResolvedModelCompatibility {
	const model = input.controller.models.find(
		(candidate) => candidate.id === input.modelId
	);
	const compatibility = resolveAgentControllerModelCompatibility({
		controller: input.controller,
		installedVersion: input.context?.installedVersion ?? null,
		modelId: input.modelId,
		reportedModelIds: input.context?.reportedModelIds ?? null,
	});
	if (compatibility.status === "not_offered") {
		return {
			knownIncompatible: true,
			message: `${model?.displayName ?? input.modelId} isn't available in ${input.context?.controllerDisplayName ?? "this local agent"} on this computer. Choose another model or update or change the installation.`,
			status: compatibility.status,
		};
	}
	if (compatibility.status === "requires_newer_controller") {
		return {
			knownIncompatible: true,
			message: `${model?.displayName ?? input.modelId} requires ${input.context?.controllerDisplayName ?? "this local agent"} ${compatibility.minimumVersion} or later. This computer has ${compatibility.currentVersion}. Choose another model or update or change the installation.`,
			status: compatibility.status,
		};
	}
	return {
		knownIncompatible: compatibility.status === "catalog_unavailable",
		message: null,
		status: compatibility.status,
	};
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

function formatReasoningLevelLabel(level: string): string {
	return level
		.split(REASONING_LEVEL_SPLIT_PATTERN)
		.filter(Boolean)
		.map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
		.join(" ");
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
