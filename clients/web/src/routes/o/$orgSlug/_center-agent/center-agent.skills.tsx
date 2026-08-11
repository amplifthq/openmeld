import { createFileRoute, Outlet } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/skills"
)({
	staticData: appShellStaticData.centerAgent,
	component: OrganizationSkillsRouteOutlet,
});

export function OrganizationSkillsRouteOutlet() {
	return <Outlet />;
}
