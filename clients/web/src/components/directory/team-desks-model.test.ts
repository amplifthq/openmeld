import type { FileRootEntry } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	compactDeskProgress,
	deskState,
	latestTeamFileByAgent,
} from "./team-desks-model";

const now = Date.parse("2026-10-28T12:00:00Z");

function file(
	id: string,
	profileId: string,
	createdAt: string
): Extract<FileRootEntry, { kind: "file" }> {
	const actor = {
		profileId,
		profileKind: "agent" as const,
		displayName: profileId,
	};
	return {
		id,
		name: `${id}.diff`,
		kind: "file",
		path: `/${id}.diff`,
		parentId: null,
		root: { kind: "team", organizationId: "org" },
		createdAt,
		updatedAt: createdAt,
		createdBy: actor,
		updatedBy: actor,
		trashedAt: null,
		trashedBy: null,
		origin: null,
		latestRevision: {
			id: `rev-${id}`,
			fileId: id,
			revision: 1,
			mimeType: "text/plain",
			sizeBytes: 10,
			createdAt,
			createdBy: actor,
		},
	};
}

describe("Agent desks evidence", () => {
	it("expires active display evidence and does not turn missing or failed reads into idle", () => {
		const activity = {
			operationalContext: { status: "working" as const, waitingCount: 0 },
		};
		expect(
			deskState({
				activity,
				generatedAt: "2026-10-28T11:59:50Z",
				now,
				failed: false,
			})
		).toBe("working");
		expect(
			deskState({
				activity,
				generatedAt: "2026-10-28T11:58:00Z",
				now,
				failed: false,
			})
		).toBe("unknown");
		expect(
			deskState({
				activity,
				generatedAt: "2026-10-28T12:00:00Z",
				now,
				failed: true,
			})
		).toBe("unknown");
		expect(deskState({ now, failed: false })).toBe("unknown");
	});

	it("attributes the latest content revision, never a rename or the original author", () => {
		const earlier = file("earlier", "agent-a", "2026-10-28T10:00:00Z");
		const later = file("later", "agent-a", "2026-10-28T11:00:00Z");
		earlier.updatedAt = "2026-10-28T12:00:00Z";
		later.createdBy = { ...later.createdBy, profileId: "agent-b" };
		const result = latestTeamFileByAgent([later, earlier], "org");
		expect(result.get("agent-a")?.id).toBe("later");
		expect(result.has("agent-b")).toBe(false);
	});

	it("excludes private, foreign, trashed and human-authored revisions", () => {
		const privateFile = file("private", "agent-a", "2026-10-28T11:00:00Z");
		privateFile.root = {
			kind: "member",
			organizationId: "org",
			memberUserId: "owner",
		};
		const foreign = file("foreign", "agent-a", "2026-10-28T11:00:00Z");
		foreign.root = { kind: "team", organizationId: "another-org" };
		const trashed = file("trashed", "agent-a", "2026-10-28T11:00:00Z");
		trashed.trashedAt = "2026-10-28T12:00:00Z";
		const human = file("human", "agent-a", "2026-10-28T11:00:00Z");
		human.latestRevision.createdBy.profileKind = "human";
		expect(
			latestTeamFileByAgent([privateFile, foreign, trashed, human], "org").size
		).toBe(0);
	});

	it("keeps progress short without asking a model to summarize it", () => {
		expect(compactDeskProgress("Running\n  integration tests")).toBe(
			"Running integration tests"
		);
		expect(compactDeskProgress("x".repeat(500))).toHaveLength(138);
	});
});
