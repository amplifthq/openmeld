import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { cn } from "@openmeld/ui/lib/utils";

const AGENT_IDS = ["codex", "claude-code", "grok-build", "opencode", "cursor"];

/** Examples of supported apps, not the current computer's installation state. */
export function LocalAgentLogoStack({
	compact = false,
}: {
	compact?: boolean;
}) {
	return (
		<span
			aria-hidden="true"
			className="isolate inline-flex shrink-0 items-center -space-x-1.5 align-middle"
		>
			{AGENT_IDS.map((agentId, index) => (
				<span
					className="relative inline-flex"
					key={agentId}
					style={{ zIndex: AGENT_IDS.length - index }}
				>
					<LocalAgentLogo
						agentId={agentId}
						className={cn("rounded-sm", compact ? "size-5" : "size-6")}
						variant="tile"
					/>
				</span>
			))}
		</span>
	);
}
