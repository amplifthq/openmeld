import type { SpaceApi } from "@openmeld/api-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { postNewTaskFromMessage } from "./new-task-from-message";

describe("starting a new task from a restricted Wake", () => {
	afterEach(() => sessionStorage.clear());
	it.each([
		null,
		"thr_11111111-1111-4111-8111-111111111111",
	])("preserves the reviewed request and retries one identity in %s", async (threadId) => {
		// An uncertain transport response must still retain the same authoring
		// identity on retry. The existing Space endpoint owns deduplication.
		const failure = new Error("response lost");
		const api = {
			postNormalMessage: vi
				.fn<SpaceApi["postNormalMessage"]>()
				.mockRejectedValue(failure),
			postThreadSignal: vi
				.fn<SpaceApi["postThreadSignal"]>()
				.mockRejectedValue(failure),
		};
		const input = {
			api,
			profileId: "human-1",
			spaceId: "space-1",
			targetProfileId: "agent-1",
			source: {
				sourceSignalId: "source-1",
				sourceRevision: 2,
				threadId,
				text: "Review the specified PR using permitted GitHub tools.",
				files: [
					{
						fileId: "file-1",
						revision: 3,
						name: "review-notes.md",
						mimeType: "text/markdown",
						sizeBytes: 42,
					},
				],
			},
		};
		await expect(postNewTaskFromMessage(input)).rejects.toThrow(failure);
		await expect(postNewTaskFromMessage(input)).rejects.toThrow(failure);
		const calls = threadId
			? api.postThreadSignal.mock.calls.map(([call]) => call.body)
			: api.postNormalMessage.mock.calls.map(([call]) => call);
		expect(calls).toHaveLength(2);
		expect(calls[1]).toEqual(calls[0]);
		expect(calls[0]).toMatchObject({
			text: input.source.text,
			files: input.source.files,
			contextSelection: { mode: "new" },
			messageEnvelope: {
				activationTargets: ["agent-1"],
				referenceTargets: [],
				mentionTargets: [],
				replyToSignalId: "source-1",
			},
		});
		expect(calls[0]?.contextSelection).not.toHaveProperty("access");
		if (threadId) {
			expect(api.postThreadSignal.mock.calls[0]?.[0].threadId).toBe(threadId);
			expect(api.postNormalMessage).not.toHaveBeenCalled();
		} else {
			expect(api.postThreadSignal).not.toHaveBeenCalled();
		}
		await expect(
			postNewTaskFromMessage({ ...input, profileId: "human-2" })
		).rejects.toThrow(failure);
		const last = threadId
			? api.postThreadSignal.mock.calls.at(-1)?.[0].body.clientMessageId
			: api.postNormalMessage.mock.calls.at(-1)?.[0].meta?.clientMessageId;
		const first = threadId
			? api.postThreadSignal.mock.calls[0]?.[0].body.clientMessageId
			: api.postNormalMessage.mock.calls[0]?.[0].meta?.clientMessageId;
		expect(last).not.toBe(first);
		const accepted: Awaited<ReturnType<SpaceApi["postNormalMessage"]>> = {
			v: 1,
			id: "accepted-message",
			spaceId: input.spaceId,
			ts: 1,
			profile: { kind: "human", profileId: input.profileId },
			type: "signal.text",
			data: { text: input.source.text },
		};
		api.postNormalMessage.mockResolvedValue(accepted);
		api.postThreadSignal.mockResolvedValue({
			signal: accepted,
			placement: {
				threadId: threadId ?? "thr_11111111-1111-4111-8111-111111111111",
				signalId: accepted.id,
				placement: "thread",
				createdAt: "2026-01-01T00:00:00.000Z",
			},
		});
		await postNewTaskFromMessage(input);
		const recoveredId = threadId
			? api.postThreadSignal.mock.calls.at(-1)?.[0].body.clientMessageId
			: api.postNormalMessage.mock.calls.at(-1)?.[0].meta?.clientMessageId;
		expect(recoveredId).toBe(first);
		// A later intentional New task must not replay the previous accepted one.
		await postNewTaskFromMessage(input);
		const nextId = threadId
			? api.postThreadSignal.mock.calls.at(-1)?.[0].body.clientMessageId
			: api.postNormalMessage.mock.calls.at(-1)?.[0].meta?.clientMessageId;
		expect(nextId).not.toBe(recoveredId);
	});
});
