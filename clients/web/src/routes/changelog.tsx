import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/changelog")({
	beforeLoad: ({ location }) => {
		throw redirect({
			href: `https://openmeld.ai${location.pathname}${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
		});
	},
});
