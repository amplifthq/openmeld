import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { AgentActivityChanges } from "#/components/organizations/agent-activity-changes";

export const Route = createFileRoute("/o/$orgSlug/agent-activity/changes")({
	staticData: appShellStaticData.agentActivity,
	component: AgentActivityChanges,
});
