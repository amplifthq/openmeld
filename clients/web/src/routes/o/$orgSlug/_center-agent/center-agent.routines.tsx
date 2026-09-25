import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod/v4";
import { appShellStaticData } from "#/components/app/shell-layout";
import { CenterAgentRoutinesPage } from "#/components/organizations/center-agent-routines-page";
import { CenterAgentSectionFrame } from "#/components/organizations/center-agent-section-frame";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/routines"
)({
	staticData: appShellStaticData.centerAgent,
	validateSearch: z.object({
		routineId: z.string().trim().min(1).max(256).optional(),
		runId: z.string().trim().min(1).max(256).optional(),
	}),
	component: RoutinesRoute,
});

function RoutinesRoute() {
	const { orgSlug } = Route.useParams();
	const { routineId, runId } = Route.useSearch();
	const navigate = useNavigate();
	return (
		<CenterAgentSectionFrame>
			<CenterAgentRoutinesPage
				focusRoutineId={routineId && runId ? routineId : null}
				focusRunId={routineId && runId ? runId : null}
				onClearFocusedRun={() => {
					navigate({
						params: { orgSlug },
						search: { routineId: undefined, runId: undefined },
						to: "/o/$orgSlug/center-agent/routines",
					}).catch((error: unknown) => {
						console.error("Failed to clear the selected Routine run.", error);
					});
				}}
			/>
		</CenterAgentSectionFrame>
	);
}
