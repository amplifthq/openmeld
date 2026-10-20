import { supportsExecutionContextSelection } from "@openmeld/agent-runtime";
import {
	isHostedAgentControllerRef,
	resolvePublicAgentAvailabilityCopy,
} from "@openmeld/schemas";
import type { WakeDeviceWait } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowUpIcon } from "@phosphor-icons/react";
import type { ComponentProps, ReactNode } from "react";
import { useState } from "react";
import type { SpaceAgentRequestMentions } from "#/components/agent-access/space-agent-request-mentions";
import {
	PromptInput,
	PromptInputAction,
	PromptInputActions,
} from "#/components/ibelick/prompt-input";
import { AgentProfileUsage } from "#/components/profiles/agent-profile-usage";
import {
	formatPublicWakeabilityReason,
	usePublicWakeabilityReason,
} from "#/lib/agents/agent-viewer-access";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import {
	isSpaceComposerFileFailed,
	type SpaceComposerFile,
} from "#/lib/spaces/composer-attachment";
import type { ComposerFileDraftCleanup } from "#/lib/spaces/composer-file-drafts";
import { isQuotaWakeFailure } from "#/lib/spaces/wake-failure-display";
import { SpaceComposerAgentOptionsWithProject } from "./space-composer-agent-options";
import {
	SpaceComposerAddMenu,
	SpaceComposerAttachmentRecovery,
	SpaceComposerFileTray,
	useSpaceComposerFileInput,
} from "./space-composer-attachments";
import { SpaceComposerBlockedWakeRecoveryAction } from "./space-composer-blocked-wake-recovery-action";
import {
	resolveSpaceComposerPolicy,
	type SpaceComposerConversationKind,
	type SpaceComposerPlacement,
} from "./space-composer-copy";
import {
	canSubmitSpaceComposerDeviceWait,
	createSpaceComposerDeviceWait,
	type SpaceComposerSendOptions,
} from "./space-composer-device-wait";
import {
	SpaceComposerEditor,
	type SpaceComposerEditorChange,
	type SpaceComposerInputRef,
} from "./space-composer-editor";
import { SpaceComposerEditorBoundary } from "./space-composer-editor-boundary";
import type {
	SpaceComposerTaskChoice,
	SpaceTaskSource,
} from "./space-composer-task-menu";
import {
	type SpaceTaskDraft,
	SpaceTaskDraftFields,
} from "./space-task-draft-fields";
import { useSpaceWakeRecommendation } from "./space-wake-recommendation";
import type {
	SpaceComposerAddressingTarget,
	SpaceMentionPickerItem,
} from "./use-space-mention-authoring";

export type SpaceComposerProps = {
	organizationId?: string | null;
	taskSources?: readonly SpaceTaskSource[];
	members?: { state: "loading" | "error"; onRetry: () => void };
	recovery?: Omit<
		ComponentProps<typeof SpaceComposerBlockedWakeRecoveryAction>,
		"blockedWakeProfileId"
	> & { blockedWakeProfileId?: string | null };
	actions: {
		onAddPeopleOrAgents?: () => void;
		onAddFiles?: (files: readonly File[]) => Promise<void>;
		onEditorChange: (change: SpaceComposerEditorChange) => void;
		onMentionButtonClick?: () => void;
		onRemoveFile?: (localId: string) => void;
		onRetryFile?: (localId: string) => void;
		onRetryFileCleanup?: (localId: string) => void;
		onRetryFileRestoration?: () => void;
		onSubmit: (options?: SpaceComposerSendOptions) => void;
		onBlur?: () => void;
		onFocus?: () => void;
	};
	availability: {
		canUploadFiles?: boolean;
		canSendMessage: boolean;
		fileLimitReached: boolean;
		isSendingMessage: boolean;
		sendBlocked: boolean;
	};
	composerRef: SpaceComposerInputRef;
	content: {
		addressingTargets: readonly SpaceComposerAddressingTarget[];
		authoredMentions: readonly ComposerDraftAuthoredMention[];
		files: readonly SpaceComposerFile[];
		fileCleanup?: readonly ComposerFileDraftCleanup[];
		fileRestorationError?: unknown | null;
		hasAuthoredMentions?: boolean;
		agentRequestMentions?: SpaceAgentRequestMentions;
		mentionPickerItems: readonly SpaceMentionPickerItem[];
		mentionEmptyMessage?: string;
		text: string;
	};
	context: {
		conversationKind: SpaceComposerConversationKind;
		placement: SpaceComposerPlacement;
		readOnly?: boolean;
		readOnlyPlaceholder?: string;
		/**
		 * Membership is not known yet: render a neutral bar instead of an
		 * input that may turn into a Join prompt a moment later.
		 */
		accessPending?: boolean;
		/** The first message to a teammate's Agent is a request to its owner. */
		requestPlaceholder?: string;
		targetName?: string | null;
	};
	presentation?: {
		className?: string;
		dataSlot?: string;
		maxHeight?: number;
	};
	slots?: {
		attachmentAction?: ReactNode;
		/**
		 * Composer trays stack top to bottom: Agent requests, pending Agent
		 * actions, queued messages. Each tucks under the next one.
		 */
		agentRequests?: ReactNode;
		pendingActionSurface?: ReactNode;
		queuedMessages?: ReactNode;
		beforeInput?: ReactNode;
		beforePrimaryAction?: ReactNode;
		error?: ReactNode;
		primaryAction?: ReactNode;
		profileControl?: ReactNode;
		status?: ReactNode;
	};
	centerAgentProfileId: string | null;
	capabilities?: {
		attachments?: boolean;
		mentions?: boolean;
	};
};

