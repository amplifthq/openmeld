import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import type { SpaceAddMembersCandidateSummary } from "../spaces/people-agent-picker-model";
import { CreateProfileDialogStep } from "./create-profile-dialog";

export function PeopleAgentPickerCreateAgent(input: {
	onBack: () => void;
	onBusyChange: (busy: boolean) => void;
	onStarted: (name: string) => void;
	onFailed: (message: string) => void;
	onAccepted: (request: AgentProfileCreationRequest) => void;
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
			onAgentRequestCreated={input.onAccepted}
			onAgentRequestFailed={(creation) =>
				input.onFailed(
					creation.failureMessage ?? "Couldn't create Agent. Try again."
				)
			}
			onAgentRequestStarted={(creation) =>
				input.onStarted(creation.profileName)
			}
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
			waitForAgentRequestCompletion={false}
		/>
	);
}
