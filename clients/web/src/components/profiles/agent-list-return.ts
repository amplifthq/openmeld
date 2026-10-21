/**
 * Where a Profile page opened from the Agents page goes back to. A Profile
 * page is also its Agent's page, so Back always returns to the Agents list.
 */
export function resolveAgentListReturn(input: {
	agentsPath: string;
	returnToAgentDirectory: boolean | undefined;
}) {
	if (!input.returnToAgentDirectory) {
		return;
	}
	return { to: input.agentsPath, label: "Back to Agents" };
}
