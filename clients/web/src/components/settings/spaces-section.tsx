import { createSpacePreferencesApi } from "@openmeld/api-client";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { SettingsRow } from "@openmeld/ui/components/settings-row";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { Switch } from "@openmeld/ui/components/switch";
import { RadioGroup, RadioItem } from "@openmeld/ui/fluid/radio-group";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowRightIcon,
	ArrowUpIcon,
	PlusIcon,
	RobotIcon,
	UserCircleIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState, useSyncExternalStore } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { useMessagePreviews } from "#/components/spaces/use-message-previews";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";
import {
	readSpaceConversationLayoutPreference,
	type SpaceConversationLayout,
	writeSpaceConversationLayoutPreference,
} from "#/lib/spaces/conversation-layout-preference";
import { useHistorySliderPreference } from "#/lib/spaces/history-slider-preference";
import { useMessageSendShortcut } from "#/lib/spaces/message-send-shortcut";
import {
	readSpaceSelfMessageAlignmentPreference,
	type SpaceSelfMessageAlignment,
	writeSpaceSelfMessageAlignmentPreference,
} from "#/lib/spaces/self-message-alignment-preference";

type ConversationLayoutChoice = {
	description: string;
	label: string;
	value: SpaceConversationLayout;
};

const CONVERSATION_LAYOUT_CHOICES: readonly ConversationLayoutChoice[] = [
	{
		description: "Messages and the composer use all available space.",
		label: "Full width",
		value: "full-width",
	},
	{
		description: "Messages and the composer stay centered in a focused column.",
		label: "Centered",
		value: "centered",
	},
] as const;

type SelfMessageAlignmentChoice = {
	description: string;
	label: string;
	value: SpaceSelfMessageAlignment;
};

const SELF_MESSAGE_ALIGNMENT_CHOICES: readonly SelfMessageAlignmentChoice[] = [
	{
		description: "Your messages appear on the left, with actions on the right.",
		label: "Left",
		value: "left",
	},
	{
		description: "Your messages appear on the right, with actions on the left.",
		label: "Right",
		value: "right",
	},
] as const;

const HISTORY_SLIDER_CHOICES = [
	{
		description: "Show a compact slider for older messages.",
		enabled: true,
		label: "Show",
	},
	{
		description: "Hide the slider and give messages more room.",
		enabled: false,
		label: "Hide",
	},
] as const;

