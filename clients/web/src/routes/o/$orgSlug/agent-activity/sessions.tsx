import { agentActivityProviderSchema } from "@openmeld/schemas";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod/v4";
import { appShellStaticData } from "#/components/app/shell-layout";
import {
	AgentActivitySessions,
	type AgentActivitySessionsFilters,
} from "#/components/organizations/agent-activity-sessions";

const sessionsSearchSchema = z.object({
	member: z.string().trim().min(1).optional(),
	provider: agentActivityProviderSchema.optional(),
	status: z.enum(["working", "idle", "offline"]).optional(),
});

export const Route = createFileRoute("/o/$orgSlug/agent-activity/sessions")({
	staticData: appShellStaticData.agentActivity,
	validateSearch: (search) => {
		const parsed = sessionsSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	component: AgentActivitySessionsRoute,
});

function AgentActivitySessionsRoute() {
	const navigate = useNavigate();
	const { orgSlug } = Route.useParams();
	const search = Route.useSearch();
	const filters: AgentActivitySessionsFilters = {
		memberUserId: search.member ?? null,
		provider: search.provider ?? null,
		status: search.status ?? null,
	};
	return (
		<AgentActivitySessions
			filters={filters}
			onFiltersChange={(nextFilters) => {
				navigate({
					params: { orgSlug },
					search: (current) => ({
						member: nextFilters.memberUserId ?? undefined,
						project: current.project,
						provider: nextFilters.provider ?? undefined,
						status: (nextFilters.status ?? undefined) as
							| "idle"
							| "offline"
							| "working"
							| undefined,
					}),
					to: "/o/$orgSlug/agent-activity/sessions",
				}).catch((error: unknown) => {
					console.error("Failed to update Agent Activity filters.", error);
				});
			}}
		/>
	);
}