const ignoreFiles = (_files: readonly File[]): Promise<void> =>
	Promise.resolve();
const ignoreFileRemoval = (_localId: string): void => undefined;
const ignoreFileRestoration = (): void => undefined;

function SpaceComposerAttachmentAction(input: {
	children: ReactNode;
	enabled: boolean;
	override?: ReactNode;
}) {
	if (input.override !== undefined) {
		return input.override;
	}
	return input.enabled ? input.children : null;
}

function SpaceComposerAttachmentState({
	input,
}: {
	input: SpaceComposerProps;
}) {
	return (
		<>
			<SpaceComposerFileTray
				disabled={input.availability.isSendingMessage}
				files={input.content.files}
				onRemove={input.actions.onRemoveFile ?? ignoreFileRemoval}
				onRetry={input.actions.onRetryFile}
			/>
			<SpaceComposerAttachmentRecovery
				cleanup={input.content.fileCleanup ?? []}
				onRetryCleanup={input.actions.onRetryFileCleanup ?? ignoreFileRemoval}
				onRetryRestoration={
					input.actions.onRetryFileRestoration ?? ignoreFileRestoration
				}
				restorationError={input.content.fileRestorationError ?? null}
			/>
		</>
	);
}

function useComposerWakeSuggestion(input: SpaceComposerProps) {
	const recommendations = useSpaceWakeRecommendation();
	const candidate =
		(input.context.placement === "thread" ||
			input.context.conversationKind === "space") &&
		input.availability.canSendMessage &&
		input.content.authoredMentions.length === 0
			? recommendations?.candidate
			: null;
	const recommended = candidate
		? input.content.mentionPickerItems.find(
				(item) =>
					item.suggestion.profileId === candidate.profileId &&
					item.suggestion.allowedRelations.wake &&
					item.suggestion.wakeAvailability.status === "ready"
			)
		: undefined;
	const acceptRecommendation = () => {
		if (!recommended) {
			return;
		}
		input.composerRef.current?.acceptWakeRecommendation?.(
			recommended.suggestion.profileId
		);
		recommendations?.dismiss();
	};
	return { recommendations, recommended, acceptRecommendation };
}

