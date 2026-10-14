import { getLocalAgentInstallGuide } from "@openmeld/product-catalog/local-agent-install-guides";
import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/guides/local-agents/$agentId")({
	beforeLoad: ({ params }) => {
		const guide = getLocalAgentInstallGuide(params.agentId);
		if (!guide) {
			throw notFound();
		}
		throw redirect({
			href: `${import.meta.env.VITE_DOCS_URL}/docs/start/local-agents/${guide.agentId}`,
			statusCode: 301,
		});
	},
});
