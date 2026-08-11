import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { CenterAgentRoutinesPage } from "#/components/organizations/center-agent-routines-page";
import { CenterAgentSectionFrame } from "#/components/organizations/center-agent-section-frame";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/routines"
)({
	staticData: appShellStaticData.centerAgent,
	component: RoutinesRoute,
});

function RoutinesRoute() {
	return (
		<CenterAgentSectionFrame>
			<CenterAgentRoutinesPage />
		</CenterAgentSectionFrame>
	);
}