function useComposerTaskChoice(input: SpaceComposerProps) {
	const [choices, setChoices] = useState<
		Record<string, SpaceComposerTaskChoice | undefined>
	>({});
	return {
		renderAgentOptions: (profileId: string) => {
			const target = input.content.addressingTargets.find(
				(item) => item.profileId === profileId
			);
			if (
				!(
					target && supportsExecutionContextSelection(target.agentControllerRef)
				)
			) {
				return null;
			}
			return (
				<SpaceComposerAgentOptionsWithProject
					choice={choices[profileId]}
					onChange={(choice) =>
						setChoices((current) => ({ ...current, [profileId]: choice }))
					}
					organizationId={input.organizationId}
					sources={input.taskSources ?? []}
					supportsAccessRestrictions={
						target.agentControllerRef !== "builtin:antigravity"
					}
					supportsCurrentFolder={
						target.agentControllerRef !== "builtin:claude-code"
					}
					supportsFork={target.agentControllerRef !== "builtin:antigravity"}
					targetProfileId={profileId}
				/>
			);
		},
		prepare: (options: SpaceComposerSendOptions): SpaceComposerSendOptions => {
			const entries = input.content.addressingTargets.flatMap((target) => {
				const choice = choices[target.profileId];
				return target.relation === "wake" && choice
					? [[target.profileId, choice.selection] as const]
					: [];
			});
			if (entries.length === 0) {
				return options;
			}
			return {
				...options,
				contextSelections: Object.fromEntries(entries),
				onMessageStaged: (id) => {
					setChoices({});
					options.onMessageStaged?.(id);
				},
			};
		},
	};
}

function isTaskDraftDisabled(
	input: SpaceComposerProps,
	draft: SpaceTaskDraft | null
) {
	return (
		!(draft?.title.trim() && input.availability.canSendMessage) ||
		input.availability.isSendingMessage ||
		input.content.files.some((file) => file.status !== "ready")
	);
}
function createComposerTaskDraft(input: SpaceComposerProps): SpaceTaskDraft {
	const targets = input.content.addressingTargets.filter(
		(target) => target.relation === "wake"
	);
	return {
		title: input.content.text.trim().slice(0, 200),
		assigneeProfileId: targets.length === 1 ? targets[0]?.profileId : undefined,
	};
}
function ComposerTaskSubmit(input: {
	composer: SpaceComposerProps;
	disabled: boolean;
	onSubmit: () => void;
}) {
	return (
		<Button
			disabled={input.disabled}
			onClick={input.onSubmit}
			size="sm"
			type="button"
		>
			{input.composer.content.addressingTargets.some(
				(target) => target.relation === "wake"
			)
				? "Create and start"
				: "Create task"}
		</Button>
	);
}
function taskCreateAction(draft: SpaceTaskDraft | null, onCreate: () => void) {
	return draft ? undefined : onCreate;
}
function ComposerTaskDraft(input: {
	composer: SpaceComposerProps;
	draft: SpaceTaskDraft | null;
	onChange: (draft: SpaceTaskDraft | null) => void;
}) {
	if (!input.draft) {
		return null;
	}
	return (
		<SpaceTaskDraftFields
			disabled={input.composer.availability.isSendingMessage}
			draft={input.draft}
			members={input.composer.content.mentionPickerItems.map(
				(item) => item.suggestion
			)}
			onChange={input.onChange}
			onClose={() => input.onChange(null)}
		/>
	);
}
function composerPlaceholder(
	draft: SpaceTaskDraft | null,
	placeholder: string
) {
	return draft ? "Describe the work…" : placeholder;
}

/** Undefined shows the input; null shows the neutral loading bar. */
function resolveReadOnlyBarPlaceholder(
	context: SpaceComposerProps["context"],
	placeholder: string
): string | null | undefined {
	if (context.accessPending) {
		return null;
	}
	return context.readOnly ? placeholder : undefined;
}

/**
 * The bar shown instead of the input: a Join prompt, a deleted Space, or a
 * neutral placeholder while membership is still loading. Composer trays tuck
 * under it exactly as they tuck under the input.
 */
function SpaceComposerReadOnlyBar(input: {
	composer: SpaceComposerProps;
	placeholder: string | null;
}) {
	const { composer } = input;
	const pending = input.placeholder === null;
	return (
		<div
			className={composer.presentation?.className}
			data-slot={composer.presentation?.dataSlot}
		>
			{/* An Agent owner who only observes still answers their Agent. */}
			{composer.slots?.agentRequests}
			{composer.slots?.pendingActionSurface}
			<div
				aria-busy={pending || undefined}
				className="relative flex min-h-14 items-center justify-between gap-4 rounded-lg border border-border bg-background p-3"
				data-slot="space-composer-read-only-bar"
			>
				{pending ? null : (
					<>
						<p className="text-muted-foreground text-sm">{input.placeholder}</p>
						{composer.slots?.primaryAction}
					</>
				)}
			</div>
			{pending ? null : composer.slots?.error}
		</div>
	);
}

