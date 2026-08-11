import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { OrganizationSkillsListPage } from "#/components/organization-skills/organization-skills-list-page";
import { CenterAgentSectionFrame } from "#/components/organizations/center-agent-section-frame";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/skills/"
)({
	staticData: appShellStaticData.centerAgent,
	component: OrganizationSkillsRoute,
});

function OrganizationSkillsRoute() {
	return (
		<CenterAgentSectionFrame>
			<OrganizationSkillsListPage />
		</CenterAgentSectionFrame>
	);
}
