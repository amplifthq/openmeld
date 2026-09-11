import { resolvePublicAgentAvailabilityCopy } from "@openmeld/schemas";
import type { WakeDeviceWait } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowUpIcon } from "@phosphor-icons/react";
import type { ComponentProps, ReactNode } from "react";
import {
	PromptInput,
	PromptInputAction,
	PromptInputActions,
} from "#/components/ibelick/prompt-input";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import {
	isSpaceComposerFileFailed,
	type SpaceComposerFile,
} from "#/lib/spaces/composer-attachment";
import {
	SpaceComposerAddMenu,
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
import { useSpaceWakeRecommendation } from "./space-wake-recommendation";
import type {
	SpaceComposerAddressingTarget,
	SpaceMentionPickerItem,
} from "./use-space-mention-authoring";

export type SpaceComposerProps = {
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
		hasAuthoredMentions?: boolean;
		mentionPickerItems: readonly SpaceMentionPickerItem[];
		mentionEmptyMessage?: string;
		text: string;
	};
	context: {
		conversationKind: SpaceComposerConversationKind;
		placement: SpaceComposerPlacement;
		readOnlyPlaceholder?: string;
		targetName?: string | null;
	};
	presentation?: {
		className?: string;
		dataSlot?: string;
		errorClassName?: string;
		maxHeight?: number;
	};
	slots?: {
		pendingActionSurface?: ReactNode;
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

function useComposerWakeSuggestion(input: SpaceComposerProps) {
	const recommendations = useSpaceWakeRecommendation();
	const candidate =
		input.context.placement === "conversation" &&
		input.context.conversationKind === "space" &&
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

export function SpaceComposer(input: SpaceComposerProps) {
	const { recommendations, recommended, acceptRecommendation } =
		useComposerWakeSuggestion(input);
	const deviceWaitPresentation =
		buildSpaceComposerDeviceWaitPresentation(input);
	const submit = () => {
		if (deviceWaitPresentation.disabled) {
			return;
		}
		recommendations?.recordSend(recommended?.suggestion.profileId ?? null);
		input.composerRef.current?.focus();
		if (deviceWaitPresentation.target) {
			const deviceWait = createSpaceComposerDeviceWait(
				deviceWaitPresentation.target
			);
			if (deviceWait) {
				input.actions.onSubmit({ deviceWait });
			}
			return;
		}
		// The send boundary rereads Core before publishing. A cached verdict must
		// not prevent an existing draft from reaching that current check.
		input.actions.onSubmit();
	};

	const policy = resolveSpaceComposerPolicy({
		canSendMessage: input.availability.canSendMessage,
		conversationKind: input.context.conversationKind,
		hasAuthoredMentions: input.content.hasAuthoredMentions,
		isSendingMessage: input.availability.isSendingMessage,
		placement: input.context.placement,
		readOnlyPlaceholder: input.context.readOnlyPlaceholder,
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
		input.content.addressingTargets
	);
	const composerHint = fileHint ?? policy.wakeTextHint;
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
		waitDisabled: deviceWaitPresentation.disabled,
		onSubmit: submit,
		override: input.slots?.primaryAction,
		policy,
	});

	return (
		<div
			className={input.presentation?.className}
			data-slot={input.presentation?.dataSlot}
		>
			{input.slots?.pendingActionSurface}
			<div className="relative">
				<SpaceComposerFileDropOverlay visible={isDraggingFiles} />
				<PromptInput
					className="w-full"
					maxHeight={input.presentation?.maxHeight ?? 240}
					onSubmit={submit}
					value={input.content.text}
				>
					{input.slots?.beforeInput}
					<SpaceComposerFileTray
						disabled={input.availability.isSendingMessage}
						files={input.content.files}
						onRemove={input.actions.onRemoveFile ?? ignoreFileRemoval}
					/>
					<SpaceComposerEditor
						addressingTargets={input.content.addressingTargets}
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
						placeholder={policy.placeholder}
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
					<PromptInputActions className="min-w-0 justify-between gap-3 pt-2">
						<div className="flex flex-1 items-center gap-0">
							{input.capabilities?.attachments !== false ? (
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
								/>
							) : null}
							{policy.showMentionButton &&
							input.capabilities?.mentions !== false ? (
								<Button
									aria-label="Mention a member"
									className="size-8 text-base"
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
							/>
						</div>
						<div className="flex min-w-0 items-center justify-end gap-2">
							{input.slots?.profileControl}
							{input.slots?.beforePrimaryAction}
							{deviceWaitPresentation.hint ? (
								<span
									className="min-w-0 truncate text-muted-foreground text-xs"
									title={deviceWaitPresentation.hint}
								>
									{deviceWaitPresentation.hint}
								</span>
							) : null}
							{primaryAction}
						</div>
					</PromptInputActions>
				</PromptInput>
			</div>
			{input.slots?.error ? (
				<div className={input.presentation?.errorClassName}>
					{input.slots.error}
				</div>
			) : null}
		</div>
	);
}

function ComposerRecovery(input: {
	hint: string | null;
	recovery: SpaceComposerProps["recovery"];
	target: SpaceComposerAddressingTarget | undefined;
}) {
	const profileId =
		input.recovery?.blockedWakeProfileId ?? input.target?.profileId;
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

function resolveSpaceComposerBlockedWakeHint(
	targets: readonly SpaceComposerAddressingTarget[],
	deviceWait?: WakeDeviceWait
): string | null {
	const blockedWakeTarget = targets.find(
		(target) =>
			isBlockedWakeTarget(target) &&
			!canSubmitSpaceComposerDeviceWait(target, deviceWait)
	);
	if (!blockedWakeTarget) {
		return null;
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
	return (
		<PromptInputAction
			className={input.waitForComputer ? "shrink-0" : "hidden sm:inline-flex"}
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
				size={input.waitForComputer ? "sm" : "icon-sm"}
				type="button"
			>
				{input.waitForComputer ? label : null}
				<ArrowUpIcon aria-hidden="true" weight="bold" />
			</Button>
		</PromptInputAction>
	);
}

function buildSpaceComposerDeviceWaitPresentation(input: SpaceComposerProps): {
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
		createSpaceComposerDeviceWait(target)
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
		return failedCount === 1
			? "Remove the failed file to continue."
			: "Remove the failed files to continue.";
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
