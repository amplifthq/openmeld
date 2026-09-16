import type { SpaceTaskPhase } from "@openmeld/schemas/types";

export const spaceTaskQueryKeys = {
	all: ["space-tasks"] as const,
	space: (spaceId: string) => [...spaceTaskQueryKeys.all, spaceId] as const,
	list: (spaceId: string, phase?: SpaceTaskPhase) =>
		[...spaceTaskQueryKeys.space(spaceId), "list", phase ?? "all"] as const,
	detail: (spaceId: string, taskId: string) =>
		[...spaceTaskQueryKeys.space(spaceId), "detail", taskId] as const,
};
