import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { desktopUpdateArtifactResponse } from "#/lib/desktop-update-response";

export async function desktopUpdateDownload(
	candidate: string,
	includeBody: boolean
) {
	return await desktopUpdateArtifactResponse(
		env.OPENMELD_DESKTOP_DOWNLOADS,
		"macos-arm64",
		candidate,
		includeBody
	);
}
export const Route = createFileRoute("/desktop/updates/$candidate/desktop.zip")(
	{
		server: {
			handlers: {
				GET: ({ params }) => desktopUpdateDownload(params.candidate, true),
				HEAD: ({ params }) => desktopUpdateDownload(params.candidate, false),
			},
		},
	}
);
