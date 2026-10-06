import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod/v4";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { TeamHeader } from "#/components/directory/team-header";
import { TeamPeopleSidebar } from "#/components/directory/team-people-sidebar";
import { RoutinesPage } from "#/components/routines/routines-page";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/routines")({
	staticData: appShellStaticData.people,
	validateSearch: z.object({
		routineId: z.string().trim().min(1).max(256).optional(),
		runId: z.string().trim().min(1).max(256).optional(),
	}),
	loader: async () => ({ sidebarStates: await getAppSidebarStatesForRoute() }),
	component: RoutinesRoute,
});
function RoutinesRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { routineId, runId } = Route.useSearch();
	const { orgSlug } = Route.useParams();
	const navigate = useNavigate();
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={sidebarStates.outer}
			mainHeader={<TeamHeader active="routines" />}
			mainSidebarContent={<TeamPeopleSidebar />}
			showMainHeader
		>
			<div className="flex w-full flex-1 flex-col px-[var(--app-page-inline-padding)] py-6">
				<RoutinesPage
					focusRoutineId={routineId}
					focusRunId={runId}
					onClearFocus={() =>
						navigate({
							to: "/o/$orgSlug/routines",
							params: { orgSlug },
							search: {},
						})
					}
				/>
			</div>
		</AppFullWidthLayout>
	);
}
