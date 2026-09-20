import { createFileRoute } from "@tanstack/react-router";
import { OrganizationSkillDetailPage } from "#/components/organization-skills/organization-skill-detail-page";

export const Route = createFileRoute("/o/$orgSlug/skills/$skillId")({
	component: SkillRoute,
});

function SkillRoute() {
	return <OrganizationSkillDetailPage skillId={Route.useParams().skillId} />;
}
