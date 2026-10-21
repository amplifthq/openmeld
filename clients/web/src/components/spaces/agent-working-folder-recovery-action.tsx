"use client";

import { AgentProfileWorkingFolderRecoveryAction } from "#/components/profiles/agent-profile-working-folder-recovery-action";
import { useOptionalSpaceAgentProfileEditContext } from "./space-agent-profile-edit-context";

export function AgentWorkingFolderRecoveryAction(input: {
	className?: string;
	folderMissing?: boolean;
	fromReadiness?: boolean;
	label?: string;
	profileId?: string;
}) {
	const edit = useOptionalSpaceAgentProfileEditContext();
	const profile = input.profileId
		? edit?.profilesById.get(input.profileId)
		: undefined;
	if (!(profile && edit?.context)) {
		return (
			<p className="text-muted-foreground text-xs">
				Ask this agent’s owner to review its working folder.
			</p>
		);
	}
	const context = edit.context;
	return (
		<AgentProfileWorkingFolderRecoveryAction
			actorProfileId={context.actorProfileId}
			className={input.className}
			folderMissing={input.folderMissing}
			fromReadiness={input.fromReadiness}
			key={profile.openMeldProfileId}
			label={input.label}
			onProfileUpdated={(updated) => {
				context.onSaved(updated.openMeldProfileId).catch((error: unknown) => {
					console.error("Failed to refresh working-folder settings.", error);
				});
			}}
			organizationId={context.organizationId}
			profile={profile}
			storageScope={context.storageScope}
		/>
	);
}
