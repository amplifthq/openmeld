const LOCAL_AGENT_DISPLAY_SPLIT_PATTERN = /[-_]/u;
const LOCAL_AGENT_DISPLAY_NAMES: Readonly<Record<string, string>> = {
	"claude-code": "Claude Code",
	codex: "Codex",
	cursor: "Cursor",
	"grok-build": "Grok Build",
	opencode: "OpenCode",
	openclaw: "OpenClaw",
};

export function formatLocalAgentDisplayName(agentId: string): string {
	const knownName = LOCAL_AGENT_DISPLAY_NAMES[agentId];
	if (knownName) {
		return knownName;
	}
	const displaySegments: string[] = [];
	for (const segment of agentId.split(LOCAL_AGENT_DISPLAY_SPLIT_PATTERN)) {
		if (segment.length === 0) {
			continue;
		}
		displaySegments.push(segment[0]?.toUpperCase() + segment.slice(1));
	}
	return displaySegments.join(" ");
}
