import { createFileRoute, redirect } from "@tanstack/react-router";
import { OrganizationSkillDetailPage } from "#/components/organization-skills/organization-skill-detail-page";
import { skillContentParser } from "#/lib/page-tab-search";

export const Route = createFileRoute("/o/$orgSlug/skills/$skillId")({
	validateSearch: (
		search: Record<string, unknown>
	): { content?: "instructions" | "files" } => ({
		content:
			typeof search.content === "string"
				? (skillContentParser.parse(search.content) ?? undefined)
				: undefined,
	}),
	beforeLoad: ({ location, params, search }) => {
		if (
			location.hash === "skill-files-heading" ||
			location.hash === "skill-instructions-heading"
		) {
			throw redirect({
				to: "/o/$orgSlug/skills/$skillId",
				params,
				search: {
					...search,
					content:
						location.hash === "skill-files-heading" ? "files" : undefined,
				},
				hash: "",
				replace: true,
			});
		}
	},
	component: SkillRoute,
});

function SkillRoute() {
	return <OrganizationSkillDetailPage skillId={Route.useParams().skillId} />;
}
