import { createFileRoute } from "@tanstack/react-router";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { ProjectDetailPage } from "#/components/projects/project-detail-page";

export const Route = createFileRoute("/o/$orgSlug/projects/$projectId")({
	staticData: appShellStaticData.projects,
	component: ProjectDetailRoute,
});

function ProjectDetailRoute() {
	const { projectId } = Route.useParams();
	return (
		<AppFullWidthLayout>
			<ProjectDetailPage projectId={projectId} />
		</AppFullWidthLayout>
	);
}
