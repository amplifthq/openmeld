import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/guides/local-agents")({
	beforeLoad: ({ location }) => {
		throw redirect({
			href: `${import.meta.env.VITE_WEBSITE_URL}${location.pathname}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
		});
	},
});
