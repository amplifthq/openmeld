import { resolveStatusToneStrongTextClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	getDemoAgentAccentClassName,
	getDemoAgentAccentStyle,
	isDemoAgentName,
} from "../shared/demo-agent-icon";
import { TerminalMessageFrame } from "../shared/terminal-message-frame";
import { TypewriterText } from "../shared/typewriter-text";

type WelcomeMessageThreadProps = {
	isVisible: boolean;
	lines: readonly string[];
};

const HUMAN_ACCENT_CLASS_NAME = cn(
	resolveStatusToneStrongTextClassName("ready"),
	"opacity-[0.92]"
);
const DEMO_AGENT_MENTION_REGEX = /@your-(?:codex|claude-code)/g;

function renderWelcomeMessage(message: string) {
	const parts: React.ReactNode[] = [];
	let previousIndex = 0;

	for (const match of message.matchAll(DEMO_AGENT_MENTION_REGEX)) {
		const matchedText = match[0];
		const startIndex = match.index ?? 0;

		if (startIndex > previousIndex) {
			parts.push(message.slice(previousIndex, startIndex));
		}

		const agentName = matchedText.slice(1);
		parts.push(
			<span
				className={
					isDemoAgentName(agentName)
						? getDemoAgentAccentClassName(agentName)
						: "text-foreground/84"
				}
				key={`${matchedText}-${startIndex}`}
				style={
					isDemoAgentName(agentName)
						? getDemoAgentAccentStyle(agentName)
						: undefined
				}
			>
				{matchedText}
			</span>
		);

		previousIndex = startIndex + matchedText.length;
	}

	if (previousIndex < message.length) {
		parts.push(message.slice(previousIndex));
	}

	return parts;
}

export function WelcomeMessageThread({
	isVisible,
	lines,
}: WelcomeMessageThreadProps) {
	if (!isVisible) {
		return null;
	}

	const message = lines.join(" ");

	return (
		<section
			className="motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-3 space-y-0 motion-safe:animate-in motion-safe:duration-500 motion-reduce:animate-none"
			data-testid="space-welcome-message"
		>
			<TerminalMessageFrame>
				<div className="flex items-start gap-3 font-mono text-[0.84rem] leading-[1.65] sm:text-[0.9rem]">
					<span className={`w-9 shrink-0 pt-px ${HUMAN_ACCENT_CLASS_NAME}`}>
						You&gt;
					</span>
					<TypewriterText
						charDelayMs={7}
						className="whitespace-pre-wrap break-words text-foreground/84"
						renderText={renderWelcomeMessage}
						text={message}
					/>
				</div>
			</TerminalMessageFrame>
		</section>
	);
}
