import { resolveSpaceFileMimeType } from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import {
	PromptInput,
	PromptInputAction,
	PromptInputActions,
	PromptInputTextarea,
} from "#/components/ibelick/prompt-input";
import { CenterAgentDirectMessageIntro } from "#/components/spaces/center-agent-direct-message-intro";
import { Bubble } from "#/components/spaces/primitives/bubble";
import {
	Message,
	MessageContent,
	MessageHeader,
} from "#/components/spaces/primitives/message";
import { SpaceAttachmentStrip } from "#/components/spaces/space-attachment-strip";
import {
	SpaceComposerAddMenu,
	SpaceComposerAttachmentRecovery,
	SpaceComposerFileTray,
	useSpaceComposerFileInput,
} from "#/components/spaces/space-composer-attachments";
import { SpaceConversationDateMarker } from "#/components/spaces/space-conversation-date-marker";
import { SpaceConversationSkeleton } from "#/components/spaces/space-conversation-skeleton";
import {
	SpaceHeaderIdentityIcon,
	SpaceWindowHeader,
} from "#/components/spaces/space-header";
import { SpaceLocalAttachmentPreview } from "#/components/spaces/space-local-attachment-preview";
import { resolveSpaceMessageBubblePresentationClass } from "#/components/spaces/space-message-bubble-style";
import { SpaceMessageDeliveryStatus } from "#/components/spaces/space-message-delivery-status";
import { SpaceMessageProfileAvatar } from "#/components/spaces/space-message-profile-avatar";
import { SpaceMessageSurface } from "#/components/spaces/space-message-surface";
import type { PendingCenterAgentMessage } from "#/lib/organizations/center-agent-pending-message";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";
import { SPACE_PANEL_WIDTH_METRICS } from "#/lib/spaces/panel-width-storage";
import { CenterAgentHeaderTabs } from "./center-agent-header-navigation";

type CenterAgentComposerAttachments = {
	files: readonly SpaceComposerFile[];
	isAtLimit: boolean;
	addFiles: (files: readonly File[]) => Promise<void>;
	removeFile: (localId: string) => void;
	retryFile: (localId: string) => Promise<void>;
	cleanup: readonly import("#/lib/spaces/composer-file-drafts").ComposerFileDraftCleanup[];
	restorationError: unknown | null;
	retryCleanup: (localId: string) => Promise<void>;
	retryRestoration: () => void;
};

function CenterAgentAttachmentState(input: {
	attachments: CenterAgentComposerAttachments | undefined;
	isSending: boolean;
}) {
	if (!input.attachments) {
		return null;
	}
	return (
		<>
			<SpaceComposerFileTray
				disabled={input.isSending}
				files={input.attachments.files}
				onRemove={input.attachments.removeFile}
				onRetry={input.attachments.retryFile}
			/>
			<SpaceComposerAttachmentRecovery
				cleanup={input.attachments.cleanup}
				onRetryCleanup={input.attachments.retryCleanup}
				onRetryRestoration={input.attachments.retryRestoration}
				restorationError={input.attachments.restorationError}
			/>
		</>
	);
}

