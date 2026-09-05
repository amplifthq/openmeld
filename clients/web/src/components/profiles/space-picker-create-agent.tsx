import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { CreateProfileDialogStep } from "./create-profile-dialog";

export function SpacePickerCreateAgent(input: {
	onBack: () => void;
	onBusyChange: (busy: boolean) => void;
	onCreated: (profileId: string) => Promise<void>;
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
			onAgentRequestCreated={async (request) => {
				if (request.createdAgentProfileId) {
					await input.onCreated(request.createdAgentProfileId);
				}
			}}
			onBusyChange={input.onBusyChange}
			onOpenChange={(open) => {
				if (!open) {
					input.onBack();
				}
			}}
			onProfileCreated={(profile) => input.onCreated(profile.openMeldProfileId)}
			open
			organizationId={currentOrganization.id}
			orgSlug={currentOrganization.slug}
			recovery={recovery}
		/>
	);
}
