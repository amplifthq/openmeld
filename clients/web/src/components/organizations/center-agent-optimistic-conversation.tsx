import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { ArrowUpIcon } from "@phosphor-icons/react";
import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import {
	PromptInput,
	PromptInputAction,
	PromptInputActions,
	PromptInputTextarea,
} from "#/components/ibelick/prompt-input";
import { CenterAgentDirectMessageIntro } from "#/components/spaces/center-agent-direct-message-intro";
import { Bubble, BubbleContent } from "#/components/spaces/primitives/bubble";
import {
	Message,
	MessageContent,
	MessageHeader,
} from "#/components/spaces/primitives/message";
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
import { SpaceImagePreview } from "#/components/spaces/space-image-preview";
import {
	resolveSpaceMessageBubblePresentationClass,
	SPACE_MESSAGE_CONTENT_PADDING_CLASS,
} from "#/components/spaces/space-message-bubble-style";
import { SpaceMessageDeliveryStatus } from "#/components/spaces/space-message-delivery-status";
import { SpaceMessageProfileAvatar } from "#/components/spaces/space-message-profile-avatar";
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
	pendingMessage: PendingCenterAgentMessage | null;
	presentation?: "compact" | "full";
}) {
	const isSending = input.pendingMessage !== null;
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
				<div
					aria-label="Center Agent conversation"
					className="min-h-0 flex-1 overflow-y-auto"
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
									<MessageContent className="gap-0" directMessage>
										<MessageHeader className="h-6 px-0">
											{input.selfProfile ? (
												<div className="flex items-center gap-1.5">
													<SpaceMessageProfileAvatar
														agentControllerRef={null}
														avatarImageUrl={input.selfProfile.avatarUrl}
														displayName={input.selfProfile.profileName}
														profileId={input.selfProfile.openMeldProfileId}
														profileKind="human"
													/>
												</div>
											) : (
												<Skeleton className="size-6 animate-none rounded-full" />
											)}
										</MessageHeader>
										<Bubble align="end">
											<BubbleContent
												className={`${resolveSpaceMessageBubblePresentationClass({ isSelf: true })} ${SPACE_MESSAGE_CONTENT_PADDING_CLASS} whitespace-pre-wrap`}
											>
												<div className="leading-[26px]">
													{input.pendingMessage.text}
												</div>
												{input.pendingMessage.files?.map((file) => (
													<PendingAttachment
														file={file}
														key={`${file.name}:${file.size}:${file.lastModified}`}
													/>
												))}
											</BubbleContent>
										</Bubble>
										{/* Keep the transcript's action-footer space before publication. */}
										<div aria-hidden="true" className="mt-0.5 min-h-7" />
									</MessageContent>
								</Message>
								<CenterAgentOptimisticReplyShell />
							</>
						) : (
							!input.empty && <SpaceConversationSkeleton />
						)}
					</div>
				</div>
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

function PendingAttachment({ file }: { file: File }) {
	const [preview, setPreview] = useState<string | null>(null);
	const isImage = file.type.startsWith("image/");
	useEffect(() => {
		if (!isImage) {
			return;
		}
		const url = URL.createObjectURL(file);
		setPreview(url);
		return () => URL.revokeObjectURL(url);
	}, [file, isImage]);
	return isImage ? (
		<div className="size-16">
			{preview ? (
				<SpaceImagePreview
					altText={file.name}
					imageSource={preview}
					isSingle={false}
					thumbnailClassName="size-16 rounded-xl"
				/>
			) : (
				<span className="sr-only">{file.name}</span>
			)}
		</div>
	) : (
		<div className="text-muted-foreground text-xs">{file.name}</div>
	);
}

function CenterAgentOptimisticReplyShell() {
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
			<SpaceMessageDeliveryStatus presentation="agent_sending" />
		</div>
	);
}
