import { createFileRoute, Outlet } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";

// The unified Settings destination — a routed parent over Account / Computers /
// Agents panels, with Service kept as a gated host-specific leaf. The parent is
// a thin layout: each leaf renders the unified shell with the active panel, so
// the parent only declares the `settings` shell section and renders the active
// leaf.
export const Route = createFileRoute("/o/$orgSlug/settings")({
	staticData: appShellStaticData.settings,
	component: AppSettingsLayoutRoute,
});

function AppSettingsLayoutRoute() {
	return <Outlet />;
}
