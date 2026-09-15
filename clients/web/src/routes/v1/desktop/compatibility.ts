import {
	DESKTOP_CONTRACT_VERSION,
	desktopCompatibilitySchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/v1/desktop/compatibility")({
	server: {
		handlers: {
			GET: () =>
				Response.json(
					desktopCompatibilitySchema.parse({
						contractVersion: DESKTOP_CONTRACT_VERSION,
					}),
					{ headers: { "cache-control": "no-store" } }
				),
		},
	},
});
