import { createFileRoute } from "@tanstack/react-router";
import { appShellStaticData } from "#/components/app/shell-layout";
import { CenterAgentSectionFrame } from "#/components/organizations/center-agent-section-frame";
import { OrganizationMessageChannelsPage } from "#/components/organizations/organization-message-channels-page";
import {
	parseCenterAgentRouteSearch,
	resolveSlackOAuthResult,
} from "#/lib/organizations/center-agent-route-search";

export const Route = createFileRoute(
	"/o/$orgSlug/_center-agent/center-agent/channels"
)({
	staticData: appShellStaticData.centerAgent,
	validateSearch: parseCenterAgentRouteSearch,
	component: ChannelsRoute,
});

function ChannelsRoute() {
	const slackOAuthResult = resolveSlackOAuthResult(Route.useSearch());
	return (
		<CenterAgentSectionFrame
			routeState={{ channelsSlackOAuthResult: slackOAuthResult }}
		>
			<OrganizationMessageChannelsPage />
		</CenterAgentSectionFrame>
	);
}
