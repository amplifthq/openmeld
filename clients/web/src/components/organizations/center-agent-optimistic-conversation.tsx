import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { ArrowUpIcon, ChatCircleTextIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import {
	PromptInput,
	PromptInputAction,
	PromptInputActions,
	PromptInputTextarea,
} from "#/components/ibelick/prompt-input";
import { SpaceConversationSkeleton } from "#/components/spaces/space-conversation-skeleton";
import { SpaceMessageDeliveryStatus } from "#/components/spaces/space-message-delivery-status";
import type { PendingCenterAgentMessage } from "#/lib/organizations/center-agent-pending-message";

export function CenterAgentOptimisticConversation(input: {
	composerAccessory?: ReactNode;
	hasAttachments?: boolean;
	empty?: boolean;
	emptyContent?: ReactNode;
	header?: ReactNode;
	composerText: string;
	onComposerChange: (value: string) => void;
	onSend: () => void;
	pendingMessage: PendingCenterAgentMessage | null;
	presentation?: "compact" | "full";
}) {
	const isSending = input.pendingMessage !== null;

	return (
		<section
			className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-[inherit] bg-background"
			data-space-conversation-presentation={input.presentation}
			data-testid="center-agent-conversation-skeleton"
		>
			{input.header ?? (
				<header className="flex h-[var(--space-conversation-header-height)] shrink-0 flex-col justify-center gap-4 border-border border-b px-4">
					{input.empty ? (
						<div className="flex items-center gap-3">
							<ChatCircleTextIcon className="size-5 text-muted-foreground" />
							<h1 className="font-medium text-lg">New chat</h1>
						</div>
					) : (
						<div aria-hidden="true" className="flex min-w-0 items-center gap-3">
							<ChatCircleTextIcon className="size-5 text-muted-foreground" />
							<div className="flex min-w-0 flex-col gap-2">
								<Skeleton className="h-4 w-36 motion-reduce:animate-none" />
							</div>
						</div>
					)}
					{!input.empty && (
						<div
							aria-hidden="true"
							className="flex gap-5 text-muted-foreground text-sm"
						>
							<span className="text-foreground">Messages</span>
							<span>Graph</span>
							<span>Files</span>
							<span>Tasks</span>
							<span>Routines</span>
							<span>Skills</span>
							<span>Plugins</span>
							<span>Channels</span>
						</div>
					)}
				</header>
			)}
			<div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
				<div
					aria-label="Center Agent conversation"
					className="min-h-0 flex-1 overflow-y-auto"
					role="log"
				>
					{input.empty && !input.pendingMessage ? (
						<div className="px-6">{input.emptyContent}</div>
					) : (
						<div
							className="flex h-full w-full flex-col gap-5 py-5"
							data-space-conversation-content-width=""
						>
							{input.pendingMessage ? (
								<>
									<div className="flex justify-end">
										<div className="max-w-[min(80%,42rem)]">
											<div className="rounded-lg border border-border bg-muted px-3 py-2 text-foreground text-sm">
												{input.pendingMessage.text}
											</div>
										</div>
									</div>
									<CenterAgentOptimisticReplyShell />
								</>
							) : (
								<SpaceConversationSkeleton />
							)}
						</div>
					)}
				</div>
				<footer className="shrink-0 bg-background">
					<div className="w-full py-4" data-space-conversation-content-width="">
						<PromptInput
							className="w-full"
							disabled={isSending}
							maxHeight={240}
							onSubmit={input.onSend}
							value={input.composerText}
						>
							<PromptInputTextarea
								aria-label="Message Center Agent"
								autoComplete="off"
								autoFocus={input.empty}
								className="px-1 py-2 text-sm leading-6 placeholder:text-muted-foreground"
								name="center-agent-message"
								onChange={(event) => {
									input.onComposerChange(event.target.value);
								}}
								placeholder="Tell Center Agent what you need…"
							/>
							<PromptInputActions className="min-w-0 justify-between pt-2">
								<div>{input.composerAccessory}</div>
								<PromptInputAction
									tooltip={isSending ? "Sending…" : "Send message"}
								>
									<Button
										aria-label={isSending ? "Sending…" : "Send message"}
										disabled={
											isSending ||
											!(input.composerText.trim() || input.hasAttachments)
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
