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

// Best-effort read of the server-side read watermark (shared with the CLI). A
// failure is non-fatal: callers treat null as "no saved position" and fall back
// to a session-local watermark.
export async function readSpaceCursorLastSeenTs(input: {
	spaceId: string;
	openMeldProfileId: string;
}): Promise<number | null> {
	try {
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
	} catch {
		return null;
	}
}

// Best-effort advance of the server-side read watermark. The server keeps it
// monotonic (Math.max), so an out-of-order or stale write can never move the
// position backwards; a failure here must never disrupt the conversation UI.
export async function writeSpaceCursorLastSeenTs(input: {
	spaceId: string;
	openMeldProfileId: string;
	lastSeenTs: number;
}): Promise<void> {
	try {
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
	} catch {
		// Intentionally swallowed — read-position sync is best-effort.
	}
}
