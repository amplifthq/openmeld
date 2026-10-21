import { useQuery } from "@tanstack/react-query";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { agentProfileFoldersQueryOptions } from "#/query/profiles/agent-profile-folders";
import { startProfilesQueryOptions } from "#/query/profiles/profiles";
import { composerFolderOptions } from "./space-composer-folder-choice";
import { SpaceComposerAgentOptions } from "./space-composer-task-menu";

/** Resolve only readable, configured projects; never guess a local directory. */
export function SpaceComposerAgentOptionsWithProject(
	input: Parameters<typeof SpaceComposerAgentOptions>[0]
) {
	const { storageScope } = useStartFlowState();
	const organization = useOptionalAppOrganization()?.currentOrganization;
	const profiles = useQuery(
		startProfilesQueryOptions({
			enabled: Boolean(storageScope),
			storageScope: storageScope ?? "",
		})
	);
	const projectId =
		(input.choice?.selection && "projectWork" in input.choice.selection
			? input.choice.selection.projectWork?.projectId
			: undefined) ??
		profiles.data?.find(
			(profile) => profile.openMeldProfileId === input.targetProfileId
		)?.defaultProjectId;
	const projects = useQuery(
		projectsQueryOptions({
			enabled: Boolean(projectId && (input.organizationId || organization)),
			organizationId: input.organizationId ?? organization?.id ?? "",
		})
	);
	const project = projects.data?.projects.find((item) => item.id === projectId);
	// Only the owner sees and chooses folders; Core enforces the same rule.
	const ownsTarget = Boolean(
		profiles.data?.some(
			(profile) => profile.openMeldProfileId === input.targetProfileId
		)
	);
	const folderOrganizationId = input.organizationId ?? organization?.id ?? "";
	const folders = useQuery(
		agentProfileFoldersQueryOptions({
			enabled: Boolean(ownsTarget && storageScope && folderOrganizationId),
			organizationId: folderOrganizationId,
			profileId: input.targetProfileId,
			storageScope: storageScope ?? "",
		})
	);
	return (
		<SpaceComposerAgentOptions
			{...input}
			folders={ownsTarget ? composerFolderOptions(folders.data) : []}
			foldersRecorded={folders.data?.status === "recorded"}
			projectName={project?.name}
		/>
	);
}
