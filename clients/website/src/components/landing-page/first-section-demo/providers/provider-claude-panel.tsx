import type { DemoAgentSession } from "../demo-types";
import { DemoAgentIcon } from "../shared/demo-agent-icon";
import { SelectionSwipeText } from "../shared/selection-swipe-text";
import { ProviderPanelShell } from "./provider-panel-shell";

type ProviderClaudePanelProps = {
	isVisible: boolean;
	isReplyHighlighted: boolean;
	onClose: () => void;
	shouldScrollToBottom: boolean;
	session: DemoAgentSession;
};

export function ProviderClaudePanel({
	isVisible,
	isReplyHighlighted,
	onClose,
	session,
	shouldScrollToBottom,
}: ProviderClaudePanelProps) {
	const { providerPanel } = session;

	return (
		<ProviderPanelShell
			agentName={session.profileName}
			isVisible={isVisible}
			onClose={onClose}
			shouldScrollToBottom={shouldScrollToBottom}
			tabLabel={providerPanel.tabLabel}
			testId="provider-panel-claude-code"
		>
			<div className="space-y-5">
				<div className="flex items-start gap-4">
					<DemoAgentIcon
						className="size-11 shrink-0"
						name={session.profileName}
						size="md"
					/>
					<div className="space-y-1">
						{providerPanel.headerLines.map((line, index) => (
							<p
								className={
									index === 0
										? "text-[0.92rem] text-foreground/92"
										: "text-muted-foreground"
								}
								key={line}
							>
								{line}
							</p>
						))}
					</div>
				</div>

				{providerPanel.highlightLine ? (
					<p className="text-muted-foreground">
						* {providerPanel.highlightLine}
					</p>
				) : null}

				<div className="bg-card/70 px-4 py-3">
					<p className="text-foreground/88">{providerPanel.contextLabel}</p>
					<div className="pt-4 text-foreground/84">
						{providerPanel.contextLines.map((line) => (
							<p key={line}>{line}</p>
						))}
					</div>
				</div>

				<div className="space-y-1 text-foreground/88">
					{providerPanel.replyLines.map((line) => (
						<p key={line}>
							<SelectionSwipeText
								agentName={session.profileName}
								isActive={isReplyHighlighted}
								testId={`provider-reply-highlight-${session.profileName}`}
							>
								{line}
							</SelectionSwipeText>
						</p>
					))}
				</div>

				{providerPanel.footerLines.length > 0 ? (
					<div className="border-border/70 border-t pt-3 text-muted-foreground">
						{providerPanel.footerLines.map((line) => (
							<p key={line}>{line}</p>
						))}
					</div>
				) : null}
			</div>
		</ProviderPanelShell>
	);
}
