import { z } from "zod/v4";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

// The cursor endpoint returns the full SpaceCursor record; the web read-position
// feature only needs lastSeenTs, so we parse loosely and ignore the rest.
const spaceCursorResponseSchema = z.looseObject({
	lastSeenTs: z.number().int().min(0).nullish(),
});

function buildSpaceCursorPath(
	spaceId: string,
	openMeldProfileId: string
): string {
	return `/v1/spaces/${encodeURIComponent(spaceId)}/cursors/${encodeURIComponent(
		openMeldProfileId
	)}`;
}

// Read the server-side read watermark shared with the CLI. A missing cursor is
// represented by null; transport and contract failures stay distinguishable so
// callers do not silently replace an unknown position with "never read".
export async function readSpaceCursorLastSeenTs(input: {
	spaceId: string;
	openMeldProfileId: string;
}): Promise<number | null> {
	const result = await createUnscopedWebOpenMeldApiFoundation({
		openMeldProfileId: input.openMeldProfileId,
	}).requestJson({
		url: buildSpaceCursorPath(input.spaceId, input.openMeldProfileId),
		method: "GET",
		operation: "space.cursor.read",
		schema: spaceCursorResponseSchema,
		invalidMessage: "Unexpected response: expected a space cursor",
	});
	return typeof result.lastSeenTs === "number" ? result.lastSeenTs : null;
}

// Advance the server-side read watermark. The server keeps it monotonic, while
// failures are surfaced so the caller can retry without disrupting the view.
export async function writeSpaceCursorLastSeenTs(input: {
	spaceId: string;
	openMeldProfileId: string;
	lastSeenTs: number;
}): Promise<void> {
	await createUnscopedWebOpenMeldApiFoundation({
		openMeldProfileId: input.openMeldProfileId,
	}).requestJson({
		url: buildSpaceCursorPath(input.spaceId, input.openMeldProfileId),
		method: "PATCH",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ lastSeenTs: input.lastSeenTs }),
		operation: "space.cursor.update",
		schema: spaceCursorResponseSchema,
		invalidMessage: "Unexpected response: expected a space cursor",
	});
}
