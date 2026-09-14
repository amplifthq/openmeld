import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { DesktopDownloadPage } from "#/components/desktop-download/desktop-download-page";
import { readAvailableDesktopRelease } from "#/lib/desktop-release";

const readDesktopDownload = createServerFn({ method: "GET" }).handler(
	async () => {
		// Direct server-function calls must respect the distribution pause too.
		if (!import.meta.env.DEV) {
			throw notFound();
		}
		const { env } = await import("cloudflare:workers");
		return readAvailableDesktopRelease(env.OPENMELD_DESKTOP_DOWNLOADS);
	}
);

export const Route = createFileRoute("/desktop")({
	beforeLoad: () => {
		// Keep Desktop distribution unavailable until the app passes the production release bar.
		if (!import.meta.env.DEV) {
			throw notFound();
		}
	},
	loader: () => readDesktopDownload(),
	component: DesktopRoute,
});

function DesktopRoute() {
	return <DesktopDownloadPage release={Route.useLoaderData()} />;
}
