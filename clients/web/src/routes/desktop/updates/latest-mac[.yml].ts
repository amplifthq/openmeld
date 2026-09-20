import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { desktopUpdateFeedResponse } from "#/lib/desktop-update-response";

export async function desktopUpdaterFeed() {
	return await desktopUpdateFeedResponse(
		env.OPENMELD_DESKTOP_DOWNLOADS,
		"macos-arm64"
	);
}
export const Route = createFileRoute("/desktop/updates/latest-mac.yml")({
	server: { handlers: { GET: desktopUpdaterFeed } },
});
