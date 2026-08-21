const LOCAL_AGENT_DISPLAY_SPLIT_PATTERN = /[-_]/u;

export function formatLocalAgentDisplayName(agentId: string): string {
	const displaySegments: string[] = [];
	for (const segment of agentId.split(LOCAL_AGENT_DISPLAY_SPLIT_PATTERN)) {
		if (segment.length === 0) {
			continue;
		}
		displaySegments.push(segment[0]?.toUpperCase() + segment.slice(1));
	}
	return displaySegments.join(" ");
}
