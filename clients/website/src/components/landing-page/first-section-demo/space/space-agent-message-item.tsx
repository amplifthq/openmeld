import type { DemoSpaceAgentMessage } from "../demo-types";
import {
	DemoAgentIcon,
	getDemoAgentAccentClassName,
	getDemoAgentAccentStyle,
} from "../shared/demo-agent-icon";
import { SelectionSwipeText } from "../shared/selection-swipe-text";
import { TerminalMessageFrame } from "../shared/terminal-message-frame";

type SpaceAgentMessageItemProps = {
	isReplyHighlighted: boolean;
	message: DemoSpaceAgentMessage;
};

export function SpaceAgentMessageItem({
	isReplyHighlighted,
	message,
}: SpaceAgentMessageItemProps) {
	return (
		<article
			className="font-mono text-[0.84rem] leading-[1.65] sm:text-[0.9rem]"
			data-testid={`space-agent-message-${message.agentName}`}
		>
			<TerminalMessageFrame>
				<div className="flex flex-wrap items-start gap-x-2 gap-y-1">
					<span className="text-muted-foreground">-</span>
					<span
						className={`inline-flex items-center gap-2 ${getDemoAgentAccentClassName(message.agentName)}`}
						style={getDemoAgentAccentStyle(message.agentName)}
					>
						<DemoAgentIcon name={message.agentName} size="sm" />
						<span>{message.agentName}</span>
					</span>
					<span className="text-muted-foreground">:</span>
					<p className="min-w-0 flex-1 text-foreground/84">
						<SelectionSwipeText
							agentName={message.agentName}
							isActive={isReplyHighlighted}
							testId={`space-agent-message-highlight-${message.agentName}`}
						>
							{message.replyText}
						</SelectionSwipeText>
					</p>
				</div>
				<div className="space-y-1 pl-6 text-muted-foreground">
					{message.metaLines.map((line) => (
						<p key={line}>{line}</p>
					))}
				</div>
			</TerminalMessageFrame>
		</article>
	);
}
