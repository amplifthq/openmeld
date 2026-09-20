import { afterEach, expect, it } from "vitest";
import {
	hasUnseenPinnedFileUpdate,
	markFileRevisionSeen,
	readSeenFileRevision,
} from "./file-update-seen";

afterEach(() => window.localStorage.clear());

it("shows only revisions published after pinning that this reader has not seen", () => {
	const input = {
		pinnedAt: "2026-09-10T00:00:00Z",
		revisionCreatedAt: "2026-09-10T01:00:00Z",
		latestRevision: 3,
		seenRevision: 2,
	};
	expect(hasUnseenPinnedFileUpdate(input)).toBe(true);
	expect(hasUnseenPinnedFileUpdate({ ...input, seenRevision: 3 })).toBe(false);
	expect(
		hasUnseenPinnedFileUpdate({ ...input, revisionCreatedAt: input.pinnedAt })
	).toBe(false);
	expect(
		hasUnseenPinnedFileUpdate({
			...input,
			revisionCreatedAt: "2026-09-09T00:00:00Z",
		})
	).toBe(false);
});

it("keeps each reader's progress and never rolls it back when opening an older version", () => {
	const scope = {
		organizationSlug: "test-org",
		profileId: "alice",
		spaceId: "space-a",
		fileId: "file-a",
	};
	markFileRevisionSeen(scope, 3);
	markFileRevisionSeen(scope, 1);
	expect(readSeenFileRevision(scope)).toBe(3);
	expect(readSeenFileRevision({ ...scope, profileId: "bob" })).toBe(0);
	expect(readSeenFileRevision({ ...scope, spaceId: "space-b" })).toBe(0);
	expect(
		readSeenFileRevision({ ...scope, organizationSlug: "other-org" })
	).toBe(0);
	expect(readSeenFileRevision({ ...scope, fileId: "file-b" })).toBe(0);
});
