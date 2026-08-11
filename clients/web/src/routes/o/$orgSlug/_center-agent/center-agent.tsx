import { createFileRoute, Outlet } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";

export const Route = createFileRoute("/o/$orgSlug/_center-agent/center-agent")({
	staticData: appShellStaticData.centerAgent,
	component: CenterAgentRouteOutlet,
});

export function CenterAgentRouteOutlet() {
	return <Outlet />;
}
