import type { AuthProfileView } from "@openmeld/schemas/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createSpaceInOrganization,
	OrganizationSpaceScopeError,
} from "./create-space-in-organization";

const { createSpaceMock, createWebSpaceApiMock } = vi.hoisted(() => ({
	createSpaceMock: vi.fn(),
	createWebSpaceApiMock: vi.fn(),
}));

vi.mock("./api", () => ({
	createWebSpaceApi: (...args: unknown[]) => createWebSpaceApiMock(...args),
}));

const ACTING_PROFILE: AuthProfileView = {
	createdAt: "2026-08-18T00:00:00.000Z",
	createdByUserId: "user-mira",
	creatorProfileId: null,
	isDefault: true,
	lastUsedAt: "2026-08-18T01:00:00.000Z",
	managedRole: null,
	openMeldProfileId: "11111111-1111-4111-8111-111111111111",
	ownerName: "Mira",
	ownerUserId: "user-mira",
	profileHandle: "mira",
	profileKind: "human",
	profileName: "Mira",
	source: "manual",
	status: "active",
	updatedAt: "2026-08-18T01:00:00.000Z",
};

describe("createSpaceInOrganization", () => {
	beforeEach(() => {
		createSpaceMock.mockReset();
		createWebSpaceApiMock.mockReset().mockReturnValue({
			createSpace: createSpaceMock,
		});
	});

	it("binds creation to the route Organization and verifies the response scope", async () => {
		createSpaceMock.mockResolvedValue({
			meta: {
				organizationId: "org-amplift",
				spaceId: "space-new",
				visibility: "private",
			},
			spaceId: "space-new",
		});

		await expect(
			createSpaceInOrganization({
				actingProfile: ACTING_PROFILE,
				organizationId: "org-amplift",
				space: {
					accessMode: "public_view_join_password",
					name: "Launch room",
					password: "join-us",
					visibility: "private",
				},
			})
		).resolves.toMatchObject({ spaceId: "space-new" });

		expect(createWebSpaceApiMock).toHaveBeenCalledWith({
			organizationId: "org-amplift",
			openMeldProfileId: ACTING_PROFILE.openMeldProfileId,
		});
		expect(createSpaceMock).toHaveBeenCalledWith(
			expect.objectContaining({
				accessMode: "public_view_join_password",
				name: "Launch room",
				password: "join-us",
				requestContext: expect.objectContaining({
					actorContext: expect.objectContaining({
						openMeldProfileId: ACTING_PROFILE.openMeldProfileId,
					}),
				}),
				visibility: "private",
			})
		);
	});

	it("fails closed instead of opening a Space created in another Organization", async () => {
		createSpaceMock.mockResolvedValue({
			meta: {
				organizationId: "org-personal",
				spaceId: "space-wrong-org",
				visibility: "private",
			},
			spaceId: "space-wrong-org",
		});

		await expect(
			createSpaceInOrganization({
				actingProfile: ACTING_PROFILE,
				organizationId: "org-amplift",
				space: {
					accessMode: "members_only",
					name: "Launch room",
					visibility: "private",
				},
			})
		).rejects.toBeInstanceOf(OrganizationSpaceScopeError);
	});

	it("fails closed when the server does not return verifiable Space metadata", async () => {
		createSpaceMock.mockResolvedValue({ spaceId: "space-unverified" });

		await expect(
			createSpaceInOrganization({
				actingProfile: ACTING_PROFILE,
				organizationId: "org-amplift",
				space: {
					accessMode: "members_only",
					name: "Launch room",
					visibility: "private",
				},
			})
		).rejects.toBeInstanceOf(OrganizationSpaceScopeError);
	});
});
