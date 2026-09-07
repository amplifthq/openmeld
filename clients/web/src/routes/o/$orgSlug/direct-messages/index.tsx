import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/o/$orgSlug/direct-messages/")({
	beforeLoad: ({ params, search }) => {
		throw redirect({ to: "/o/$orgSlug/chats", params, search, replace: true });
	},
});
