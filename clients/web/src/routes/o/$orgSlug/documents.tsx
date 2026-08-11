import { createFileRoute, Outlet } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";

export const Route = createFileRoute("/o/$orgSlug/documents")({
	staticData: appShellStaticData.documents,
	component: DocumentsLayoutRoute,
});

function DocumentsLayoutRoute() {
	return <Outlet />;
}