export function CenterAgentOptimisticConversation(input: {
	organizationSlug?: string;
	conversationTitle?: string;
	selfProfile?: {
		openMeldProfileId: string;
		profileName: string;
		avatarUrl?: string;
	} | null;
	attachments?: CenterAgentComposerAttachments;
	empty?: boolean;
	emptyContent?: ReactNode;
	header?: ReactNode;
	composerText: string;
	composerErrorMessage?: string | null;
	onComposerChange: (value: string) => void;
	onSend: () => void;
	onStop?: () => void;
	stopStatus?: "stopping" | "stopped" | "unconfirmed";
	pendingMessage: PendingCenterAgentMessage | null;
	presentation?: "compact" | "full";
}) {
	const isSending =
		input.pendingMessage !== null && input.stopStatus !== "stopped";
	const organization = useOptionalAppOrganization()?.currentOrganization;
	const organizationSlug = input.organizationSlug ?? organization?.slug;
	const fileInput = useSpaceComposerFileInput({
		disabled: isSending || !input.attachments,
		onAddFiles: async (files) => {
			await input.attachments?.addFiles(files);
		},
	});

	return (
		<section
			className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-[inherit] bg-background"
			data-space-conversation-presentation={input.presentation}
			data-testid="center-agent-conversation-skeleton"
			style={
				{
					"--space-members-panel-width":
						SPACE_PANEL_WIDTH_METRICS.members.defaultWidth,
				} as CSSProperties
			}
		>
			{input.header ?? (
				<SpaceWindowHeader
					leadingControl={<SpaceHeaderIdentityIcon isDirectMessage />}
					navigation={
						organizationSlug ? (
							<CenterAgentHeaderTabs
								activeSectionId="chat"
								activeSpaceView="messages"
								idPrefix="pending-chat-view"
								organizationSlug={organizationSlug}
							/>
						) : undefined
					}
					secondaryContentClassName="overflow-x-auto"
					title={input.conversationTitle ?? "New chat"}
				/>
			)}
			<div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
				<ScrollArea
					aria-label="Center Agent conversation"
					className="min-h-0 flex-1"
					data-space-optimistic-conversation=""
					role="log"
				>
					<div
						className="flex w-full flex-col py-4"
						data-space-conversation-content-width=""
					>
						{input.emptyContent ??
							(input.pendingMessage && organization ? (
								<CenterAgentDirectMessageIntro
									disabled
									isPersonalContext={organization.isPersonal === true}
									onSelectStarterAction={input.onComposerChange}
									onStartComputerSetup={() => undefined}
									showStarterActions
									showStarterComputerSetup={false}
								/>
							) : null)}
						{input.pendingMessage ? (
							<>
								<SpaceConversationDateMarker
									date={new Date(input.pendingMessage.createdAtMs)}
									loadedSignalCount={0}
								/>
								<Message
									align="end"
									className="py-1.5"
									data-space-self-message="true"
								>
									<MessageContent
										className="w-full min-w-0 gap-0"
										directMessage
									>
										<MessageHeader className="px-0">
											{input.selfProfile ? (
												<div className="flex items-center gap-1.5">
													<SpaceMessageProfileAvatar
														agentControllerRef={null}
														avatarImageUrl={input.selfProfile.avatarUrl}
														displayName={input.selfProfile.profileName}
														profileId={input.selfProfile.openMeldProfileId}
														profileKind="human"
														responsive
													/>
												</div>
											) : (
												<span data-slot="message-speaker-avatar">
													<span data-slot="message-speaker-avatar-content">
														<Skeleton className="size-8 animate-none rounded-full" />
													</span>
												</span>
											)}
										</MessageHeader>
										<PendingMessageSurface message={input.pendingMessage} />
										{/* Keep the transcript's action-footer space before publication. */}
										<div aria-hidden="true" className="mt-0.5 min-h-7" />
									</MessageContent>
								</Message>
								<CenterAgentOptimisticReplyShell
									onStop={input.onStop}
									stopStatus={input.stopStatus}
								/>
							</>
						) : (
							!input.empty && <SpaceConversationSkeleton />
						)}
					</div>
				</ScrollArea>
				<footer className="shrink-0 bg-background">
					<div className="w-full py-4" data-space-conversation-content-width="">
						{input.composerErrorMessage ? (
							<p className="pb-2 text-destructive text-sm" role="alert">
								{input.composerErrorMessage}
							</p>
						) : null}
						<PromptInput
							className="relative w-full"
							disabled={isSending}
							maxHeight={240}
							onSubmit={input.onSend}
							value={input.composerText}
						>
							<CenterAgentAttachmentState
								attachments={input.attachments}
								isSending={isSending}
							/>
							{fileInput.isDraggingFiles && (
								<div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border border-primary border-dashed bg-background/90 text-sm">
									Drop files to attach
								</div>
							)}
							<PromptInputTextarea
								aria-label="Message Center Agent"
								autoComplete="off"
								autoFocus={input.empty}
								className="min-h-11 px-1 py-2 text-sm leading-6 placeholder:text-muted-foreground"
								name="center-agent-message"
								onChange={(event) => {
									input.onComposerChange(event.target.value);
								}}
								onDragLeave={fileInput.handleDragLeave}
								onDragOver={fileInput.handleDragOver}
								onDrop={fileInput.handleDrop}
								onPaste={fileInput.handlePaste}
								placeholder="Tell Center Agent what you need…"
							/>
							<PromptInputActions className="min-w-0 justify-between pt-2">
								<div>
									{input.attachments && (
										<SpaceComposerAddMenu
											addFiles={fileInput.addFiles}
											disabled={isSending}
											limitReached={input.attachments.isAtLimit}
										/>
									)}
								</div>
								<PromptInputAction
									tooltip={isSending ? "Sending…" : "Send message"}
								>
									<Button
										aria-label={isSending ? "Sending…" : "Send message"}
										disabled={
											isSending ||
											!(
												input.composerText.trim() ||
												input.attachments?.files.length
											)
										}
										onClick={input.onSend}
										size="icon-sm"
										type="button"
									>
										<ArrowUpIcon aria-hidden="true" weight="bold" />
									</Button>
								</PromptInputAction>
							</PromptInputActions>
						</PromptInput>
					</div>
				</footer>
			</div>
		</section>
	);
}

