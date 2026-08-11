import { createFileRoute } from "@tanstack/react-router";
import { OPENMELD_GUIDE_MARKDOWN } from "#/lib/openmeld-guide";

export const Route = createFileRoute("/guide.md")({
	server: {
		handlers: {
			GET: () =>
				new Response(OPENMELD_GUIDE_MARKDOWN, {
					headers: {
						"cache-control": "public, max-age=300",
						"content-type": "text/markdown; charset=utf-8",
						"x-content-type-options": "nosniff",
					},
				}),
		},
	},
});
