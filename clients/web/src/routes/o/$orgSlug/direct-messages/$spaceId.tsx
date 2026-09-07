import { createFileRoute, redirect } from "@tanstack/react-router";
import { parseDirectMessageRouteSearch } from "#/lib/spaces/direct-message-route-search";

export const Route = createFileRoute("/o/$orgSlug/direct-messages/$spaceId")({
	validateSearch: parseDirectMessageRouteSearch,
	beforeLoad: ({ params, search }) => {
		throw redirect({
			to: "/o/$orgSlug/chats/$spaceId",
			params,
			search,
			replace: true,
		});
	},
});
