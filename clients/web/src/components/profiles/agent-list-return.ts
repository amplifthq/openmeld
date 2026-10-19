/** Where a Profile detail page opened from the Agents page goes back to. */
export function resolveAgentListReturn(input: {
	agentsPath: string;
	memberAgentName: string | undefined;
	returnToAgentDirectory: boolean | undefined;
	returnToMemberAgentId: string | undefined;
}) {
	if (!input.returnToAgentDirectory) {
		return;
	}
	if (input.returnToMemberAgentId) {
		return {
			to: `${input.agentsPath}?memberAgentId=${encodeURIComponent(input.returnToMemberAgentId)}`,
			label: `Back to ${input.memberAgentName ?? "Agent"}`,
		};
	}
	return { to: input.agentsPath, label: "Back to Agents" };
}
