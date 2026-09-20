import { createFileRoute } from "@tanstack/react-router";
import { OrganizationSkillsListPage } from "#/components/organization-skills/organization-skills-list-page";

export const Route = createFileRoute("/o/$orgSlug/skills/")({
	component: OrganizationSkillsListPage,
});
