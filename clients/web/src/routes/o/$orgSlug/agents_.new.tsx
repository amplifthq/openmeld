import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import { appShellStaticData } from "#/components/app/shell-layout";
import { CreateAgentProfilePage } from "#/components/profiles/create-profile-dialog";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationAgentsPath } from "#/lib/organizations/organization-routes";
import { getAppSidebarStatesForRoute } from "#/lib/sidebar-width-cookie";

export const Route = createFileRoute("/o/$orgSlug/agents_/new")({
	staticData: appShellStaticData.newAgent,
	loader: async () => ({
		sidebarStates: await getAppSidebarStatesForRoute("agents"),
	}),
	component: NewAgentRoute,
});

function NewAgentRoute() {
	const { sidebarStates } = Route.useLoaderData();
	const { currentOrganization, currentUserId } = useAppOrganization();
	const navigate = useNavigate();
	const agentsPath = buildOrganizationAgentsPath(currentOrganization.slug);
	const recovery = useLocalAgentRecoveryController({
		agentExecutionReadinessScope: "bound_runtime",
		loadAgentProfiles: false,
		loadSetupState: false,
	});
	return (
		<AppFullWidthLayout
			contentLayout="flush"
			initialOuterSidebarState={sidebarStates.outer}
			scroll={false}
		>
			<CreateAgentProfilePage
				allowTeammateRequests={currentOrganization.isPersonal !== true}
				currentUserId={currentUserId}
				key={currentOrganization.id}
				onAgentRequestCreated={async (request) => {
					await navigate({
						to: agentsPath,
						search: request.createdAgentProfileId
							? { profileId: request.createdAgentProfileId }
							: { view: "requests", requestId: request.id },
					});
				}}
				onCancel={() => {
					navigate({ to: agentsPath }).catch((error: unknown) => {
						console.error("Failed to return to Agents.", error);
					});
				}}
				onProfileCreated={async (profile) => {
					await navigate({
						to: agentsPath,
						search: { profileId: profile.openMeldProfileId },
					});
				}}
				organizationId={currentOrganization.id}
				recovery={recovery}
			/>
		</AppFullWidthLayout>
	);
}
