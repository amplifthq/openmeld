import { createFileRoute } from "@tanstack/react-router";
// The parent redirects existing deep links to the primary Plugins destination.
export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/plugins/$service"
)({});
