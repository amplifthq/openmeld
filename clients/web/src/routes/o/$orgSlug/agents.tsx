import { useQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Navigate,
	redirect,
	useNavigate,
} from "@tanstack/react-router";
import { z } from "zod/v4";
import { AgentResolutionPage } from "#/components/agents/agent-resolution-page";
import { appShellStaticData } from "#/components/app/shell-layout";
import { PeopleAndAgentsPage } from "#/components/profiles/people-and-agents-page";
import { prefetchAgentsRouteIdentityData } from "#/lib/organizations/app-route-prefetch";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationAgentCreationPath,
	buildOrganizationAgentCreationRequestsPath,
	buildOrganizationAgentsPath,
	buildOrganizationPeoplePath,
	buildOrganizationPersonAgentPath,
	buildOrganizationPersonAgentsPath,
} from "#/lib/organizations/organization-routes";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";
import { memberAgentProfilesQueryOptions } from "#/query/organizations/member-agents";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";

export const Route = createFileRoute("/o/$orgSlug/agents")({
	staticData: appShellStaticData.people,
	validateSearch: z.object({
		profileId: z.string().optional(),
		memberAgentId: z.string().optional(),
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
	loader: async ({ context, location, params }) => {
		prefetchAgentsRouteIdentityData({
			organizationSlug: params.orgSlug,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
		}).catch((error: unknown) => {
			console.error("Failed to prefetch the Agents route data.", error);
		});
		return { sidebarStates: await getAppSidebarStatesForRoute() };
	},
	component: TeamAgentsRoute,
});

function TeamAgentsRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { profileId, memberAgentId, requestId } = Route.useSearch();
	const { currentOrganization, currentUserId } = useAppOrganization();
	const navigate = useNavigate();
	const directory = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const memberAgentLink = useTeammateMemberAgentLink({
		currentUserId,
		memberAgentId: profileId ? null : (memberAgentId ?? null),
		organizationId: currentOrganization.id,
	});
	if (memberAgentLink.status === "pending") {
		return (
			<AgentResolutionPage
				detail
				initialSidebarStates={sidebarStates}
				isPending
			/>
		);
	}
	if (memberAgentLink.status === "teammate") {
		return (
			<Navigate
				replace
				search={{ profileId: memberAgentLink.profileId }}
				to={buildOrganizationAgentsPath(currentOrganization.slug)}
			/>
		);
	}
	if (!profileId) {
		return (
			<PeopleAndAgentsPage
				activeSectionId="agents"
				focusMemberAgentId={memberAgentId ?? null}
				focusProfileId={null}
				focusRequestId={requestId ?? null}
				initialSidebarStates={sidebarStates}
				onAgentViewChange={(view, focusedRequestId) => {
					if (view === "requests") {
						navigate({
							to: buildOrganizationAgentCreationRequestsPath({
								orgSlug: currentOrganization.slug,
								requestId: focusedRequestId,
							}),
						}).catch(console.error);
						return;
					}
					if (focusedRequestId) {
						navigate({
							to: buildOrganizationAgentsPath(currentOrganization.slug),
							search: { requestId: focusedRequestId },
						}).catch(console.error);
					}
				}}
			/>
		);
	}
	if (directory.isPending || directory.isError) {
		return (
			<AgentResolutionPage
				detail
				error={directory.isError}
				initialSidebarStates={sidebarStates}
				isPending={directory.isPending}
				isRetrying={directory.isFetching}
				message="Couldn’t load this Agent."
				onRetry={
					directory.isError
						? () => {
								directory.refetch().catch(console.error);
							}
						: undefined
				}
			/>
		);
	}
	const profile = directory.data.agentProfiles.find(
		(agent) => agent.profileId === profileId
	);
	if (profileId && !profile) {
		return (
			<AgentResolutionPage
				detail
				initialSidebarStates={sidebarStates}
				isPending={false}
				message="Agent not found in this workspace."
			/>
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
			search={profile ? { from: "agents" } : undefined}
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

// A MemberAgent link may name a teammate's Agent, which the owner-only
// MemberAgent reads cannot see. It resolves to that Agent's visible Profile,
// whose page is read-only for teammates. The member's own Agents, and links
// that resolve to nothing, stay on the Agents page.
function useTeammateMemberAgentLink(input: {
	currentUserId: string;
	memberAgentId: string | null;
	organizationId: string;
}): { status: "none" | "pending" } | { status: "teammate"; profileId: string } {
	const link = useQuery(
		memberAgentProfilesQueryOptions({
			enabled: input.memberAgentId !== null,
			memberAgentId: input.memberAgentId ?? "",
			organizationId: input.organizationId,
		})
	);
	if (input.memberAgentId === null) {
		return { status: "none" };
	}
	if (link.isPending) {
		return { status: "pending" };
	}
	const profileId =
		link.data && link.data.ownerUserId !== input.currentUserId
			? (link.data.defaultProfileId ?? link.data.profileIds[0] ?? null)
			: null;
	return profileId ? { status: "teammate", profileId } : { status: "none" };
}
