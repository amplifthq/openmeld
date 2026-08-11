import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	createSpaceConversationDisplaySnapshot,
	readOnlySpaceStatusFromDisplaySnapshot,
} from "./display-snapshot";

describe("Space conversation display snapshot", () => {
	it("stores display data without retaining current authority", () => {
		const status = createSpaceStatus();

		const snapshot = createSpaceConversationDisplaySnapshot(status);

		expect(snapshot.status).not.toHaveProperty("allowedActions");
		expect(snapshot.status).not.toHaveProperty("latestVisibleUpdate");
		expect(readOnlySpaceStatusFromDisplaySnapshot(snapshot)).toMatchObject({
			allowedActions: ["stay_silent"],
			name: "Design Room",
			spaceId: "space-123",
		});
	});
});

function createSpaceStatus(): GetSpaceStatusResponse {
	return {
		accessMode: "members_only",
		allowedActions: ["post_message", "post_status", "stay_silent"],
		dispatchBrief: "default",
		dispatchPolicy: { mode: "mention_only" },
		entryBrief: "default",
		generatedAt: "2026-08-11T00:00:00.000Z",
		latestVisibleUpdate: {
			actorName: "Felix",
			actorProfileId: "profile-a",
			createdAt: "2026-08-11T00:00:00.000Z",
			previewText: "Confidential preview that must not persist",
			signalId: "signal-latest",
			signalType: "signal.text",
		},
		members: {
			agentCount: 1,
			humanCount: 1,
			liveAgentCount: 0,
			liveHumanCount: 1,
			liveNowCount: 1,
			totalCount: 2,
		},
		name: "Design Room",
		passwordProtected: false,
		publicationMode: "collaboration",
		resultArchivePolicy: { mode: "all_final_results" },
		spaceId: "space-123",
	};
}
