import { createFileRoute, Outlet } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/tasks"
)({
	staticData: appShellStaticData.centerAgent,
	component: CenterAgentTasksRouteOutlet,
});

export function CenterAgentTasksRouteOutlet() {
	return <Outlet />;
}
