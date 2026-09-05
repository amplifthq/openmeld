import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod/v4";
import { AgentsRoutePendingPage } from "#/components/agents/agents-route-pending";
import { appShellStaticData } from "#/components/app/shell-layout";
import { PeopleAndAgentsPage } from "#/components/profiles/people-and-agents-page";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
} from "#/lib/app-route-loading";
import { prefetchAgentsRouteIdentityData } from "#/lib/organizations/app-route-prefetch";
import { buildOrganizationAgentsPath } from "#/lib/organizations/organization-routes";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

const agentsRouteSearchSchema = z.object({
	activityPreview: z.literal(1).optional(),
	profileId: z.string().trim().min(1).optional(),
	requestId: z.string().trim().min(1).optional(),
	view: z.enum(["agents", "create", "requests"]).optional(),
});

export const Route = createFileRoute("/o/$orgSlug/agents")({
	staticData: appShellStaticData.agents,
	validateSearch: (search) => {
		const parsed = agentsRouteSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	pendingComponent: AgentsRoutePendingPage,
	pendingMinMs: APP_ROUTE_PENDING_MIN_DURATION_MS,
	pendingMs: APP_ROUTE_PENDING_DELAY_MS,
	loader: async ({ context, location, params }) => {
		const [sidebarStates] = await Promise.all([
			getAppSidebarStatesForRoute("agents"),
			prefetchAgentsRouteIdentityData({
				organizationSlug: params.orgSlug,
				queryClient: context.queryClient,
				queryPersistence: context.queryPersistence,
				routeFamily: location.href,
			}).catch((error: unknown) => {
				console.error(
					"Failed to prefetch the Agents identity directory.",
					error
				);
			}),
		]);
		return { sidebarStates };
	},
	component: AgentsRoute,
});

function AgentsRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { orgSlug } = Route.useParams();
	const search = Route.useSearch();
	const navigate = useNavigate();

	return (
		<PeopleAndAgentsPage
			activeAgentView={search.view ?? "agents"}
			activeSectionId="agents"
			activityPreview={search.activityPreview === 1}
			focusProfileId={search.profileId ?? null}
			focusRequestId={search.requestId ?? null}
			initialSidebarStates={sidebarStates}
			onAgentViewChange={(view, profileId) => {
				const selectedProfileId = profileId ?? search.profileId;
				navigate({
					search: resolveAgentsRouteSearch({
						activityPreview: search.activityPreview,
						profileId: selectedProfileId,
						view,
					}),
					to: buildOrganizationAgentsPath(orgSlug),
				}).catch((error: unknown) => {
					console.error("Failed to change the Agents view.", error);
				});
			}}
		/>
	);
}

function resolveAgentsRouteSearch(input: {
	activityPreview: 1 | undefined;
	profileId: string | undefined;
	view: "agents" | "create" | "requests";
}) {
	if (input.view === "agents") {
		return {
			activityPreview: input.activityPreview,
			profileId: input.profileId,
		};
	}
	return {
		activityPreview: input.activityPreview,
		profileId: input.profileId,
		view: input.view,
	};
}