export function SpaceComposer(input: SpaceComposerProps) {
	const [editorFailed, setEditorFailed] = useState(false);
	const [taskDraft, setTaskDraft] = useState<SpaceTaskDraft | null>(null);
	const taskDisabled = isTaskDraftDisabled(input, taskDraft);
	const taskContext = useComposerTaskChoice(input);
	const membersPending = hasPendingComposerMembers(input);
	const { recommendations, recommended, acceptRecommendation } =
		useComposerWakeSuggestion(input);
	const viewerUserId = useComposerViewerUserId();
	const blockedWakeViewer: BlockedWakeViewer = {
		publicReasonText: null,
		userId: viewerUserId,
	};
	const deviceWaitPresentation = buildSpaceComposerDeviceWaitPresentation(
		input,
		blockedWakeViewer
	);
	const submit = () => {
		if (
			deviceWaitPresentation.disabled ||
			membersPending ||
			(taskDraft && taskDisabled)
		) {
			return;
		}
		const deviceWait = deviceWaitPresentation.target
			? createSpaceComposerDeviceWait(deviceWaitPresentation.target)
			: undefined;
		if (deviceWaitPresentation.target && !deviceWait) {
			return;
		}
		const options = taskContext.prepare({
			...(taskDraft
				? { taskDraft, onMessageStaged: () => setTaskDraft(null) }
				: {}),
			...(deviceWait ? { deviceWait } : {}),
			...(!taskDraft &&
			recommendations &&
			(recommendations.candidate || recommendations.nudge)
				? {
						onMessageStaged: (clientMessageId: string) =>
							recommendations.recordSend(
								recommended?.suggestion.profileId ?? null,
								clientMessageId
							),
					}
				: {}),
		});
		// Return focus within the gesture; network completion must not steal it.
		input.composerRef.current?.focus();
		if (Object.keys(options).length > 0) {
			input.actions.onSubmit(options);
		} else {
			input.actions.onSubmit();
		}
	};

	const policy = resolveSpaceComposerPolicy({
		canSendMessage: input.availability.canSendMessage,
		conversationKind: input.context.conversationKind,
		hasAuthoredMentions: input.content.hasAuthoredMentions,
		isSendingMessage: input.availability.isSendingMessage,
		placement: input.context.placement,
		readOnlyPlaceholder: input.context.readOnlyPlaceholder,
		requestPlaceholder: input.context.requestPlaceholder,
		targetName: input.context.targetName,
		text: input.content.text,
	});
	const uploadsDisabled =
		input.availability.isSendingMessage ||
		!(input.availability.canUploadFiles ?? input.availability.canSendMessage);
	const {
		addFiles,
		handleDragLeave,
		handleDragOver,
		handleDrop,
		handlePaste,
		isDraggingFiles,
	} = useSpaceComposerFileInput({
		disabled: uploadsDisabled,
		onAddFiles: input.actions.onAddFiles ?? ignoreFiles,
	});
	const fileHint = resolveSpaceComposerFileHint({
		files: input.content.files,
		fileLimitReached: input.availability.fileLimitReached,
	});
	const blockedWakeHint = resolveSpaceComposerBlockedWakeHint(
		input.content.addressingTargets,
		undefined,
		blockedWakeViewer
	);
	const composerHint =
		fileHint ??
		resolvePerAgentComposerHint(
			input.content.addressingTargets,
			policy.wakeTextHint
		);
	const blockedWakeTarget = input.content.addressingTargets.find(
		(target) =>
			isBlockedWakeTarget(target) && !createSpaceComposerDeviceWait(target)
	);
	const accessHint = input.availability.canSendMessage
		? null
		: policy.placeholder;
	let composerHintClassName = "text-muted-foreground";
	if (policy.wakeTextHint) {
		composerHintClassName = "text-foreground";
	}
	const primaryAction = renderSpaceComposerSendAction({
		availability: input.availability,
		waitForComputer: Boolean(deviceWaitPresentation.target),
		waitTooltip: deviceWaitPresentation.target
			? `${deviceWaitPresentation.target.profileName}’s computer is offline. The task will run when it reconnects.`
			: null,
		waitDisabled: deviceWaitPresentation.disabled || membersPending,
		onSubmit: submit,
		override: taskDraft ? (
			<ComposerTaskSubmit
				composer={input}
				disabled={
					taskDisabled || membersPending || deviceWaitPresentation.disabled
				}
				onSubmit={submit}
			/>
		) : (
			input.slots?.primaryAction
		),
		policy,
	});
	const feedbackLayout = resolveComposerFeedbackLayout(
		input,
		membersPending,
		Boolean(deviceWaitPresentation.hint)
	);
	const readOnlyBar = resolveReadOnlyBarPlaceholder(
		input.context,
		policy.placeholder
	);
	if (readOnlyBar !== undefined) {
		return (
			<SpaceComposerReadOnlyBar composer={input} placeholder={readOnlyBar} />
		);
	}

	return (
		<div
			className={input.presentation?.className}
			data-slot={input.presentation?.dataSlot}
		>
			{input.slots?.agentRequests}
			{input.slots?.pendingActionSurface}
			{input.slots?.queuedMessages}
			<div className="relative">
				<SpaceComposerFileDropOverlay visible={isDraggingFiles} />
				<PromptInput
					className="w-full"
					maxHeight={input.presentation?.maxHeight ?? 240}
					onSubmit={submit}
					value={input.content.text}
				>
					{input.slots?.beforeInput}
					<ComposerTaskDraft
						composer={input}
						draft={taskDraft}
						onChange={setTaskDraft}
					/>
					<SpaceComposerAttachmentState input={input} />
					<SpaceComposerEditorBoundary
						ariaLabel={policy.accessibleName}
						maxHeight={input.presentation?.maxHeight}
						onBlur={input.actions.onBlur}
						onChange={input.actions.onEditorChange}
						onFailure={() => setEditorFailed(true)}
						onFocus={input.actions.onFocus}
						onSend={submit}
						placeholder={composerPlaceholder(taskDraft, policy.placeholder)}
						text={input.content.text}
					>
						<SpaceComposerEditor
							addressingTargets={input.content.addressingTargets}
							agentRequestMentions={input.content.agentRequestMentions}
							ariaLabel={policy.accessibleName}
							authoredMentions={input.content.authoredMentions}
							centerAgentProfileId={input.centerAgentProfileId}
							composerRef={input.composerRef}
							maxHeight={input.presentation?.maxHeight}
							mentionEmptyMessage={input.content.mentionEmptyMessage}
							mentionPickerItems={input.content.mentionPickerItems}
							onBlur={input.actions.onBlur}
							onChange={input.actions.onEditorChange}
							onDragEnter={handleDragOver}
							onDragLeave={handleDragLeave}
							onDragOver={handleDragOver}
							onDrop={handleDrop}
							onFocus={input.actions.onFocus}
							onPaste={handlePaste}
							onSend={submit}
							placeholder={composerPlaceholder(taskDraft, policy.placeholder)}
							renderAgentOptions={taskContext.renderAgentOptions}
							text={input.content.text}
							wakeRecommendation={
								recommended
									? {
											profileId: recommended.suggestion.profileId,
											onAccept: acceptRecommendation,
											onDismiss: () => recommendations?.dismiss(),
										}
									: undefined
							}
						/>
					</SpaceComposerEditorBoundary>
					<PromptInputActions className="min-w-0 justify-between gap-3 pt-2">
						<div
							className={cn(
								"flex min-w-0 items-center gap-0",
								feedbackLayout.leading
							)}
						>
							<SpaceComposerAttachmentAction
								enabled={input.capabilities?.attachments !== false}
								override={input.slots?.attachmentAction}
							>
								<SpaceComposerAddMenu
									addFiles={addFiles}
									disabled={uploadsDisabled}
									disabledReason={
										input.availability.isSendingMessage
											? "Wait for this message to finish sending."
											: (accessHint ?? "Files aren't available yet.")
									}
									limitReached={input.availability.fileLimitReached}
									onAddPeopleOrAgents={input.actions.onAddPeopleOrAgents}
									onCreateTask={taskCreateAction(taskDraft, () =>
										setTaskDraft(createComposerTaskDraft(input))
									)}
								/>
							</SpaceComposerAttachmentAction>
							{!editorFailed &&
							policy.showMentionButton &&
							input.capabilities?.mentions !== false ? (
								<Button
									aria-label="Mention a member"
									className="text-base"
									onClick={input.actions.onMentionButtonClick}
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									<span aria-hidden="true">@</span>
								</Button>
							) : null}
							{input.slots?.status ??
								(composerHint ? (
									<p
										aria-live="polite"
										className={cn(
											"min-w-0 text-xs leading-5 max-sm:line-clamp-2 max-sm:whitespace-normal sm:truncate",
											composerHintClassName
										)}
									>
										{composerHint}
									</p>
								) : null)}
							<ComposerRecovery
								hint={blockedWakeHint}
								recovery={input.recovery}
								target={blockedWakeTarget}
								viewerUserId={viewerUserId}
							/>
							{input.content.addressingTargets
								.filter(
									(target) =>
										target.relation === "wake" &&
										target.wakeAvailability.reasonCodes.some(isQuotaWakeFailure)
								)
								.map((target) => (
									<span
										className="text-muted-foreground text-xs"
										key={target.profileId}
									>
										{target.profileName}:{" "}
										<AgentProfileUsage
											profileId={target.profileId}
											variant="reset"
										/>
									</span>
								))}
						</div>
						<div
							className={cn(
								"flex min-w-0 items-center justify-end gap-2",
								feedbackLayout.trailing
							)}
						>
							{input.slots?.profileControl}
							{input.slots?.beforePrimaryAction}
							{deviceWaitPresentation.hint ? (
								<TooltipHint content={deviceWaitPresentation.hint}>
									<span className="min-w-0 truncate text-muted-foreground text-xs">
										{deviceWaitPresentation.hint}
									</span>
								</TooltipHint>
							) : null}
							<SpaceComposerMentionOnlyAction
								{...input}
								viewerUserId={viewerUserId}
							/>
							<div className="min-w-0 break-words text-right empty:hidden">
								<ComposerFeedback
									error={input.slots?.error}
									members={input.members}
									membersPending={membersPending}
								/>
							</div>
							{primaryAction}
						</div>
					</PromptInputActions>
				</PromptInput>
			</div>
		</div>
	);
}

