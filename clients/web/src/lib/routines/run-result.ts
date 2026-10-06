import type { CenterAgentRoutineRun } from "@openmeld/schemas/types";
import { buildOrganizationSpacePath } from "#/lib/organizations/organization-routes";
import { buildSpaceMessageFocusHref } from "#/lib/spaces/thread-navigation";

export function routineRunResultHref(
	organizationSlug: string,
	run: Pick<
		CenterAgentRoutineRun,
		"destinationKind" | "targetSpaceId" | "publishedSignalId"
	>
): string | null {
	if (
		run.destinationKind !== "space" ||
		!run.targetSpaceId ||
		!run.publishedSignalId
	) {
		return null;
	}
	return buildSpaceMessageFocusHref(
		buildOrganizationSpacePath({
			orgSlug: organizationSlug,
			spaceId: run.targetSpaceId,
		}),
		run.publishedSignalId
	);
}
