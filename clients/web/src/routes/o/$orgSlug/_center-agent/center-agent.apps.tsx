import { createFileRoute, redirect } from "@tanstack/react-router";

// Preserve links already published before the Plugins rename.
export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/apps"
)({
	beforeLoad: ({ location }) => {
		throw redirect({
			href:
				location.pathname.replace(
					"/center-agent/apps",
					"/center-agent/plugins"
				) +
				location.searchStr +
				location.hash,
			replace: true,
		});
	},
});
