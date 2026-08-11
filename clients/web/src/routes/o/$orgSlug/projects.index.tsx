import { createFileRoute } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { ProjectsPage } from "#/components/projects/projects-page";

export const Route = createFileRoute("/o/$orgSlug/projects/")({
	component: ProjectsIndexRoute,
});

function ProjectsIndexRoute() {
	return (
		<AppFullWidthLayout>
			<ProjectsPage />
		</AppFullWidthLayout>
	);
}
