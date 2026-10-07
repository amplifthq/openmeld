import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import type { SpaceAddMembersCandidateSummary } from "../spaces/people-agent-picker-model";
import { CreateProfileDialogStep } from "./create-profile-dialog";

export function PeopleAgentPickerCreateAgent(input: {
	onBack: () => void;
	onBusyChange: (busy: boolean) => void;
	onCreated: (agent: SpaceAddMembersCandidateSummary) => void;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const recovery = useLocalAgentRecoveryController({
		currentLocalRuntimeReplyReadinessRefetchIntervalMs: false,
		loadAgentExecutionReadiness: false,
		loadAgentProfiles: false,
		loadSetupState: false,
	});
	return (
		<CreateProfileDialogStep
			agentOnly
			allowTeammateRequests={!currentOrganization.isPersonal}
			currentUserId={currentUserId}
			onAgentRequestCreated={(request) => {
				if (request.createdAgentProfileId) {
					input.onCreated({
						profileId: request.createdAgentProfileId,
						profileName: request.profileName,
						profileKind: "agent",
						ownerUserId: request.targetOwnerUserId,
						searchText: request.profileName.toLocaleLowerCase(),
					});
				}
			}}
			onBusyChange={input.onBusyChange}
			onOpenChange={(open) => {
				if (!open) {
					input.onBack();
				}
			}}
			onProfileCreated={(profile) =>
				input.onCreated({
					profileId: profile.openMeldProfileId,
					profileName: profile.profileName,
					profileKind: "agent",
					ownerUserId: profile.ownerUserId ?? currentUserId,
					searchText: profile.profileName.toLocaleLowerCase(),
				})
			}
			open
			organizationId={currentOrganization.id}
			orgSlug={currentOrganization.slug}
			recovery={recovery}
		/>
	);
}
