import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalComponentUpdateStatus,
} from "@openmeld/schemas/types";

type OpenMeldToolsProjection =
	CurrentLocalRuntimeReplyReadinessResponse["localComponents"];

type OpenMeldToolsComponentUpdate = {
	status: LocalComponentUpdateStatus;
	wakeBlocked: boolean;
};

export function hasCurrentLocalRuntimeOpenMeldToolsUpdate(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null | undefined
): boolean {
	return hasOpenMeldToolsUpdate(readiness?.localComponents);
}

export function hasOpenMeldToolsUpdate(
	localComponents: OpenMeldToolsProjection | null | undefined
): boolean {
	if (!localComponents) {
		return false;
	}
	return (
		isOpenMeldToolsComponentUpdateActionable(localComponents.service) ||
		isOpenMeldToolsComponentUpdateActionable(
			(localComponents as Partial<OpenMeldToolsProjection>).cli
		) ||
		isOpenMeldToolsComponentUpdateActionable(
			(localComponents as Partial<OpenMeldToolsProjection>).skills
		)
	);
}

export function isOpenMeldToolsComponentUpdateRequired(
	update: OpenMeldToolsComponentUpdate | null | undefined
): boolean {
	return update?.status === "update_required" || update?.wakeBlocked === true;
}

export function isOpenMeldToolsComponentUpdateActionable(
	update: OpenMeldToolsComponentUpdate | null | undefined
): boolean {
	return (
		update?.status === "update_available" ||
		update?.status === "update_required"
	);
}
