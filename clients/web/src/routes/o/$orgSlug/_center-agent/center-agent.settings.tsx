import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { CenterAgentSectionFrame } from "#/components/organizations/center-agent-section-frame";
import { CenterAgentSettingsPage } from "#/components/organizations/center-agent-settings-page";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/settings"
)({
	staticData: appShellStaticData.centerAgent,
	component: CenterAgentSettingsRoute,
});

function CenterAgentSettingsRoute() {
	return (
		<CenterAgentSectionFrame>
			<CenterAgentSettingsPage />
		</CenterAgentSectionFrame>
	);
}
