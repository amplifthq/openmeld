import { createFileRoute, notFound } from "@tanstack/react-router";
import { LocalAgentInstallGuideDetailPage } from "#/components/local-agent-install-guides/local-agent-install-guide-pages";
import { getLocalAgentInstallGuide } from "#/lib/local-agent-install-guides";

export const Route = createFileRoute("/guides/local-agents/$agentId")({
	component: LocalAgentGuideDetailRoute,
	loader: ({ params }) => {
		const guide = getLocalAgentInstallGuide(params.agentId);
		if (!guide) {
			throw notFound();
		}
		return { guide };
	},
});

function LocalAgentGuideDetailRoute() {
	const { guide } = Route.useLoaderData();
	return <LocalAgentInstallGuideDetailPage guide={guide} />;
}
