import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { cn } from "@openmeld/ui/lib/utils";

export const LOCAL_AGENT_EXAMPLE_IDS = [
	"codex",
	"claude-code",
	"grok-build",
	"grok-bot",
	"opencode",
	"antigravity",
	"cursor",
] as const;

export const LOCAL_AGENT_STACK_IDS = LOCAL_AGENT_EXAMPLE_IDS.slice(0, 6);
export const LOCAL_AGENT_STACK_TOOLTIP =
	"Codex, Claude Code, Grok Build, Grok Bot, OpenCode, Antigravity, and Cursor";

/** Examples of supported apps, not the current computer's installation state. */
export function LocalAgentLogoStack({
	compact = false,
}: {
	compact?: boolean;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				aria-label="Supported local agents"
				render={
					<span className="isolate inline-flex shrink-0 items-center -space-x-1.5 align-middle" />
				}
			>
				{LOCAL_AGENT_STACK_IDS.map((agentId, index) => (
					<span
						aria-hidden="true"
						className="relative inline-flex"
						key={agentId}
						style={{ zIndex: LOCAL_AGENT_STACK_IDS.length - index }}
					>
						<LocalAgentLogo
							agentId={agentId}
							className={cn("rounded-sm", compact ? "size-5" : "size-6")}
							variant="tile"
						/>
					</span>
				))}
			</TooltipTrigger>
			<TooltipContent side="top">{LOCAL_AGENT_STACK_TOOLTIP}</TooltipContent>
		</Tooltip>
	);
}
