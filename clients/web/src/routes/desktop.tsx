import { createFileRoute, notFound } from "@tanstack/react-router";
import { DesktopDownloadPage } from "#/components/desktop-download/desktop-download-page";

export const Route = createFileRoute("/desktop")({
	beforeLoad: () => {
		// Keep Desktop distribution unavailable until the app passes the production release bar.
		throw notFound();
	},
	component: DesktopRoute,
});

function DesktopRoute() {
	return <DesktopDownloadPage />;
}
