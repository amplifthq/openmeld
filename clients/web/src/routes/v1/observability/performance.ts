import { createFileRoute } from "@tanstack/react-router";
import { WEB_PERFORMANCE_POLICY } from "#/lib/observability/performance-policy";
import { receivePerformanceReport } from "#/lib/observability/performance-server";

export const Route = createFileRoute("/v1/observability/performance")({
	server: {
		handlers: {
			GET: () =>
				Response.json(WEB_PERFORMANCE_POLICY, {
					headers: { "Cache-Control": "public, max-age=300" },
				}),
			POST: ({ request }) => receivePerformanceReport(request),
		},
	},
});
