import { useQuery } from "@tanstack/react-query";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { useOptionalAppOrganization } from "#/lib/organizations/organization-context";
import { projectsQueryOptions } from "#/query/organizations/projects";
import { startProfilesQueryOptions } from "#/query/profiles/profiles";
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
	const projectId = profiles.data?.find(
		(profile) => profile.openMeldProfileId === input.targetProfileId
	)?.defaultProjectId;
	const projects = useQuery(
		projectsQueryOptions({
			enabled: Boolean(projectId && organization),
			organizationId: organization?.id ?? "",
		})
	);
	const project = projects.data?.projects.find((item) => item.id === projectId);
	return <SpaceComposerAgentOptions {...input} projectName={project?.name} />;
}
