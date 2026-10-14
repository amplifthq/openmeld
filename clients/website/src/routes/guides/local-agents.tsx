import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/guides/local-agents")({
	component: Outlet,
	beforeLoad: ({ location }) => {
		if (
			location.pathname === "/guides/local-agents" ||
			location.pathname === "/guides/local-agents/"
		) {
			throw redirect({
				href: `${import.meta.env.VITE_DOCS_URL}/docs/start/local-agents`,
				statusCode: 301,
			});
		}
	},
});
