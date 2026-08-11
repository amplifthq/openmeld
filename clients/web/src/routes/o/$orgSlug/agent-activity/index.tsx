import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { AgentActivityOverview } from "#/components/organizations/agent-activity-overview";

export const Route = createFileRoute("/o/$orgSlug/agent-activity/")({
	staticData: appShellStaticData.agentActivity,
	component: AgentActivityOverviewRoute,
});

function AgentActivityOverviewRoute() {
	const navigate = useNavigate();
	const { orgSlug } = Route.useParams();
	return (
		<AgentActivityOverview
			canManage={true}
			onNavigateToSessions={(search) => {
				navigate({
					search: (current) => ({
						member: search.member ?? undefined,
						project: current.project,
					}),
					to: "/o/$orgSlug/agent-activity/sessions",
					params: { orgSlug },
				}).catch((error: unknown) => {
					console.error("Failed to open Agent Activity Sessions.", error);
				});
			}}
		/>
	);
}
