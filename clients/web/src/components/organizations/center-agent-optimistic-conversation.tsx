import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { ArrowUpIcon } from "@phosphor-icons/react";
import {
	PromptInput,
	PromptInputAction,
	PromptInputActions,
	PromptInputTextarea,
} from "#/components/ibelick/prompt-input";
import { SpaceMessageDeliveryStatus } from "#/components/spaces/space-message-delivery-status";
import type { PendingCenterAgentMessage } from "#/lib/organizations/center-agent-pending-message";

export function CenterAgentOptimisticConversation(input: {
	composerText: string;
	onComposerChange: (value: string) => void;
	onSend: () => void;
	pendingMessage: PendingCenterAgentMessage | null;
	presentation?: "compact" | "full";
}) {
	const isSending = input.pendingMessage !== null;

	return (
		<section
			className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background"
			data-space-conversation-presentation={input.presentation}
			data-testid="center-agent-conversation-skeleton"
		>
			<header className="flex h-[var(--space-conversation-header-height)] shrink-0 items-center border-border border-b px-4 sm:px-5">
				<div aria-hidden="true" className="flex min-w-0 items-center gap-3">
					<Skeleton className="size-9 shrink-0 rounded-full motion-reduce:animate-none" />
					<div className="flex min-w-0 flex-col gap-2">
						<Skeleton className="h-4 w-36 motion-reduce:animate-none" />
						<Skeleton className="h-3 w-24 motion-reduce:animate-none" />
					</div>
				</div>
			</header>
			<div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
				<div
					aria-label="Center Agent conversation"
					className="min-h-0 flex-1 overflow-hidden"
					role="log"
				>
					<div
						className="flex h-full w-full flex-col gap-5 py-5"
						data-space-conversation-content-width=""
					>
						<div className="flex items-start gap-3">
							<Skeleton
								aria-hidden="true"
								className="size-8 shrink-0 rounded-full motion-reduce:animate-none"
							/>
							<div
								aria-hidden="true"
								className="flex w-full max-w-xl flex-col gap-2"
							>
								<Skeleton className="h-3 w-24 motion-reduce:animate-none" />
								<Skeleton className="h-16 w-full motion-reduce:animate-none" />
							</div>
						</div>
						<div className="flex justify-end">
							{input.pendingMessage ? (
								<div className="max-w-[min(80%,42rem)]">
									<div className="border border-border bg-muted px-3 py-2 text-foreground text-sm">
										{input.pendingMessage.text}
									</div>
								</div>
							) : (
								<Skeleton
									aria-hidden="true"
									className="h-14 w-2/3 max-w-lg motion-reduce:animate-none"
								/>
							)}
						</div>
						{input.pendingMessage ? (
							<CenterAgentOptimisticReplyShell />
						) : (
							<div className="flex items-start gap-3">
								<Skeleton
									aria-hidden="true"
									className="size-8 shrink-0 rounded-full motion-reduce:animate-none"
								/>
								<Skeleton
									aria-hidden="true"
									className="h-20 w-3/4 max-w-2xl motion-reduce:animate-none"
								/>
							</div>
						)}
					</div>
				</div>
				<footer className="shrink-0 border-border border-t bg-background">
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
								className="px-1 py-2 text-sm leading-6 placeholder:text-muted-foreground"
								name="center-agent-message"
								onChange={(event) => {
									input.onComposerChange(event.target.value);
								}}
								placeholder="Message Center Agent…"
							/>
							<PromptInputActions className="min-w-0 justify-end border-border border-t pt-2">
								<PromptInputAction
									tooltip={isSending ? "Sending…" : "Send message"}
								>
									<Button
										aria-label={isSending ? "Sending…" : "Send message"}
										disabled={isSending}
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
			<SpaceMessageDeliveryStatus presentation="agent_starting" />
		</div>
	);
}