function hasPendingComposerMembers(input: SpaceComposerProps) {
	return Boolean(input.members && input.content.authoredMentions.length > 0);
}

function resolveComposerFeedbackLayout(
	input: SpaceComposerProps,
	membersPending: boolean,
	hasDeviceWaitHint: boolean
) {
	// Trailing text truncates in the remaining width; the leading buttons
	// never shrink under it.
	if (
		hasDeviceWaitHint ||
		input.slots?.error ||
		(membersPending && input.members?.state === "error")
	) {
		return { leading: "shrink-0", trailing: "flex-1" };
	}
	return { leading: "flex-1", trailing: "" };
}

function ComposerFeedback(input: {
	members: SpaceComposerProps["members"];
	membersPending: boolean;
	error: ReactNode;
}) {
	if (!input.membersPending || input.members?.state !== "error") {
		return input.error;
	}
	return (
		<output className="text-muted-foreground text-sm">
			Couldn't load members.{" "}
			<button
				className="underline underline-offset-2"
				onClick={input.members.onRetry}
				type="button"
			>
				Retry
			</button>
		</output>
	);
}

function ComposerRecovery(input: {
	hint: string | null;
	recovery: SpaceComposerProps["recovery"];
	target: SpaceComposerAddressingTarget | undefined;
	viewerUserId: string | null;
}) {
	// A retained failed-send target is not authority for the current draft.
	const profileId = input.target?.profileId;
	// Only the owner can fix a colleague's Agent; the viewer sees the reason.
	if (
		input.target &&
		input.hint &&
		isColleagueAgentTarget(input.target, input.viewerUserId)
	) {
		return (
			<ColleagueBlockedWakeHint
				target={input.target}
				viewerUserId={input.viewerUserId}
			/>
		);
	}
	if (!(profileId && input.recovery)) {
		return input.target && input.hint ? (
			<span className="ml-2 text-muted-foreground text-xs">{input.hint}</span>
		) : null;
	}
	return (
		<SpaceComposerBlockedWakeRecoveryAction
			{...input.recovery}
			blockedWakeProfileId={profileId}
			hint={input.hint}
		/>
	);
}

