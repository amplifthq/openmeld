import { env } from "cloudflare:workers";
import { createFileRoute } from "@tanstack/react-router";
import { desktopUpdateArtifactResponse } from "#/lib/desktop-update-response";

export const Route = createFileRoute(
	"/desktop/updates/$candidate/windows-arm64.exe"
)({
	server: {
		handlers: {
			GET: ({ params }) =>
				desktopUpdateArtifactResponse(
					env.OPENMELD_DESKTOP_DOWNLOADS,
					"windows-arm64",
					params.candidate,
					true
				),
			HEAD: ({ params }) =>
				desktopUpdateArtifactResponse(
					env.OPENMELD_DESKTOP_DOWNLOADS,
					"windows-arm64",
					params.candidate,
					false
				),
		},
	},
});
