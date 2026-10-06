import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod/v4";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { TeamHeader } from "#/components/directory/team-header";
import { TeamPeopleSidebar } from "#/components/directory/team-people-sidebar";
import { RoutinesPage } from "#/components/routines/routines-page";
import { routineScopeParser } from "#/lib/page-tab-search";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

const routineFocusSearch = z.object({
	routineId: z.string().trim().min(1).max(256).optional(),
	runId: z.string().trim().min(1).max(256).optional(),
});

export const Route = createFileRoute("/o/$orgSlug/routines")({
	staticData: appShellStaticData.people,
	validateSearch: (
		search: Record<string, unknown>
	): { scope?: "personal" | "team"; routineId?: string; runId?: string } => ({
		...routineFocusSearch.parse(search),
		scope:
			typeof search.scope === "string"
				? (routineScopeParser.parse(search.scope) ?? undefined)
				: undefined,
	}),
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	component: RoutinesRoute,
});
function RoutinesRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { routineId, runId } = Route.useSearch();
	const { orgSlug } = Route.useParams();
	const navigate = useNavigate({ from: Route.fullPath });
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={sidebarStates.outer}
			mainHeader={<TeamHeader active="routines" />}
			mainSidebarContent={<TeamPeopleSidebar />}
			showMainHeader
		>
			<div className="flex w-full flex-1 flex-col px-[var(--app-page-inline-padding)] py-[var(--app-page-block-padding)]">
				<RoutinesPage
					focusRoutineId={routineId}
					focusRunId={runId}
					onClearFocus={() =>
						navigate({
							to: "/o/$orgSlug/routines",
							params: { orgSlug },
							search: ({ routineId: _routine, runId: _run, ...previous }) =>
								previous,
						})
					}
				/>
			</div>
		</AppFullWidthLayout>
	);
}