function isBlockedWakeTarget(target: SpaceComposerAddressingTarget): boolean {
	return (
		target.relation === "wake" &&
		target.wakeAvailability.status !== "ready" &&
		target.wakeAvailability.status !== "preparing"
	);
}

function useComposerViewerUserId(): string | null {
	return useOptionalAppOrganization()?.currentUserId ?? null;
}

/** The neutral hint, with the public reason once the shared overview has it. */
function ColleagueBlockedWakeHint(input: {
	target: SpaceComposerAddressingTarget;
	viewerUserId: string | null;
}) {
	const publicReason = usePublicWakeabilityReason({
		enabled: true,
		profileId: input.target.profileId,
	});
	const hint = resolveSpaceComposerBlockedWakeHint([input.target], undefined, {
		publicReasonText: publicReason
			? formatPublicWakeabilityReason(publicReason)
			: null,
		userId: input.viewerUserId,
	});
	return hint ? (
		<span className="ml-2 text-muted-foreground text-xs">{hint}</span>
	) : null;
}

/** Who is composing, so a colleague's Agent shows only the public reason. */
type BlockedWakeViewer = {
	publicReasonText: string | null;
	userId: string | null;
};

/**
 * A colleague's Agent: owned by a person other than the viewer. Its owner's
 * setup details and fix steps are not the viewer's to see or act on
 * (developing/product/space-collaboration.md).
 */
