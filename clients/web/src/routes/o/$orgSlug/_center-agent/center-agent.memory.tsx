import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { CenterAgentSectionFrame } from "#/components/organizations/center-agent-section-frame";
import { OrganizationMemoryPage } from "#/components/organizations/organization-memory-page";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/memory"
)({
	staticData: appShellStaticData.centerAgent,
	component: MemoryRoute,
});

function MemoryRoute() {
	return (
		<CenterAgentSectionFrame>
			<OrganizationMemoryPage />
		</CenterAgentSectionFrame>
	);
}
