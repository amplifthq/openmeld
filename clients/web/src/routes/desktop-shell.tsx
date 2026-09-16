import { createFileRoute } from "@tanstack/react-router";
import { desktopReturnPath } from "#/desktop/auth-boundary";
import { DesktopEntry } from "#/desktop/desktop-entry";

// A loader-free document for the local Desktop SPA build. Business routes
// load their normal data only after the native authenticated transport exists.
export const Route = createFileRoute("/desktop-shell")({
	validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
		redirect: desktopReturnPath(search.redirect),
	}),
	component: DesktopEntry,
});
