import { createFileRoute, Outlet } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";

export const Route = createFileRoute("/o/$orgSlug/projects")({
	staticData: appShellStaticData.projects,
	component: ProjectsRoute,
});

function ProjectsRoute() {
	return <Outlet />;
}