export function isColleagueAgentTarget(
	target: Pick<SpaceComposerAddressingTarget, "ownerUserId">,
	viewerUserId: string | null
): boolean {
	return Boolean(
		viewerUserId && target.ownerUserId && target.ownerUserId !== viewerUserId
	);
}

/** Whether the draft wakes a colleague's Agent that can't take work now. */
export function hasBlockedColleagueWake(
	targets: readonly SpaceComposerAddressingTarget[],
	viewerUserId: string | null
): boolean {
	return targets.some(
		(target) =>
			isBlockedWakeTarget(target) &&
			!createSpaceComposerDeviceWait(target) &&
			isColleagueAgentTarget(target, viewerUserId)
	);
}

export function resolveSpaceComposerBlockedWakeHint(
	targets: readonly SpaceComposerAddressingTarget[],
	deviceWait?: WakeDeviceWait,
	viewer?: BlockedWakeViewer
): string | null {
	const blockedWakeTarget = targets.find(
		(target) =>
			isBlockedWakeTarget(target) &&
			!canSubmitSpaceComposerDeviceWait(target, deviceWait)
	);
	if (!blockedWakeTarget) {
		return null;
	}
	if (viewer && isColleagueAgentTarget(blockedWakeTarget, viewer.userId)) {
		return `${blockedWakeTarget.profileName} can’t start work right now${
			viewer.publicReasonText ? ` · ${viewer.publicReasonText}` : ""
		}`;
	}

	const reason = blockedWakeTarget.wakeAvailability.reasonText?.trim();
	const compactReason = resolvePublicAgentAvailabilityCopy(
		blockedWakeTarget.wakeAvailability.reasonCodes[0]
	)?.availabilityTooltip;
	return (
		compactReason ||
		reason ||
		`${blockedWakeTarget.profileName} can't reply right now. Change Wake to Reference or try again.`
	);
}

function resolvePerAgentComposerHint(
	targets: readonly SpaceComposerAddressingTarget[],
	fallback: string | null
): string | null {
	return targets.filter((target) => target.relation !== "mention").length > 1
		? "Choose Wake or Mention only on each agent."
		: fallback;
}

function SpaceComposerMentionOnlyAction(
	input: SpaceComposerProps & { viewerUserId: string | null }
) {
	const targets = input.content.addressingTargets.filter(
		(target) =>
			isBlockedWakeTarget(target) &&
			!isColleagueAgentTarget(target, input.viewerUserId) &&
			Boolean(target.agentControllerRef) &&
			!isHostedAgentControllerRef(target.agentControllerRef) &&
			target.allowedRelations.reference
	);
	if (!targets.length) {
		return null;
	}
	return (
		<Button
			disabled={
				input.availability.isSendingMessage ||
				!input.availability.canSendMessage
			}
			onClick={() =>
				input.composerRef.current?.setAgentMentionOnly?.(
					targets.map((target) => target.profileId)
				)
			}
			size="sm"
			type="button"
			variant="ghost"
		>
			Mention only instead
		</Button>
	);
}

