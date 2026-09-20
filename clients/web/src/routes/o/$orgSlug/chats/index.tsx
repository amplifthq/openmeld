import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/o/$orgSlug/chats/")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/o/$orgSlug/spaces",
			params,
			search: { view: "messages" },
			replace: true,
		});
	},
});
