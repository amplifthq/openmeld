const localAgentDisplaySplitPattern = /[-_]/u;

export function formatLocalAgentDisplayName(agentId: string): string {
	const displaySegments: string[] = [];
	for (const segment of agentId.split(localAgentDisplaySplitPattern)) {
		if (segment.length === 0) {
			continue;
		}
		displaySegments.push(segment[0]?.toUpperCase() + segment.slice(1));
	}
	return displaySegments.join(" ");
}