function renderSpaceComposerSendAction(input: {
	availability: SpaceComposerProps["availability"];
	waitForComputer: boolean;
	waitTooltip: string | null;
	waitDisabled: boolean;
	onSubmit: () => void;
	override: ReactNode;
	policy: ReturnType<typeof resolveSpaceComposerPolicy>;
}): ReactNode {
	if (input.override) {
		return input.override;
	}
	const label = input.waitForComputer
		? "Send and wait"
		: input.policy.sendButtonLabel;
	const labelled = input.waitForComputer || label === "Send request";
	return (
		<PromptInputAction
			className={labelled ? "shrink-0" : "hidden sm:inline-flex"}
			tooltip={input.waitTooltip ?? input.policy.sendButtonTooltip}
		>
			<Button
				aria-label={label}
				disabled={
					input.availability.isSendingMessage ||
					!input.availability.canSendMessage ||
					input.availability.sendBlocked ||
					input.waitDisabled
				}
				onClick={input.onSubmit}
				size={labelled ? "sm" : "icon-sm"}
				type="button"
			>
				{labelled ? label : null}
				<ArrowUpIcon aria-hidden="true" weight="bold" />
			</Button>
		</PromptInputAction>
	);
}

function buildSpaceComposerDeviceWaitPresentation(
	input: SpaceComposerProps,
	viewer: BlockedWakeViewer
): {
	target: SpaceComposerAddressingTarget | null;
	disabled: boolean;
	hint: string | null;
} {
	const ordinary = {
		target: null,
		disabled: false,
		hint: null,
	};
	if (!input.availability.canSendMessage) {
		return ordinary;
	}
	// A colleague's unavailable Agent can't take the message; block sending up
	// front instead of letting it fail (developing/product/space-collaboration.md).
	if (hasBlockedColleagueWake(input.content.addressingTargets, viewer.userId)) {
		return { ...ordinary, disabled: true };
	}
	const targets = input.content.addressingTargets.filter(
		(target) =>
			target.relation === "wake" &&
			Boolean(createSpaceComposerDeviceWait(target))
	);
	// A wait covers one target. Never silently choose between offline Agents
	// or admit another blocked Wake in the same message.
	if (targets.length > 1) {
		return {
			target: null,
			disabled: false,
			hint: "To wait for a computer, send to one offline Agent at a time.",
		};
	}
	const target = targets[0];
	if (!target) {
		return ordinary;
	}
	const hint = resolveSpaceComposerBlockedWakeHint(
		input.content.addressingTargets,
		createSpaceComposerDeviceWait(target),
		viewer
	);
	return {
		target,
		disabled:
			input.availability.isSendingMessage ||
			input.availability.sendBlocked ||
			hint !== null,
		hint: hint ?? "Computer offline · We’ll wait up to 24 hours",
	};
}

function SpaceComposerFileDropOverlay(input: { visible: boolean }) {
	return input.visible ? (
		<div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-md border border-foreground/30 bg-background/90 text-foreground text-sm shadow-sm backdrop-blur-sm">
			Drop files to add them
		</div>
	) : null;
}

export function resolveSpaceComposerFileHint(input: {
	files: readonly SpaceComposerFile[];
	fileLimitReached: boolean;
}): string | null {
	const failedCount = input.files.filter(isSpaceComposerFileFailed).length;
	if (failedCount > 0) {
		const retryableCount = input.files.filter(
			(file) => file.status === "failed" && file.failurePhase !== "validation"
		).length;
		if (retryableCount > 0) {
			return failedCount === 1
				? "Retry or remove the failed attachment to continue."
				: "Retry or remove the failed attachments to continue.";
		}
		return failedCount === 1
			? "Remove the failed attachment to continue."
			: "Remove the failed attachments to continue.";
	}
	if (input.fileLimitReached) {
		return "You can add up to 10 files.";
	}
	return null;
}

export function resolveSpaceComposerSendBlocked(input: {
	files: readonly SpaceComposerFile[];
	text: string;
}): boolean {
	const hasFile = input.files.some((file) => file.status !== "failed");
	return (
		input.files.some(isSpaceComposerFileFailed) ||
		(!hasFile && input.text.trim().length === 0)
	);
}
