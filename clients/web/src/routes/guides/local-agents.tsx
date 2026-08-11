import {
	createFileRoute,
	Outlet,
	useRouterState,
} from "@tanstack/react-router";
import { LocalAgentInstallGuideIndexPage } from "#/components/local-agent-install-guides/local-agent-install-guide-pages";
import { LOCAL_AGENTS_GUIDE_PATH } from "#/lib/local-agent-install-guides";

export const Route = createFileRoute("/guides/local-agents")({
	component: LocalAgentsGuideRoute,
});

export function LocalAgentsGuideRoute() {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});
	if (
		pathname !== LOCAL_AGENTS_GUIDE_PATH &&
		pathname !== `${LOCAL_AGENTS_GUIDE_PATH}/`
	) {
		return <Outlet />;
	}
	return <LocalAgentInstallGuideIndexPage />;
}
