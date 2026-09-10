import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Navigate,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { z } from "zod/v4";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { PeopleAndAgentsPage } from "#/components/profiles/people-and-agents-page";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAgentCreationPath,
	buildOrganizationAgentCreationRequestsPath,
	buildOrganizationPeoplePath,
	buildOrganizationPersonAgentPath,
	buildOrganizationPersonAgentsPath,
} from "#/lib/organizations/organization-routes";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";

export const Route = createFileRoute("/o/$orgSlug/agents")({
	staticData: appShellStaticData.people,
	validateSearch: z.object({
		profileId: z.string().optional(),
		requestId: z.string().optional(),
		view: z.enum(["agents", "create", "requests"]).optional(),
	}),
	beforeLoad: ({ params, search }) => {
		if (search.view === "create") {
			throw redirect({
				to: buildOrganizationAgentCreationPath(params.orgSlug),
				replace: true,
			});
		}
		if (search.view === "requests") {
			throw redirect({
				to: buildOrganizationAgentCreationRequestsPath({
					orgSlug: params.orgSlug,
					requestId: search.requestId,
				}),
				replace: true,
			});
		}
	},
	component: TeamAgentsRoute,
});

function TeamAgentsRoute() {
	const { profileId } = Route.useSearch();
	const { currentOrganization, currentUserId } = useAppOrganization();
	const navigate = useNavigate();
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	if (!profileId) {
		return (
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusProfileId={null}
				onAgentViewChange={(view) => {
					if (view === "requests") {
						navigate({
							to: buildOrganizationAgentCreationRequestsPath({
								orgSlug: currentOrganization.slug,
							}),
						}).catch(console.error);
					}
				}}
			/>
		);
	}
	if (directory.isPending || directory.isError) {
		return (
			<AppFullWidthLayout>
				<p role={directory.isError ? "alert" : "status"}>
					{directory.isError
						? "Couldn’t load this Agent. Try again."
						: "Loading Agent…"}
				</p>
			</AppFullWidthLayout>
		);
	}
	const profile = directory.data.agentProfiles.find(
		(agent) => agent.profileId === profileId
	);
	if (profileId && !profile) {
		return (
			<AppFullWidthLayout>
				<p>Agent not found in this workspace.</p>
			</AppFullWidthLayout>
		);
	}
	const member = directory.data.members.find(
		(person) => person.userId === (profile?.ownerUserId ?? currentUserId)
	);
	const orgSlug = currentOrganization.slug;
	if (!member) {
		return <Navigate replace to={buildOrganizationPeoplePath(orgSlug)} />;
	}
	const personId =
		member.humanProfile?.profileId ?? `member:${member.memberId}`;
	return (
		<Navigate
			replace
			to={
				profile
					? buildOrganizationPersonAgentPath({
							orgSlug,
							personId,
							agentId: profile.profileId,
						})
					: buildOrganizationPersonAgentsPath({ orgSlug, personId })
			}
		/>
	);
}