const subscribeToHydration = () => () => undefined;
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export function SpacesSection() {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = defaultHumanProfile?.openMeldProfileId ?? "";
	const previews = useMessagePreviews(profileId, currentOrganization.id);
	const historySlider = useHistorySliderPreference();
	const sendShortcut = useMessageSendShortcut();
	const choiceOrientation = useMediaQuery("(max-width: 639px)")
		? "vertical"
		: "horizontal";
	const mounted = useSyncExternalStore(
		subscribeToHydration,
		getClientHydrationSnapshot,
		getServerHydrationSnapshot
	);
	const [conversationLayout, setConversationLayout] =
		useState<SpaceConversationLayout>(() =>
			readSpaceConversationLayoutPreference()
		);
	const [selfMessageAlignment, setSelfMessageAlignment] =
		useState<SpaceSelfMessageAlignment>(() =>
			readSpaceSelfMessageAlignmentPreference()
		);
	const selectedConversationLayoutIndex = mounted
		? CONVERSATION_LAYOUT_CHOICES.findIndex(
				(choice) => choice.value === conversationLayout
			)
		: -1;
	const selectedSelfMessageAlignmentIndex = mounted
		? SELF_MESSAGE_ALIGNMENT_CHOICES.findIndex(
				(choice) => choice.value === selfMessageAlignment
			)
		: -1;
	const api = useMemo(
		() =>
			createSpacePreferencesApi(
				createOrganizationScopedWebOpenMeldApiFoundation({
					organizationId: currentOrganization.id,
				})
			),
		[currentOrganization.id]
	);
	const queryKey = ["space-preferences", currentUserId];
	const query = useQuery({ queryKey, queryFn: () => api.get() });
	const client = useQueryClient();
	const mutation = useMutation({
		mutationFn: (enabled: boolean) => api.update(enabled),
		onSuccess: async (data) => {
			client.setQueryData(queryKey, data);
			await client.invalidateQueries({ queryKey: ["spaces"] });
		},
	});
	const unavailable = query.isError || query.fetchStatus === "paused";
	const saveStatus = mutation.isPending ? "saving" : "idle";
	const status = unavailable || mutation.isError ? "error" : saveStatus;
	return (
		<>
			<AppPageHeader
				description="Choose how you send, read, and find conversations."
				eyebrow="Personal"
				title="Spaces"
			/>
			<PreferenceGroup title="Sending">
				<SettingsRow
					control={
						<RadioGroup
							aria-label="Send shortcut"
							className="w-full"
							orientation={choiceOrientation}
							selectedIndex={sendShortcut.shortcut === "enter" ? 0 : 1}
						>
							{(["enter", "modifier-enter"] as const).map((value, index) => (
								<RadioItem
									className="min-w-0 flex-1 px-3 py-3"
									description={
										<span className="flex min-w-0 flex-col gap-2">
											<span>
												{value === "enter"
													? "Enter sends. Shift + Enter adds a new line."
													: "Enter adds a new line. Cmd/Ctrl + Enter sends."}
											</span>
											<SendShortcutPreview
												modified={value === "modifier-enter"}
											/>
										</span>
									}
									index={index}
									key={value}
									label={value === "enter" ? "Enter" : "Cmd/Ctrl + Enter"}
									onSelect={() => sendShortcut.setShortcut(value)}
									selected={sendShortcut.shortcut === value}
								/>
							))}
						</RadioGroup>
					}
					description="For Spaces, direct messages, and threads. Use Cmd on Mac or Ctrl on Windows and Linux. Saved in this browser."
					label="Send shortcut"
					layout="stacked"
					showDivider
				/>
				<div>
					<SettingsRow
						control={
							query.data ? (
								<Switch
									aria-label="Automatically wake the only Agent"
									checked={query.data.automaticWakeEnabled}
									disabled={unavailable || mutation.isPending}
									onCheckedChange={(value) => mutation.mutate(value)}
								/>
							) : (
								<Skeleton className="h-5 w-9 rounded-full" />
							)
						}
						description="When only you and one Agent are in a conversation, your messages ask it to work without an @mention. Turn this off to require a mention. Applies across your organizations."
						error={
							unavailable
								? "Couldn't load this preference."
								: mutation.error?.message
						}
						label="Automatically wake the only Agent"
						showDivider={false}
						status={status}
					/>
					{query.data && !unavailable && (
						<AutomaticWakePreview enabled={query.data.automaticWakeEnabled} />
					)}
				</div>
				{unavailable || mutation.isError ? (
					<Button
						className="self-start"
						onClick={() =>
							unavailable
								? query.refetch()
								: mutation.mutate(mutation.variables ?? true)
						}
						size="sm"
						variant="outline"
					>
						Try again
					</Button>
				) : null}
			</PreferenceGroup>
			<PreferenceGroup title="Reading">
				<SettingsRow
					control={
						<RadioGroup
							aria-label="Conversation layout"
							className="w-full"
							orientation={choiceOrientation}
							selectedIndex={selectedConversationLayoutIndex}
						>
							{CONVERSATION_LAYOUT_CHOICES.map((choice, index) => (
								<RadioItem
									className="min-w-0 flex-1 px-3 py-3"
									description={
										<span className="flex min-w-0 flex-col gap-2">
											<span>{choice.description}</span>
											<ConversationLayoutPreview layout={choice.value} />
										</span>
									}
									index={index}
									key={choice.value}
									label={choice.label}
									onSelect={() => {
										writeSpaceConversationLayoutPreference(choice.value);
										setConversationLayout(choice.value);
									}}
									selected={mounted && conversationLayout === choice.value}
								/>
							))}
						</RadioGroup>
					}
					description="Applies to every Space and Center Agent conversation. Saved in this browser."
					label="Conversation layout"
					layout="stacked"
					showDivider
				/>
				<SettingsRow
					control={
						<RadioGroup
							aria-label="Your messages"
							className="w-full"
							orientation={choiceOrientation}
							selectedIndex={selectedSelfMessageAlignmentIndex}
						>
							{SELF_MESSAGE_ALIGNMENT_CHOICES.map((choice, index) => (
								<RadioItem
									className="min-w-0 flex-1 px-3 py-3"
									description={
										<span className="flex min-w-0 flex-col gap-2">
											<span>{choice.description}</span>
											<SelfMessageAlignmentPreview alignment={choice.value} />
										</span>
									}
									index={index}
									key={choice.value}
									label={choice.label}
									onSelect={() => {
										writeSpaceSelfMessageAlignmentPreference(choice.value);
										setSelfMessageAlignment(choice.value);
									}}
									selected={mounted && selfMessageAlignment === choice.value}
								/>
							))}
						</RadioGroup>
					}
					description="Choose which side your messages appear on. Applies to every Space and Center Agent conversation. Saved in this browser."
					label="Your messages"
					layout="stacked"
					showDivider={false}
				/>
				<SettingsRow
					control={
						<RadioGroup
							aria-label="History slider"
							className="w-full"
							orientation={choiceOrientation}
							selectedIndex={
								mounted
									? HISTORY_SLIDER_CHOICES.findIndex(
											(choice) => choice.enabled === historySlider.enabled
										)
									: -1
							}
						>
							{HISTORY_SLIDER_CHOICES.map((choice, index) => (
								<RadioItem
									className="min-w-0 flex-1 px-3 py-3"
									description={
										<span className="flex min-w-0 flex-col gap-2">
											<span>{choice.description}</span>
											<HistorySliderPreview enabled={choice.enabled} />
										</span>
									}
									index={index}
									key={choice.label}
									label={choice.label}
									onSelect={() => historySlider.setEnabled(choice.enabled)}
									selected={mounted && historySlider.enabled === choice.enabled}
								/>
							))}
						</RadioGroup>
					}
					description="Browse older messages in a Space. Shown only when older history is available. Saved in this browser."
					label="History slider"
					layout="stacked"
					showDivider
				/>
			</PreferenceGroup>
			<PreferenceGroup title="Conversation list">
				<SettingsRow
					control={
						profileId ? (
							<RadioGroup
								aria-label="Message previews"
								className="w-full"
								orientation={choiceOrientation}
								selectedIndex={previews.showMessagePreviews ? 0 : 1}
							>
								{[true, false].map((shown, index) => (
									<RadioItem
										className="min-w-0 flex-1 px-3 py-3"
										description={<MessagePreview shown={shown} />}
										index={index}
										key={String(shown)}
										label={shown ? "Show previews" : "Hide previews"}
										onSelect={() => previews.setShowMessagePreviews(shown)}
										selected={shown === previews.showMessagePreviews}
									/>
								))}
							</RadioGroup>
						) : (
							<Skeleton className="h-24 w-full" />
						)
					}
					description={`Show the latest message below each conversation in the sidebar and lists. Saved in this browser for ${currentOrganization.name}.`}
					label="Message previews"
					layout="stacked"
				/>
			</PreferenceGroup>
		</>
	);
}

