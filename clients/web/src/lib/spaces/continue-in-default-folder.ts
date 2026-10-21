import type { SpaceApi } from "@openmeld/api-client";
import { MAX_TEXT_LENGTH } from "@openmeld/schemas/schemas";

/** The request whose Session could not continue in its earlier folder. */
export type FolderContinueSource = {
	sourceSignalId: string;
	text: string;
	threadId: string | null;
};

const SHORTENED_NOTE =
	"\n\n[Shortened. The full request is the message this replies to.]";

/**
 * The handoff for the new Session. It names no folder: the Service starts
 * the Session in the Agent's default folder, which may have changed since
 * the owner's view loaded. A long request is shortened so the message stays
 * within the Space text limit; the reply keeps the full request reachable.
 */
export function buildFolderContinueText(input: { text: string }): string {
	const header = [
		"Continue this request in a new session in your current working folder. Your earlier session in this chat worked in a folder that is no longer your working folder. Use this chat's earlier messages as context.",
		"",
		"Original request:",
		"",
	].join("\n");
	const available = MAX_TEXT_LENGTH - header.length;
	if (!input.text.trim()) {
		return `${header}The original request is the message this replies to.`;
	}
	return input.text.length <= available
		? header + input.text
		: header +
				input.text.slice(0, available - SHORTENED_NOTE.length) +
				SHORTENED_NOTE;
}

/**
 * Sends the owner's one-click continuation: the same chat, a new Session
 * (no folder id, so the Agent's current default folder applies), replying to
 * the request that failed. One click per request and target: a repeat
 * returns the same message through the Space authoring receipt.
 */
export async function postContinueInDefaultFolder(input: {
	api: Pick<SpaceApi, "postNormalMessage" | "postThreadSignal">;
	profileId: string;
	source: FolderContinueSource;
	spaceId: string;
	spacePassword?: string;
	targetProfileId: string;
}) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(
			JSON.stringify([
				input.spaceId,
				input.profileId,
				input.source.sourceSignalId,
				input.source.threadId,
				input.targetProfileId,
			])
		)
	);
	const clientMessageId = `folder-continue:v1:${Array.from(
		new Uint8Array(digest),
		(byte) => byte.toString(16).padStart(2, "0")
	).join("")}`;
	const text = buildFolderContinueText({ text: input.source.text });
	const body = {
		text,
		messageEnvelope: {
			text,
			activationTargets: [input.targetProfileId],
			referenceTargets: [],
			mentionTargets: [],
			replyToSignalId: input.source.sourceSignalId,
		},
		contextSelection: { mode: "new" as const },
	};
	const common = {
		spaceId: input.spaceId,
		...(input.spacePassword === undefined
			? {}
			: { spacePassword: input.spacePassword }),
	};
	return input.source.threadId
		? await input.api.postThreadSignal({
				...common,
				threadId: input.source.threadId,
				body: { ...body, clientMessageId },
			})
		: await input.api.postNormalMessage({
				...common,
				...body,
				meta: { clientMessageId },
			});
}
