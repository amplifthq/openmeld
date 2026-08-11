import { createFileRoute, Outlet } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";

export const Route = createFileRoute("/o/$orgSlug/directory")({
	staticData: appShellStaticData.people,
	component: AppDirectoryLayoutRoute,
});

function AppDirectoryLayoutRoute() {
	return <Outlet />;
}