function PendingMessageSurface({
	message,
}: {
	message: PendingCenterAgentMessage;
}) {
	return (
		<Bubble
			align="end"
			className={message.files?.length ? "w-full" : undefined}
		>
			<SpaceMessageSurface
				attachments={
					message.files?.length ? (
						<SpaceAttachmentStrip
							align="end"
							className={message.text.trim() ? undefined : "ml-0"}
							label="Message attachments"
							matchTextWidth={Boolean(message.text.trim())}
						>
							{message.files.map((file) => (
								<PendingAttachment
									file={file}
									key={`${file.name}:${file.size}:${file.lastModified}`}
								/>
							))}
						</SpaceAttachmentStrip>
					) : null
				}
				bubbleClassName={cn(
					resolveSpaceMessageBubblePresentationClass({ isSelf: true }),
					"whitespace-pre-wrap"
				)}
			>
				{message.text.trim() ? (
					<div className="leading-[26px]">{message.text}</div>
				) : null}
			</SpaceMessageSurface>
		</Bubble>
	);
}

function PendingAttachment({ file }: { file: File }) {
	const [preview, setPreview] = useState<string | null>(null);
	const mimeType = resolveSpaceFileMimeType({
		declaredMimeType: file.type,
		fileName: file.name,
	});
	const isMedia =
		mimeType.startsWith("image/") || mimeType.startsWith("video/");
	useEffect(() => {
		if (!isMedia) {
			return;
		}
		const url = URL.createObjectURL(file);
		setPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [file, isMedia]);
	return (
		<SpaceLocalAttachmentPreview
			fileName={file.name}
			mimeType={mimeType}
			previewUrl={preview}
			sizeBytes={file.size}
		/>
	);
}

function CenterAgentOptimisticReplyShell(input: {
	onStop?: () => void;
	stopStatus?: "stopping" | "stopped" | "unconfirmed";
}) {
	return (
		<div
			className="flex w-full min-w-0 flex-col gap-2 px-3 py-2"
			data-testid="center-agent-optimistic-reply"
		>
			<div className="flex min-w-0 items-center gap-1.5">
				<Skeleton
					aria-hidden="true"
					className="size-6 shrink-0 rounded-full motion-reduce:animate-none"
				/>
				<span className="min-w-0 font-bold text-foreground text-sm">
					Center Agent
				</span>
			</div>
			<div className="flex items-center gap-2">
				{input.stopStatus ? (
					<output className="text-muted-foreground text-sm">
						{
							{
								stopped: "Stopped",
								stopping: "Stopping…",
								unconfirmed: "Stop not confirmed",
							}[input.stopStatus]
						}
					</output>
				) : (
					<SpaceMessageDeliveryStatus presentation="agent_sending" />
				)}
				{input.onStop && input.stopStatus !== "stopped" ? (
					<Button
						aria-label={
							input.stopStatus === "unconfirmed"
								? "Retry stop"
								: "Stop Center Agent"
						}
						disabled={input.stopStatus === "stopping"}
						onClick={input.onStop}
						size="xs"
						variant="ghost"
					>
						<StopIcon aria-hidden="true" weight="fill" />
						{input.stopStatus === "unconfirmed" ? "Retry stop" : "Stop"}
					</Button>
				) : null}
			</div>
		</div>
	);
}
