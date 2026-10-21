import { queryOptions, skipToken } from "@tanstack/react-query";
import { z } from "zod/v4";
import { PERSISTED_DISPLAY_QUERY_GC_TIME_MS } from "#/query/query-config";

export const MAX_COMPOSER_TRAY_DISPLAY_HEIGHT = 480;

// Layout only. How tall the composer trays were when they last appeared in
// this conversation, so a hard refresh keeps that space while they load and
// the composer does not grow when they arrive.
export const spaceComposerTrayDisplaySchema = z.strictObject({
	version: z.literal(1),
	height: z.number().int().min(0).max(MAX_COMPOSER_TRAY_DISPLAY_HEIGHT),
});
export type SpaceComposerTrayDisplay = z.infer<
	typeof spaceComposerTrayDisplaySchema
>;

export function spaceComposerTrayDisplayQueryKey(
	spaceId: string,
	openMeldProfileId: string
) {
	return [
		"spaces",
		"composer-tray-display",
		spaceId,
		openMeldProfileId,
	] as const;
}

export function spaceComposerTrayDisplayQueryOptions(
	spaceId: string,
	openMeldProfileId: string
) {
	return queryOptions<SpaceComposerTrayDisplay>({
		queryKey: spaceComposerTrayDisplayQueryKey(spaceId, openMeldProfileId),
		queryFn: skipToken,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: PERSISTED_DISPLAY_QUERY_GC_TIME_MS,
	});
}
