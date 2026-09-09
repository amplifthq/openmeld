import type { SignalEnvelope } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	applySavedMessage,
	previewMessageMutation,
	projectMessageMutations,
} from "./message-mutation-presentation";
import {
	buildSpaceTimelineItems,
	mergeSpaceTimelineEnvelopes,
} from "./timeline";

const original: Extract<SignalEnvelope, { type: "signal.text" }> = {
	v: 1,
	id: "message-1",
	spaceId: "space-1",
	ts: 100,
	profile: { profileId: "human-1", profileName: "Casey", kind: "human" },
	type: "signal.text",
	data: { text: "Original" },
};
function createItem() {
	const item = buildSpaceTimelineItems({
		envelopes: [original],
		membersSnapshot: null,
	})[0];
	if (!item) {
		throw new Error("Expected a visible message fixture");
	}
	return item;
}
const item = createItem();

describe("optimistic message changes", () => {
	it("consumes recovery from a persisted linked repost, never a pending or identical unrelated message", () => {
		const recalled = {
			...original,
			data: {
				text: "Casey recalled a message.",
				meta: { recalledAt: 200, messageRevision: 1 },
			},
		};
		const repost = {
			...original,
			id: "repost",
			ts: 300,
			data: { text: "Original", meta: { restoredFromSignalId: original.id } },
		};
		const project = (signal: SignalEnvelope) =>
			buildSpaceTimelineItems({
				envelopes: [recalled, signal],
				membersSnapshot: null,
			})[0];
		expect(
			project({ ...repost, id: "pending:repost" })?.repostedAt
		).toBeUndefined();
		expect(
			project({ ...repost, data: { text: "Original" } })?.repostedAt
		).toBeUndefined();
		const consumed = project(repost);
		expect(consumed?.repostedAt).toBe(300);
		if (!consumed) {
			throw new Error("Missing fixture");
		}
		expect(
			projectMessageMutations(
				[consumed],
				new Map([
					[
						item.id,
						previewMessageMutation(
							item,
							{ action: "recall", expectedRevision: 0 },
							200
						),
					],
				])
			)[0]?.repostedAt
		).toBe(300);
	});
	it("updates text and edited state together, and rolls both back on failure", () => {
		const preview = previewMessageMutation(
			item,
			{ action: "edit", expectedRevision: 0, text: "Updated" },
			200
		);
		const visible = projectMessageMutations(
			[item],
			new Map([[item.id, preview]])
		)[0];
		expect(visible).toMatchObject({
			id: "message-1",
			text: "Updated",
			createdAtMs: 100,
			editedAt: 200,
		});
		expect(projectMessageMutations([item], new Map())[0]).toMatchObject({
			text: "Original",
			editedAt: undefined,
		});
	});
	it("shows recall immediately, then accepts only authoritative current or newer revisions", () => {
		const preview = previewMessageMutation(
			item,
			{ action: "recall", expectedRevision: 0 },
			200
		);
		expect(
			projectMessageMutations([item], new Map([[item.id, preview]]))[0]
		).toMatchObject({
			recalledAt: 200,
			text: "Casey recalled a message.",
			attachments: [],
			files: [],
		});
		const server = {
			...original,
			data: {
				text: "Changed elsewhere",
				meta: { messageRevision: 2, editedAt: 210 },
			},
		};
		const current = applySavedMessage(item, server);
		expect(
			projectMessageMutations([current], new Map([[item.id, preview]]))[0]?.text
		).toBe("Changed elsewhere");
		expect(
			mergeSpaceTimelineEnvelopes({
				current: [server],
				incoming: [original],
			})[0]?.data
		).toEqual(server.data);
	});
});
