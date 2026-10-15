import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import type { OptimisticAgentProfileCreation } from "#/lib/profiles/agent-profile-creation-requests";
import { CreateProfileDialogStep } from "./create-profile-dialog";

export function PeopleAgentPickerCreateAgent(input: {
	onBack: () => void;
	onBusyChange: (busy: boolean) => void;
	onStarted: (creation: OptimisticAgentProfileCreation) => void;
	onFailed: (message: string) => void;
	onAccepted: (request: AgentProfileCreationRequest) => void;
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
			onAgentRequestStarted={input.onStarted}
			onBusyChange={input.onBusyChange}
			onOpenChange={(open) => {
				if (!open) {
					input.onBack();
				}
			}}
			open
			organizationId={currentOrganization.id}
			orgSlug={currentOrganization.slug}
			recovery={recovery}
			waitForAgentRequestCompletion={false}
		/>
	);
}
