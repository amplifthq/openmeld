import { useNavigate } from "@tanstack/react-router";
import { PeopleAndAgentsPage } from "#/components/profiles/people-and-agents-page";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAgentCreationRequestsPath,
	buildOrganizationPersonAgentPath,
	buildOrganizationPersonAgentsPath,
} from "#/lib/organizations/organization-routes";
import type { AppSidebarPersistedStates } from "#/lib/sidebar-width-cookie";

export function PersonAgentsPage(input: {
	personId: string;
	agentId?: string;
	initialSidebarStates?: AppSidebarPersistedStates;
}) {
	const { currentOrganization } = useAppOrganization();
	const navigate = useNavigate();
	const orgSlug = currentOrganization.slug;
	return (
		<PeopleAndAgentsPage
			activeSectionId="agents"
			focusProfileId={input.agentId ?? null}
			initialSidebarStates={input.initialSidebarStates}
			onAgentViewChange={(view, profileId) => {
				if (view === "requests") {
					return navigate({
						to: buildOrganizationAgentCreationRequestsPath({ orgSlug }),
					});
				}
				return navigate({
					to: profileId
						? buildOrganizationPersonAgentPath({
								orgSlug,
								personId: input.personId,
								agentId: profileId,
							})
						: buildOrganizationPersonAgentsPath({
								orgSlug,
								personId: input.personId,
							}),
				});
			}}
			personId={input.personId}
		/>
	);
}
