import type { AuthProfileView } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";

const { listStartProfilesMock, updateProfileSpaceHistoryStatusMock } =
	vi.hoisted(() => ({
		listStartProfilesMock: vi.fn(),
		updateProfileSpaceHistoryStatusMock: vi.fn(),
	}));

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: listStartProfilesMock,
}));

vi.mock("#/lib/onboarding/update-profile-space-history-status", () => ({
	updateProfileSpaceHistoryStatus: updateProfileSpaceHistoryStatusMock,
}));

import { removeDeletedSpaceFromAccountHistory } from "./delete-space-history-cleanup";

describe("removeDeletedSpaceFromAccountHistory", () => {
	it("marks every active same-owner profile history as removed", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "human-1",
				ownerUserId: "owner-1",
				profileKind: "human",
			}),
			createProfile({
				openMeldProfileId: "agent-1",
				ownerUserId: "owner-1",
				profileKind: "agent",
			}),
			createProfile({
				openMeldProfileId: "human-disabled",
				ownerUserId: "owner-1",
				profileKind: "human",
				status: "disabled",
			}),
			createProfile({
				openMeldProfileId: "human-other-owner",
				ownerUserId: "owner-2",
				profileKind: "human",
			}),
		]);
		updateProfileSpaceHistoryStatusMock.mockResolvedValue({
			status: "removed",
		});

		const result = await removeDeletedSpaceFromAccountHistory({
			currentProfileId: "human-1",
			reason: "deleted_space",
			spaceId: "space-123",
		});

		expect(result.updatedProfileIds).toEqual(["human-1", "agent-1"]);
		expect(updateProfileSpaceHistoryStatusMock).toHaveBeenCalledTimes(2);
		expect(updateProfileSpaceHistoryStatusMock).toHaveBeenNthCalledWith(1, {
			data: {
				profileId: "human-1",
				reason: "deleted_space",
				spaceId: "space-123",
				status: "removed",
			},
		});
		expect(updateProfileSpaceHistoryStatusMock).toHaveBeenNthCalledWith(2, {
			data: {
				profileId: "agent-1",
				reason: "deleted_space",
				spaceId: "space-123",
				status: "removed",
			},
		});
	});
});

function createProfile(
	overrides: Pick<
		AuthProfileView,
		"openMeldProfileId" | "ownerUserId" | "profileKind"
	> &
		Partial<AuthProfileView>
): AuthProfileView {
	const now = "2026-05-14T00:00:00.000Z";
	return {
		openMeldProfileId: overrides.openMeldProfileId,
		createdAt: now,
		createdByUserId: null,
		creatorProfileId: null,
		isDefault: false,
		lastUsedAt: null,
		managedRole: overrides.managedRole ?? null,
		ownerUserId: overrides.ownerUserId,
		profileHandle: overrides.openMeldProfileId,
		profileKind: overrides.profileKind,
		profileName: overrides.openMeldProfileId,
		source: "test",
		status: overrides.status ?? "active",
		updatedAt: now,
		...(overrides.ownerName === undefined
			? {}
			: { ownerName: overrides.ownerName }),
	};
}
