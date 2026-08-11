import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildProfileRequestContext,
	findActiveDefaultHumanProfile,
	findActiveProfileById,
	listActiveProfilesByKind,
} from "./human-profiles";

const HUMAN_PROFILE = {
	openMeldProfileId: "11111111-1111-4111-8111-111111111111",
	profileName: "Felix",
	profileHandle: "felix",
	profileKind: "human",
	isDefault: true,
	status: "active",
	ownerUserId: "user-123",
	ownerName: "Felix",
	source: "manual",
	createdByUserId: "user-123",
	creatorProfileId: null,
	lastUsedAt: "2026-04-18T01:00:00.000Z",
	managedRole: null,
	createdAt: "2026-04-18T00:00:00.000Z",
	updatedAt: "2026-04-18T01:00:00.000Z",
} as const;

describe("human profile helpers", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("filters active human profiles and keeps the default one first", () => {
		const profiles = listActiveProfilesByKind(
			[
				{
					...HUMAN_PROFILE,
					openMeldProfileId: "22222222-2222-4222-8222-222222222222",
					isDefault: false,
					lastUsedAt: "2026-04-18T00:30:00.000Z",
					profileName: "Work",
				},
				{
					...HUMAN_PROFILE,
					openMeldProfileId: "33333333-3333-4333-8333-333333333333",
					profileKind: "agent",
				},
				{
					...HUMAN_PROFILE,
					openMeldProfileId: "44444444-4444-4444-8444-444444444444",
					status: "disabled",
				},
				HUMAN_PROFILE,
			],
			"human"
		);

		expect(profiles.map((profile) => profile.openMeldProfileId)).toEqual([
			"11111111-1111-4111-8111-111111111111",
			"22222222-2222-4222-8222-222222222222",
		]);
		expect(findActiveDefaultHumanProfile(profiles)).toMatchObject({
			openMeldProfileId: HUMAN_PROFILE.openMeldProfileId,
		});
	});

	it("does not substitute a non-default profile when the active default is missing", () => {
		expect(
			findActiveDefaultHumanProfile([
				{
					...HUMAN_PROFILE,
					isDefault: false,
					openMeldProfileId: "22222222-2222-4222-8222-222222222222",
				},
				{
					...HUMAN_PROFILE,
					status: "disabled",
				},
			])
		).toBeNull();
	});

	it("finds only active profiles that match the requested kind", () => {
		expect(
			findActiveProfileById(
				[
					HUMAN_PROFILE,
					{
						...HUMAN_PROFILE,
						openMeldProfileId: "agt_55555555-5555-4555-8555-555555555555",
						profileKind: "agent",
					},
				],
				{
					profileId: HUMAN_PROFILE.openMeldProfileId,
					profileKind: "human",
				}
			)
		).toMatchObject({
			openMeldProfileId: HUMAN_PROFILE.openMeldProfileId,
		});
	});

	it("builds a request context from the selected profile", () => {
		vi.spyOn(crypto, "randomUUID").mockReturnValue(
			"11111111-1111-4111-8111-111111111111"
		);

		expect(buildProfileRequestContext(HUMAN_PROFILE)).toEqual({
			actorContext: {
				requestId: "11111111-1111-4111-8111-111111111111",
				openMeldProfileId: HUMAN_PROFILE.openMeldProfileId,
				profileKind: "human",
				profileHandle: HUMAN_PROFILE.profileHandle,
				profileName: HUMAN_PROFILE.profileName,
				ownerUserId: HUMAN_PROFILE.ownerUserId,
				ownerName: HUMAN_PROFILE.ownerName,
			},
		});
	});
});
