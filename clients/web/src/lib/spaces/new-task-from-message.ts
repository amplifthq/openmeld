import type { SpaceApi } from "@openmeld/api-client";
import { clientMessageIdSchema } from "@openmeld/schemas";
import type { GetSpaceMessageDetailsResponse } from "@openmeld/schemas/types";

export type SpaceNewTaskSource = NonNullable<
	GetSpaceMessageDetailsResponse["newTaskSource"]
>;

/** Retry the same reviewed recovery through normal, idempotent Space authoring. */
export async function postNewTaskFromMessage(input: {
	api: Pick<SpaceApi, "postNormalMessage" | "postThreadSignal">;
	profileId: string;
	spaceId: string;
	spacePassword?: string;
	targetProfileId: string;
	source: SpaceNewTaskSource;
}) {
	const { source } = input;
	const identity = JSON.stringify([
		input.spaceId,
		input.profileId,
		source.sourceSignalId,
		source.sourceRevision,
		source.threadId,
		input.targetProfileId,
		source.text,
		source.files ?? [],
	]);
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(identity)
	);
	const storageKey = `openmeld:new-task:v1:${Array.from(
		new Uint8Array(digest),
		(byte) => byte.toString(16).padStart(2, "0")
	).join("")}`;
	// Keep only the outgoing request id, never message contents. An uncertain
	// response can be retried after reload; an accepted action releases the key
	// so a later, separately confirmed task gets a fresh id.
	const saved = sessionStorage.getItem(storageKey);
	const parsed = clientMessageIdSchema.safeParse(saved);
	if (saved !== null && !parsed.success) {
		throw new Error(
			"The saved request could not be recovered. Start a new task from the composer."
		);
	}
	const clientMessageId = parsed.success
		? parsed.data
		: `new-task:${crypto.randomUUID()}`;
	if (saved === null) {
		sessionStorage.setItem(storageKey, clientMessageId);
	}
	const common = {
		spaceId: input.spaceId,
		...(input.spacePassword === undefined
			? {}
			: { spacePassword: input.spacePassword }),
	};
	const body = {
		text: source.text,
		...(source.files ? { files: source.files } : {}),
		messageEnvelope: {
			text: source.text,
			activationTargets: [input.targetProfileId],
			referenceTargets: [],
			mentionTargets: [],
			replyToSignalId: source.sourceSignalId,
		},
		contextSelection: { mode: "new" as const },
	};
	const result = source.threadId
		? await input.api.postThreadSignal({
				...common,
				threadId: source.threadId,
				body: { ...body, clientMessageId },
			})
		: await input.api.postNormalMessage({
				...common,
				...body,
				meta: { clientMessageId },
			});
	try {
		if (sessionStorage.getItem(storageKey) === clientMessageId) {
			sessionStorage.removeItem(storageKey);
		}
	} catch {
		console.warn(
			"New task accepted; its local retry record could not be cleared."
		);
	}
	return result;
}
