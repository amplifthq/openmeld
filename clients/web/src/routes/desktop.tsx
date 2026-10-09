import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/desktop")({
	beforeLoad: ({ location }) => {
		if (location.pathname !== "/desktop" && location.pathname !== "/desktop/") {
			return;
		}
		throw redirect({
			href: `${import.meta.env.VITE_WEBSITE_URL}/downloads${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
		});
	},
});
