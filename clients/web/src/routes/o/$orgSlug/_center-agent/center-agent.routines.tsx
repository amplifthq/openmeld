import { createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod/v4";

// Keep existing bookmarks and run links without a second management surface.
export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/routines"
)({
	validateSearch: z.object({
		routineId: z.string().trim().min(1).max(256).optional(),
		runId: z.string().trim().min(1).max(256).optional(),
	}),
	beforeLoad: ({ params, search }) => {
		throw redirect({
			to: "/o/$orgSlug/routines",
			params,
			search: { routineId: search.routineId, runId: search.runId },
			replace: true,
		});
	},
});
