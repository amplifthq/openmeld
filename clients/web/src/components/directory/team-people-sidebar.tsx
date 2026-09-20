import { useQuery } from "@tanstack/react-query";
import { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { useAppShellAccount } from "#/components/app/app-shell-account";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { organizationProfileDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import { DirectoryMembersOverview } from "./directory-members-overview";

// The Team tabs use the same directory data, person actions, and sidebar preferences.
export function TeamPeopleSidebar() {
	const account = useAppShellAccount();
	const { currentOrganization, currentUserId } = useAppOrganization();
	const directoryQuery = useQuery(
		organizationProfileDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const recovery = useLocalAgentRecoveryController({
		loadAgentProfiles: false,
		loadAgentExecutionReadiness: false,
		loadSetupState: false,
	});
	return (
		<DirectoryMembersOverview
			account={account}
			currentOrganization={currentOrganization}
			currentUserId={currentUserId}
			directoryQuery={directoryQuery}
			focusProfileId={null}
			onCreateProfile={() => {
				// Sidebar presentation has no profile-creation action.
			}}
			presentation="sidebar"
			recovery={recovery}
			storageScope={recovery.storageScope}
		/>
	);
}