function PreferenceGroup(input: { title: string; children: ReactNode }) {
	return (
		<section className="space-y-5">
			<h2 className="font-medium text-muted-foreground text-sm">
				{input.title}
			</h2>
			{input.children}
		</section>
	);
}
function MessagePreview(input: { shown: boolean }) {
	return (
		<span
			aria-hidden="true"
			className="flex h-20 w-full flex-col justify-center gap-2 rounded-lg border border-border bg-background px-3"
		>
			{["Design review", "Project updates"].map((title) => (
				<span className="flex items-center gap-2" key={title}>
					<span className="size-5 shrink-0 rounded-full bg-muted" />
					<span className="flex min-w-0 flex-1 flex-col gap-1">
						<span className="text-[10px] text-foreground">{title}</span>
						{input.shown && (
							<span className="h-1 w-3/4 rounded-sm bg-muted-foreground/30" />
						)}
					</span>
				</span>
			))}
		</span>
	);
}

function SendShortcutPreview(input: { modified: boolean }) {
	return (
		<ComposerPreview
			message="Review this draft."
			shortcut={input.modified ? "Cmd/Ctrl + Enter" : "Enter"}
		/>
	);
}

function AutomaticWakePreview(input: { enabled: boolean }) {
	return (
		<div aria-hidden="true" className="max-w-2xl space-y-2">
			<div className="flex items-center gap-1.5 text-muted-foreground text-xs">
				<UserCircleIcon className="size-4" />
				<span>You</span>
				<PlusIcon className="mx-1 size-3" />
				<RobotIcon className="size-4" />
				<span>1 Agent</span>
				<span className="ml-auto text-[10px]">Example</span>
			</div>
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
				<ComposerPreview
					message={
						<>
							{!input.enabled && (
								<span className="mr-1 rounded bg-primary/10 px-1 py-0.5 text-foreground">
									@Agent
								</span>
							)}
							Review this draft.
						</>
					}
				/>
				<div className="flex shrink-0 items-center gap-3 text-xs">
					<ArrowRightIcon className="size-4 text-muted-foreground" />
					<span className="flex flex-col gap-1">
						<span className="flex items-center gap-1.5 text-foreground">
							<RobotIcon className="size-4" />
							Agent responds
						</span>
						<span className="text-muted-foreground">
							{input.enabled ? "No @mention needed" : "@mention required"}
						</span>
					</span>
				</div>
			</div>
		</div>
	);
}

