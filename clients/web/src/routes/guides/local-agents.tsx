import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/guides/local-agents")({
	beforeLoad: ({ location }) => {
		throw redirect({
			href: `https://openmeld.ai${location.pathname}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
		});
	},
});
