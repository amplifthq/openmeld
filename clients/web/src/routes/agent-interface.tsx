import { createFileRoute } from "@tanstack/react-router";
import { AgentInterfacePage } from "#/components/agent-interface/agent-interface-page";
import { getSession } from "#/lib/auth-session";

export const Route = createFileRoute("/agent-interface")({
	loader: async () => {
		const session = await getSession({
			data: {
				currentUserSessionExpectation: "optional",
				routeFamily: "/agent-interface",
				sessionCacheMode: "bypass",
			},
		});
		return { isAuthenticated: Boolean(session) };
	},
	component: AgentInterfaceRoute,
});

function AgentInterfaceRoute() {
	const { isAuthenticated } = Route.useLoaderData();

	return <AgentInterfacePage isAuthenticated={isAuthenticated} />;
}
