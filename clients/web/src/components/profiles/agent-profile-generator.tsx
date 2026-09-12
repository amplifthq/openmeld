"use client";

import { Collapsible } from "@base-ui/react/collapsible";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { TabItem, TabPanel, Tabs, TabsList } from "@openmeld/ui/fluid/tabs";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { useSurface } from "@openmeld/ui/lib/surface-context";
import {
	CaretDownIcon,
	CloudIcon,
	DesktopTowerIcon,
	SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";
import { SpinnerButton } from "#/components/spinner-button";
import type { AgentProfileBindingChoice } from "./agent-binding-choice-list";
import {
	AgentCreationComputerRecoveryPanel,
	agentCreationComputerActionLabel,
} from "./agent-creation-computer-recovery";
import {
	AgentProfileConfigurationCards,
	CreateProfileErrorNotice,
	CreateProfileForm,
	type CreateProfileFormProps,
} from "./create-profile-form";
import {
	type AgentProfileConfigurationSection,
	resolveAgentProfileConfigurationSummaries,
	resolveCreateProfileSubmitBlock,
} from "./create-profile-form-logic";
import { formatLocalAgentDisplayName } from "./local-agent-display-name";
import { LocalAgentLogoStack } from "./local-agent-logo-stack";
import { LocalAgentSelector } from "./local-agent-selector";
import { PersonalRemoteAgentConfiguration } from "./personal-remote-agent-configuration";

export type AgentProfileGeneratorProps = {
	form: CreateProfileFormProps;
	onCancel?: () => void;
	surface: "dialog" | "page";
};

export function AgentProfileGenerator(input: AgentProfileGeneratorProps) {
	if (input.form.profileKind !== "agent") {
		return <CreateProfileForm {...input.form} />;
	}
	return <AgentProfileGeneratorForm {...input} />;
}

function AgentProfileGeneratorForm(input: AgentProfileGeneratorProps) {
	const [remote, setRemote] = useState(false);
	const {
		remoteName,
		setRemoteName,
		remoteModel,
		setRemoteModel,
		remoteReady,
		submitRemote,
	} = useRemoteAgentDraft(input.form);
	const [configurationExpanded, setConfigurationExpanded] = useState(false);
	const [openSection, setOpenSection] =
		useState<AgentProfileConfigurationSection | null>(null);
	const openConfigurationSection = (
		section: AgentProfileConfigurationSection
	) => {
		setConfigurationExpanded(true);
		setOpenSection(section);
	};
	const submitBlockReasonId = useId();
	const form = input.form;
	const computerRecovery = remote ? undefined : form.computerRecovery;
	const submitBlock = remote ? null : resolveCreateProfileSubmitBlock(form);
	return (
		<form
			className="-mx-3 flex min-h-0 min-w-0 flex-1 flex-col"
			data-testid="create-profile-panel"
			onSubmit={(event) => {
				if (computerRecovery) {
					event.preventDefault();
					return;
				}
				if (!remote) {
					form.onSubmit(event);
					return;
				}
				event.preventDefault();
				submitRemote();
			}}
		>
			<ScrollArea
				className="min-h-0 min-w-0 flex-1"
				contentClassName="px-3"
				orientation="vertical"
			>
				<Tabs
					className="grid min-w-0 gap-5 pb-2"
					onValueChange={(value) => setRemote(value === "remote")}
					value={remote ? "remote" : "local"}
				>
					{input.surface === "page" ? (
						<div className="grid gap-2">
							<h1 className="font-medium text-2xl tracking-tight">
								Create Agent
							</h1>
							<p className="text-muted-foreground text-sm">
								Choose where your Agent runs.
							</p>
						</div>
					) : null}
					<AgentRuntimeTabs
						isSubmitting={form.isSubmitting}
						remoteAvailable={Boolean(form.remoteAgentCreation)}
					/>
					<TabPanel className="grid min-w-0 gap-5" value="local">
						{computerRecovery ? (
							<AgentCreationComputerRecoveryPanel recovery={computerRecovery} />
						) : null}
						<LocalAgentConfiguration
							computerRecovery={Boolean(computerRecovery)}
							configurationExpanded={configurationExpanded}
							form={form}
							openSection={openSection}
							setConfigurationExpanded={setConfigurationExpanded}
							setOpenSection={setOpenSection}
							surface={input.surface}
						/>
					</TabPanel>
					<TabPanel value="remote">
						<PersonalRemoteAgentConfiguration
							form={form}
							model={remoteModel}
							name={remoteName}
							onModelChange={setRemoteModel}
							onNameChange={setRemoteName}
						/>
					</TabPanel>
					<CreateProfileErrorNotice
						errorState={form.errorState}
						recoveryActionHref={form.recoveryActionHref}
					/>
				</Tabs>
			</ScrollArea>
			<div
				className="mx-3 flex shrink-0 flex-col-reverse items-stretch justify-between gap-3 bg-background pt-2 sm:flex-row sm:items-end"
				data-testid="create-profile-actions"
			>
				{input.onCancel ? (
					<Button
						disabled={form.isSubmitting}
						onClick={input.onCancel}
						type="button"
						variant="ghost"
					>
						Cancel
					</Button>
				) : (
					<span />
				)}
				{computerRecovery ? (
					!computerRecovery.setup && (
						<Button
							disabled={
								form.isSubmitting || computerRecovery.state === "checking"
							}
							onClick={computerRecovery.onStart}
							type="button"
						>
							{agentCreationComputerActionLabel(computerRecovery)}
						</Button>
					)
				) : (
					<AgentCreationSubmitActions
						form={form}
						openConfigurationSection={openConfigurationSection}
						remote={remote}
						remoteReady={remoteReady}
						submitBlock={submitBlock}
						submitBlockReasonId={submitBlockReasonId}
					/>
				)}
			</div>
		</form>
	);
}

function AgentRuntimeTabs(input: {
	isSubmitting: boolean;
	remoteAvailable: boolean;
}) {
	return (
		<TabsList
			aria-label="Agent runtime"
			background={false}
			className="grid grid-cols-2 items-stretch gap-2"
		>
			<TabItem
				className="h-auto items-start gap-3 border border-border p-3 text-left"
				disabled={input.isSubmitting}
				label="Local Agent"
				value="local"
			>
				<DesktopTowerIcon
					aria-hidden="true"
					className="mt-0.5 size-5 shrink-0"
				/>
				<span className="grid gap-1">
					<span className="flex flex-wrap items-center gap-x-3 gap-y-1">
						<span className="font-medium text-sm">Local Agent</span>
						<LocalAgentLogoStack compact />
					</span>
					<span className="text-muted-foreground text-xs">
						Runs on your computer.
					</span>
				</span>
			</TabItem>
			<TabItem
				className="h-auto items-start gap-3 border border-border p-3 text-left data-[disabled]:opacity-50"
				disabled={input.isSubmitting || !input.remoteAvailable}
				label="Remote Agent"
				value="remote"
			>
				<CloudIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
				<span className="grid gap-1">
					<span className="flex items-center gap-2">
						<span className="font-medium text-sm">Remote Agent</span>
						<Tooltip>
							<TooltipTrigger render={<span />}>
								<RuntimeBetaBadge />
							</TooltipTrigger>
							<TooltipContent>
								Remote Agents are new. Expect a few bumps.
							</TooltipContent>
						</Tooltip>
					</span>
					<span className="text-muted-foreground text-xs">
						Runs in the cloud.
					</span>
					{input.remoteAvailable ? null : (
						<span className="text-muted-foreground text-xs">
							Unavailable for this owner
						</span>
					)}
				</span>
			</TabItem>
		</TabsList>
	);
}

function RuntimeBetaBadge() {
	const surface = useSurface();
	return (
		<Badge
			className={`${surfaceClasses(surface + 1)} text-muted-foreground`}
			variant="secondary"
		>
			Beta
		</Badge>
	);
}

function useRemoteAgentDraft(form: CreateProfileFormProps) {
	const [editedRemoteName, setRemoteName] = useState<string | null>(null);
	const ownerName = form.agentOwnershipSummary?.trim();
	const defaultRemoteName =
		ownerName && ownerName !== "You"
			? `${ownerName}’s Remote Agent`
			: "Your Remote Agent";
	const remoteName = editedRemoteName ?? defaultRemoteName;
	const [remoteModel, setRemoteModel] = useState("");
	const intent = useRef<{ fingerprint: string; key: string } | null>(null);
	const catalog = form.modelCatalog?.agentControllers["center-agent"];
	const remoteModelId = remoteModel || catalog?.defaultModelId;
	const remoteReady = Boolean(
		remoteName.trim() &&
			catalog?.models.some(
				(choice) =>
					choice.id === remoteModelId &&
					choice.hostedRuntime &&
					!choice.unavailable
			)
	);
	const submitRemote = () => {
		if (form.isSubmitting || !remoteReady || !form.remoteAgentCreation) {
			return;
		}
		const fingerprint = JSON.stringify([remoteName.trim(), remoteModelId]);
		if (intent.current?.fingerprint !== fingerprint) {
			intent.current = { fingerprint, key: crypto.randomUUID() };
		}
		form.remoteAgentCreation.onSubmit({
			idempotencyKey: intent.current.key,
			modelId: remoteModelId ?? null,
			profileName: remoteName.trim(),
		});
	};
	return {
		remoteName,
		setRemoteName,
		remoteModel,
		setRemoteModel,
		remoteReady,
		submitRemote,
	};
}

function AdvancedSetup(input: {
	expanded: boolean;
	form: CreateProfileFormProps;
	onExpandedChange: (expanded: boolean) => void;
	openSection: AgentProfileConfigurationSection | null;
	onOpenSectionChange: (
		section: AgentProfileConfigurationSection | null
	) => void;
}) {
	if (!input.form.boundAgentId) {
		return (
			<AgentProfileConfigurationCards
				input={{ ...input.form, agentSessionSlot: undefined }}
				onOpenSectionChange={input.onOpenSectionChange}
				openSection={input.openSection}
			/>
		);
	}

	const summaries = resolveAgentProfileConfigurationSummaries(input.form);
	const disclosureSummary = [
		summaries.session,
		summaries.workingFolder,
		summaries.model,
		summaries.permission,
	].join(" · ");

	return (
		<Collapsible.Root
			className="group/agent-configuration min-w-0 pt-1"
			onOpenChange={(expanded) => input.onExpandedChange(expanded)}
			open={input.expanded}
		>
			<Collapsible.Trigger className="group/agent-configuration-trigger flex min-h-9 w-full min-w-0 items-center gap-3 border-border border-b pb-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/70">
				<SlidersHorizontalIcon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground"
				/>
				<span className="shrink-0 font-medium text-sm">
					Advanced Agent Settings
				</span>
				<span
					className="min-w-0 flex-1 truncate text-right text-muted-foreground text-xs"
					title={disclosureSummary}
				>
					{disclosureSummary}
				</span>
				<CaretDownIcon
					aria-hidden="true"
					className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-[cubic-bezier(0.645,0.045,0.355,1)] group-data-[panel-open]/agent-configuration-trigger:rotate-180 motion-reduce:transition-none"
				/>
			</Collapsible.Trigger>
			<Collapsible.Panel className="overflow-hidden transition-[height,opacity] duration-200 ease-[cubic-bezier(0.25,1,0.5,1)] data-[ending-style]:h-0 data-[starting-style]:h-0 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-[opacity] data-[open]:[height:var(--collapsible-panel-height)]">
				<div className="pt-3">
					<AgentProfileConfigurationCards
						input={input.form}
						onOpenSectionChange={input.onOpenSectionChange}
						openSection={input.openSection}
					/>
				</div>
			</Collapsible.Panel>
		</Collapsible.Root>
	);
}

function resolveGeneratorBindingChoices(
	form: CreateProfileFormProps
): AgentProfileBindingChoice[] {
	if (form.agentBindingChoices) {
		return [...form.agentBindingChoices];
	}
	const agentIds = [...form.availableLocalAgentIds];
	if (
		form.lockLocalAgentSelection &&
		form.boundAgentId &&
		!agentIds.includes(form.boundAgentId)
	) {
		agentIds.unshift(form.boundAgentId);
	}
	return agentIds.map((agentId) => {
		const label = formatLocalAgentDisplayName(agentId);
		return {
			agentId,
			description: `${label} on this computer.`,
			label,
			value: agentId,
		};
	});
}

function LocalAgentConfiguration({
	form,
	computerRecovery,
	surface,
	configurationExpanded,
	setConfigurationExpanded,
	setOpenSection,
	openSection,
}: {
	form: CreateProfileFormProps;
	computerRecovery: boolean;
	surface: "dialog" | "page";
	configurationExpanded: boolean;
	setConfigurationExpanded: (expanded: boolean) => void;
	setOpenSection: (section: AgentProfileConfigurationSection | null) => void;
	openSection: AgentProfileConfigurationSection | null;
}) {
	return (
		<div
			className={computerRecovery ? "hidden" : "grid min-w-0 gap-5"}
			hidden={Boolean(computerRecovery)}
		>
			<LocalAgentSelector
				choices={resolveGeneratorBindingChoices(form)}
				computerSlot={form.agentComputerSlot}
				disabled={form.isSubmitting}
				emptyState={form.localAgentEmptyState}
				isResolving={form.isResolvingLocalAgents}
				locked={form.lockLocalAgentSelection}
				onChange={form.onChangeAgentBindingValue ?? form.onChangeBoundAgentId}
				surface={surface}
				value={form.agentBindingValue ?? form.boundAgentId}
			/>
			{form.boundAgentId ? (
				<div className="grid min-w-0 gap-2">
					<Label htmlFor="create-profile-name-input">Agent name</Label>
					<Input
						autoComplete="off"
						disabled={form.isSubmitting}
						id="create-profile-name-input"
						onChange={(event) => form.onChangeProfileName(event.target.value)}
						placeholder="Agent name"
						value={form.profileName}
					/>
					<p className="text-muted-foreground text-xs leading-5">
						You can rename this Agent now or later.
					</p>
				</div>
			) : null}
			<AdvancedSetup
				expanded={configurationExpanded}
				form={form}
				onExpandedChange={setConfigurationExpanded}
				onOpenSectionChange={setOpenSection}
				openSection={openSection}
			/>
		</div>
	);
}

function AgentCreationSubmitActions({
	form,
	submitBlock,
	remote,
	remoteReady,
	submitBlockReasonId,
	openConfigurationSection,
}: {
	form: CreateProfileFormProps;
	submitBlock: ReturnType<typeof resolveCreateProfileSubmitBlock>;
	remote: boolean;
	remoteReady: boolean;
	submitBlockReasonId: string;
	openConfigurationSection: (section: AgentProfileConfigurationSection) => void;
}) {
	const submitBlockReason = submitBlock?.message;
	return (
		<div className="grid justify-items-stretch gap-2 sm:justify-items-end">
			{submitBlockReason ? (
				<output
					className="max-w-md text-right text-muted-foreground text-xs"
					id={submitBlockReasonId}
				>
					{submitBlockReason}
				</output>
			) : null}
			{submitBlock?.action ? (
				<div className="flex flex-wrap justify-end gap-2">
					{submitBlock.action.section === "working-folder" &&
					form.onUseManagedWorkspace ? (
						<Button
							disabled={form.isSubmitting}
							onClick={form.onUseManagedWorkspace}
							type="button"
							variant="outline"
						>
							Use OpenMeld managed folder
						</Button>
					) : null}
					<Button
						disabled={form.isSubmitting}
						onClick={() => {
							if (submitBlock.action) {
								openConfigurationSection(submitBlock.action.section);
							}
						}}
						type="button"
						variant="outline"
					>
						{submitBlock.action.label}
					</Button>
				</div>
			) : null}
			<SpinnerButton
				aria-describedby={submitBlockReason ? submitBlockReasonId : undefined}
				buttonState={form.isSubmitting ? "loading" : "idle"}
				disabled={
					form.isSubmitting || (remote ? !remoteReady : submitBlock !== null)
				}
				loadingLabel={form.submittingLabel ?? "Creating Agent…"}
				type="submit"
			>
				{form.submitLabel ?? "Create Agent"}
			</SpinnerButton>
		</div>
	);
}
