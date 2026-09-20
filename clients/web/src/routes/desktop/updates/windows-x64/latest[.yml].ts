import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { desktopUpdateFeedResponse } from "#/lib/desktop-update-response";

export const Route = createFileRoute("/desktop/updates/windows-x64/latest.yml")(
	{
		server: {
			handlers: {
				GET: () =>
					desktopUpdateFeedResponse(
						env.OPENMELD_DESKTOP_DOWNLOADS,
						"windows-x64"
					),
			},
		},
	}
);
