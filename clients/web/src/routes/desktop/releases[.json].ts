import { createFileRoute } from "@tanstack/react-router";
import { getDesktopDownloads } from "#/lib/desktop-downloads";

export const Route = createFileRoute("/desktop/releases.json")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const { env } = await import("cloudflare:workers");
				return getDesktopDownloads(request, env.OPENMELD_DESKTOP_DOWNLOADS);
			},
		},
	},
});
