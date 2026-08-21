import {
	agentActivityInventorySessionOriginSchema,
	agentActivityInventorySessionStatusSchema,
	localAgentSessionProviderSchema,
} from "@openmeld/schemas";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod/v4";
import { appShellStaticData } from "#/components/app/shell-layout";
import {
	AgentActivitySessions,
	type AgentActivitySessionsFilters,
} from "#/components/organizations/agent-activity-sessions";

const sessionsSearchSchema = z.object({
	cursor: z.string().trim().min(1).max(2048).optional(),
	member: z.string().trim().min(1).optional(),
	origin: agentActivityInventorySessionOriginSchema.optional(),
	provider: localAgentSessionProviderSchema.optional(),
	query: z.string().trim().min(1).max(256).optional(),
	status: agentActivityInventorySessionStatusSchema.optional(),
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
		cursor: search.cursor ?? null,
		memberUserId: search.member ?? null,
		origin: search.origin ?? null,
		provider: search.provider ?? null,
		query: search.query ?? null,
		status: search.status ?? null,
	};
	return (
		<AgentActivitySessions
			filters={filters}
			onFiltersChange={(nextFilters) => {
				navigate({
					params: { orgSlug },
					search: (current) => ({
						cursor: nextFilters.cursor ?? undefined,
						member: nextFilters.memberUserId ?? undefined,
						origin: nextFilters.origin ?? undefined,
						project: current.project,
						provider: nextFilters.provider ?? undefined,
						query: nextFilters.query ?? undefined,
						status: nextFilters.status ?? undefined,
					}),
					to: "/o/$orgSlug/agent-activity/sessions",
				}).catch((error: unknown) => {
					console.error("Failed to update Agent Activity filters.", error);
				});
			}}
		/>
	);
}
