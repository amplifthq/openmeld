import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { z } from "zod/v4";
import { appShellStaticData } from "#/components/app/shell-layout";
import { PeopleAndAgentsPage } from "#/components/profiles/people-and-agents-page";
import { buildOrganizationPeoplePath } from "#/lib/organizations/organization-routes";
import { buildAgentProfilePath } from "#/lib/profile-routes";

const searchSchema = z.object({ requestId: z.string().optional() });
export const Route = createFileRoute("/o/$orgSlug/people_/agent-requests")({
	staticData: appShellStaticData.people,
	validateSearch: searchSchema,
	component: AgentRequestsRoute,
});
function AgentRequestsRoute() {
	const { orgSlug } = Route.useParams();
	const { requestId } = Route.useSearch();
	const navigate = useNavigate();
	return (
		<PeopleAndAgentsPage
			activeAgentView="requests"
			activeSectionId="agents"
			focusProfileId={null}
			focusRequestId={requestId}
			onAgentViewChange={(_view, profileId) => {
				return navigate({
					to: profileId
						? buildAgentProfilePath({ orgSlug, profileId })
						: buildOrganizationPeoplePath(orgSlug),
				});
			}}
		/>
	);
}