function ComposerPreview(input: { message: ReactNode; shortcut?: string }) {
	return (
		<span
			aria-hidden="true"
			className="composer-surface flex h-24 w-full flex-col justify-between gap-3 p-3"
		>
			<span className="text-foreground text-xs">{input.message}</span>
			<span className="flex items-center justify-between gap-3">
				<span className="flex items-center gap-3 text-muted-foreground">
					<PlusIcon className="size-3.5" />
					<span className="text-sm">@</span>
				</span>
				<span className="flex items-center gap-2">
					{input.shortcut && (
						<kbd className="rounded border border-border bg-background/50 px-1.5 py-0.5 text-[10px] text-muted-foreground">
							{input.shortcut}
						</kbd>
					)}
					<span
						className={cn(
							buttonVariants({ size: "icon-sm" }),
							"pointer-events-none max-lg:min-h-0 max-lg:min-w-0"
						)}
					>
						<ArrowUpIcon weight="bold" />
					</span>
				</span>
			</span>
		</span>
	);
}
function SelfMessageAlignmentPreview(input: {
	alignment: SpaceSelfMessageAlignment;
}) {
	const selfAlignmentClassName =
		input.alignment === "left" ? "items-start" : "items-end";
	const actionsClassName = input.alignment === "left" ? "right-1" : "left-1";
	const bubbleWidthClassName = input.alignment === "left" ? "w-full" : "w-2/3";

	return (
		<span
			aria-hidden="true"
			className="flex h-20 w-full overflow-hidden border border-border bg-background p-2"
			data-self-message-alignment-preview={input.alignment}
		>
			<span className="flex min-w-0 flex-1 flex-col gap-1.5">
				<span className="h-2 w-1/2 bg-muted-foreground/25" />
				<span
					className={`relative flex w-full flex-col gap-1 ${selfAlignmentClassName}`}
				>
					<span className={`absolute top-0 flex gap-0.5 ${actionsClassName}`}>
						<span className="size-1 bg-muted-foreground/35" />
						<span className="size-1 bg-muted-foreground/35" />
						<span className="size-1 bg-muted-foreground/35" />
					</span>
					<span
						className={`mt-2 flex h-5 flex-col justify-center gap-1 rounded-md bg-muted/60 px-1.5 ${bubbleWidthClassName}`}
						data-slot="self-message-preview-bubble"
					>
						<span className="h-1 w-4/5 rounded-sm bg-muted-foreground/35" />
						<span className="h-1 w-3/5 rounded-sm bg-muted-foreground/25" />
					</span>
					<span className="h-1.5 w-2/5 bg-destructive/30" />
				</span>
			</span>
		</span>
	);
}

function ConversationLayoutPreview(input: { layout: SpaceConversationLayout }) {
	const conversationColumnClassName =
		input.layout === "centered" ? "mx-auto w-2/3" : "w-full";

	return (
		<span
			aria-hidden="true"
			className="flex h-20 w-full overflow-hidden border border-border bg-background"
			data-conversation-layout-preview={input.layout}
		>
			<span className="w-3 shrink-0 border-border border-r bg-muted/70" />
			<span className="flex min-w-0 flex-1 p-2">
				<span
					className={`flex min-w-0 flex-col gap-1.5 ${conversationColumnClassName}`}
				>
					<span className="h-1.5 w-3/5 bg-muted-foreground/30" />
					<span className="h-1.5 w-4/5 self-end bg-muted-foreground/20" />
					<span className="h-1.5 w-2/3 bg-muted-foreground/30" />
					<span className="mt-auto h-3 w-full border border-border bg-muted/60" />
				</span>
			</span>
			<span className="w-4 shrink-0 border-border border-l bg-muted/40" />
		</span>
	);
}

function HistorySliderPreview(input: { enabled: boolean }) {
	return (
		<span
			aria-hidden="true"
			className="flex h-20 w-full overflow-hidden border border-border bg-background"
			data-history-slider-preview={input.enabled ? "show" : "hide"}
		>
			<span className="w-3 shrink-0 border-border border-r bg-muted/70" />
			{input.enabled && (
				<span className="flex w-4 shrink-0 flex-col justify-center gap-0.5 pl-1">
					{[0, 1, 2, 3, 4, 5, 6, 7, 8].map((tick) => (
						<span
							className={`h-0.5 ${tick === 4 ? "w-2.5 bg-foreground/70" : "w-1 bg-muted-foreground/40"}`}
							key={tick}
						/>
					))}
				</span>
			)}
			<span className="flex min-w-0 flex-1 flex-col gap-1.5 p-2">
				<span className="h-1.5 w-3/5 bg-muted-foreground/30" />
				<span className="h-1.5 w-4/5 self-end bg-muted-foreground/20" />
				<span className="h-1.5 w-2/3 bg-muted-foreground/30" />
				<span className="mt-auto h-3 w-full border border-border bg-muted/60" />
			</span>
		</span>
	);
}
