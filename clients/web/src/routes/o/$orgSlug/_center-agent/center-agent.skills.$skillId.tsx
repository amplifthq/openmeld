import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { OrganizationSkillDetailPage } from "#/components/organization-skills/organization-skill-detail-page";
import { CenterAgentSectionFrame } from "#/components/organizations/center-agent-section-frame";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/skills/$skillId"
)({
	staticData: appShellStaticData.centerAgent,
	component: OrganizationSkillRoute,
});

function OrganizationSkillRoute() {
	const { skillId } = Route.useParams();
	return (
		<CenterAgentSectionFrame>
			<OrganizationSkillDetailPage skillId={skillId} />
		</CenterAgentSectionFrame>
	);
}
