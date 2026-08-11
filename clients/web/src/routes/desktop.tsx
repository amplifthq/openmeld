import { createFileRoute } from "@tanstack/react-router";
import { DesktopDownloadPage } from "#/components/desktop-download/desktop-download-page";

export const Route = createFileRoute("/desktop")({
	component: DesktopRoute,
});

function DesktopRoute() {
	return <DesktopDownloadPage />;
}
