import type { SpaceApi } from "@openmeld/api-client";
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
	// One recovery per reviewed source, requester, target and destination. The
	// existing Space authoring receipt owns deduplication, including after a
	// successful response, reload or browser-storage failure.
	const clientMessageId = `new-task:v1:${Array.from(
		new Uint8Array(digest),
		(byte) => byte.toString(16).padStart(2, "0")
	).join("")}`;
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
	return source.threadId
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
}
