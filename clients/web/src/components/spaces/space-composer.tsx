import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowUpIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import {
	PromptInput,
	PromptInputAction,
	PromptInputActions,
} from "#/components/ibelick/prompt-input";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import {
	isSpaceComposerFileFailed,
	isSpaceComposerFileInProgress,
	type SpaceComposerFile,
} from "#/lib/spaces/composer-attachment";
import {
	SpaceComposerFileMenu,
	SpaceComposerFileTray,
	useSpaceComposerFileInput,
} from "./space-composer-attachments";
import {
	resolveSpaceComposerPolicy,
	type SpaceComposerConversationKind,
	type SpaceComposerPlacement,
} from "./space-composer-copy";
import {
	SpaceComposerEditor,
	type SpaceComposerEditorChange,
	type SpaceComposerInputRef,
} from "./space-composer-editor";
import type {
	SpaceComposerAddressingTarget,
	SpaceMentionPickerItem,
} from "./use-space-mention-authoring";

export type SpaceComposerProps = {
	actions: {
		onAddFiles: (files: readonly File[]) => Promise<void>;
		onEditorChange: (change: SpaceComposerEditorChange) => void;
		onMentionButtonClick: () => void;
		onRemoveFile: (localId: string) => void;
		onSubmit: () => void;
	};
	availability: {
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
		beforeInput?: ReactNode;
		error?: ReactNode;
		primaryAction?: ReactNode;
		profileControl?: ReactNode;
	};
	centerAgentProfileId: string | null;
};

export function SpaceComposer(input: SpaceComposerProps) {
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
	const uploadInProgress = input.content.files.some(
		isSpaceComposerFileInProgress
	);
	const composerActionsDisabled =
		input.availability.isSendingMessage || !input.availability.canSendMessage;
	const {
		addFiles,
		handleDragLeave,
		handleDragOver,
		handleDrop,
		handlePaste,
		isDraggingFiles,
	} = useSpaceComposerFileInput({
		disabled: composerActionsDisabled,
		onAddFiles: input.actions.onAddFiles,
	});
	const fileHint = resolveSpaceComposerFileHint({
		files: input.content.files,
		fileLimitReached: input.availability.fileLimitReached,
		uploadInProgress,
	});
	const composerHint = fileHint ?? policy.wakeTextHint;
	const composerHintClassName = policy.wakeTextHint
		? "text-foreground"
		: "text-muted-foreground";
	const primaryAction = input.slots?.primaryAction ?? (
		<PromptInputAction
			className="hidden sm:inline-flex"
			tooltip={policy.sendButtonTooltip}
		>
			<Button
				aria-label={policy.sendButtonLabel}
				disabled={
					input.availability.isSendingMessage ||
					!input.availability.canSendMessage ||
					input.availability.sendBlocked
				}
				onClick={input.actions.onSubmit}
				size="icon-sm"
				type="button"
			>
				<ArrowUpIcon aria-hidden="true" weight="bold" />
			</Button>
		</PromptInputAction>
	);

	return (
		<div
			className={input.presentation?.className}
			data-slot={input.presentation?.dataSlot}
		>
			<div className="relative">
				<SpaceComposerFileDropOverlay visible={isDraggingFiles} />
				{input.slots?.beforeInput}
				<PromptInput
					className="w-full"
					maxHeight={input.presentation?.maxHeight ?? 240}
					onSubmit={input.actions.onSubmit}
					value={input.content.text}
				>
					<SpaceComposerFileTray
						disabled={input.availability.isSendingMessage}
						files={input.content.files}
						onRemove={input.actions.onRemoveFile}
					/>
					<SpaceComposerEditor
						addressingTargets={input.content.addressingTargets}
						ariaLabel={policy.accessibleName}
						authoredMentions={input.content.authoredMentions}
						centerAgentProfileId={input.centerAgentProfileId}
						composerRef={input.composerRef}
						maxHeight={input.presentation?.maxHeight}
						mentionPickerItems={input.content.mentionPickerItems}
						onChange={input.actions.onEditorChange}
						onDragEnter={handleDragOver}
						onDragLeave={handleDragLeave}
						onDragOver={handleDragOver}
						onDrop={handleDrop}
						onPaste={handlePaste}
						onSend={input.actions.onSubmit}
						placeholder={policy.placeholder}
						text={input.content.text}
					/>
					<PromptInputActions className="min-w-0 justify-between gap-3 border-border border-t pt-2">
						<div className="flex min-w-0 flex-1 items-center gap-0">
							<SpaceComposerFileMenu
								addFiles={addFiles}
								disabled={composerActionsDisabled}
								limitReached={input.availability.fileLimitReached}
							/>
							{policy.showMentionButton ? (
								<Button
									aria-label="Mention a member"
									className="size-8 text-base"
									disabled={composerActionsDisabled}
									onClick={input.actions.onMentionButtonClick}
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									<span aria-hidden="true">@</span>
								</Button>
							) : null}
							{composerHint ? (
								<p
									aria-live="polite"
									className={cn(
										"min-w-0 flex-1 text-xs leading-5 max-sm:line-clamp-2 max-sm:whitespace-normal sm:truncate",
										composerHintClassName
									)}
								>
									{composerHint}
								</p>
							) : null}
						</div>
						<div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
							{input.slots?.profileControl}
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
	uploadInProgress?: boolean;
}): string | null {
	if (
		input.uploadInProgress ??
		input.files.some(isSpaceComposerFileInProgress)
	) {
		return "Uploading files before sending…";
	}
	const failedCount = input.files.filter(isSpaceComposerFileFailed).length;
	if (failedCount > 0) {
		return `${String(failedCount)} ${failedCount === 1 ? "file" : "files"} couldn't be uploaded and won't be sent.`;
	}
	if (input.fileLimitReached) {
		return "You can add up to 10 files.";
	}
	const readyCount = input.files.filter(
		(file) => file.status === "ready"
	).length;
	if (readyCount > 0) {
		return `${String(readyCount)} ${readyCount === 1 ? "file" : "files"} ready to send`;
	}
	return null;
}

export function resolveSpaceComposerSendBlocked(input: {
	files: readonly SpaceComposerFile[];
	text: string;
}): boolean {
	const uploadInProgress = input.files.some(isSpaceComposerFileInProgress);
	const hasReadyFile = input.files.some((file) => file.status === "ready");
	return uploadInProgress || (!hasReadyFile && input.text.trim().length === 0);
}
