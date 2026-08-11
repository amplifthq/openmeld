import { createFileRoute } from "@tanstack/react-router";
import { OPENMELD_SKILL_MARKDOWN } from "#/lib/agent-interface-guide";

export const Route = createFileRoute("/agent-interface/guide.md")({
	server: {
		handlers: {
			GET: () =>
				new Response(OPENMELD_SKILL_MARKDOWN, {
					headers: {
						"cache-control": "public, max-age=300",
						"content-type": "text/markdown; charset=utf-8",
						"x-content-type-options": "nosniff",
					},
				}),
		},
	},
});
