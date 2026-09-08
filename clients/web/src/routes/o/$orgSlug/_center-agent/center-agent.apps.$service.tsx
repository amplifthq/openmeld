import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/apps/$service"
)({
	beforeLoad: ({ params }) => {
		throw redirect({
			href: `/o/${encodeURIComponent(params.orgSlug)}/center-agent/plugins/${encodeURIComponent(params.service)}`,
			replace: true,
		});
	},
});
