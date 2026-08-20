import {
	messageChannelConnectionListResponseSchema,
	organizationDirectoryResponseSchema,
} from "@openmeld/schemas";
import type {
	AuthProfileView,
	MessageChannelConnectionProjection,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	buildOrganizationHumanProfileRows,
	buildPersonalHumanProfileRows,
} from "#/components/directory/directory-human-profile-model";

describe("directory Human Profile model", () => {
	it("does not invent Organization roles or email values in a personal workspace", () => {
		const missingProfile = buildPersonalRows({ profiles: [] })[0];
		const activeProfile = buildPersonalRows({
			profiles: [buildHumanProfile()],
		})[0];

		expect(missingProfile).toMatchObject({ email: null, role: null });
		expect(activeProfile).toMatchObject({ email: null, role: null });
	});

	it("does not promote a provider display name to an account email", () => {
		const [member] = buildOrganizationRows({
			messageChannels: buildMessageChannels({
				connections: [buildConnection({ provider: "slack" })],
				identityLinks: [
					buildIdentityLink({
						openMeldUserId: "user-a",
						provider: "slack",
						providerAccountName: "ari@example.com",
					}),
				],
			}),
			messageChannelsStatus: "ready",
		});

		expect(member?.identityAccounts).toEqual([
			expect.objectContaining({
				accountEmail: null,
				provider: "slack",
				state: "connected",
			}),
		]);
	});

	it("preserves a cached linked provider across every card after refresh failure", () => {
		const rows = buildOrganizationRows({
			messageChannels: buildMessageChannels({
				connections: [buildConnection({ provider: "slack" })],
				identityLinks: [
					buildIdentityLink({
						openMeldUserId: "user-a",
						provider: "slack",
						providerAccountName: "@ari",
					}),
				],
			}),
			messageChannelsStatus: "failed",
		});
		const linkedMember = rows.find((row) => row.userId === "user-a");
		const otherMember = rows.find((row) => row.userId === "user-b");

		expect(linkedMember?.identityAccounts).toEqual([
			expect.objectContaining({
				canDisconnect: true,
				channelsPath: null,
				id: expect.any(String),
				provider: "slack",
				state: "unavailable",
			}),
		]);
		expect(otherMember?.identityAccounts).toEqual([
			expect.objectContaining({
				channelsPath: null,
				id: null,
				provider: "slack",
				state: "unavailable",
			}),
		]);
	});

	it("surfaces a repair-required provider as unavailable instead of not connected", () => {
		const [member] = buildOrganizationRows({
			messageChannels: buildMessageChannels({
				connections: [
					buildConnection({ provider: "lark", status: "repair_required" }),
				],
				identityLinks: [],
			}),
			messageChannelsStatus: "ready",
		});

		expect(member?.identityAccounts).toEqual([
			expect.objectContaining({
				channelsPath: null,
				provider: "lark",
				state: "unavailable",
			}),
		]);
	});
});

function buildOrganizationRows(input: {
	messageChannels: ReturnType<typeof buildMessageChannels>;
	messageChannelsStatus: "failed" | "loading" | "ready";
}) {
	const directory = organizationDirectoryResponseSchema.parse({
		agentProfiles: [],
		generatedAt: "2026-08-20T00:00:00.000Z",
		members: [
			buildDirectoryMember({
				memberId: "member-a",
				role: "owner",
				userId: "user-a",
			}),
			buildDirectoryMember({
				memberId: "member-b",
				role: "member",
				userId: "user-b",
			}),
		],
		organizationId: "org-a",
	});
	return buildOrganizationHumanProfileRows({
		canManageConnectedAccounts: true,
		computers: null,
		computersStatus: "ready",
		currentUserId: "user-a",
		documents: [],
		documentsStatus: "ready",
		members: directory.members,
		messageChannels: input.messageChannels,
		messageChannelsStatus: input.messageChannelsStatus,
		orgSlug: "acme",
	});
}

function buildPersonalRows(input: { profiles: readonly AuthProfileView[] }) {
	return buildPersonalHumanProfileRows({
		account: { email: null, name: null },
		canCreateHumanProfile: true,
		computers: null,
		computersStatus: "ready",
		documents: [],
		documentsStatus: "ready",
		orgSlug: "ari",
		profiles: input.profiles,
		subjectUserId: "user-a",
	});
}

function buildHumanProfile(): AuthProfileView {
	return {
		createdAt: "2026-08-20T00:00:00.000Z",
		createdByUserId: "user-a",
		creatorProfileId: null,
		isDefault: true,
		lastUsedAt: null,
		managedRole: null,
		openMeldProfileId: "human-a",
		ownerName: "Ari",
		ownerUserId: "user-a",
		profileHandle: "ari",
		profileKind: "human",
		profileName: "Ari",
		source: "auth_bootstrap",
		status: "active",
		updatedAt: "2026-08-20T00:00:00.000Z",
	};
}

function buildDirectoryMember(input: {
	memberId: string;
	role: string;
	userId: string;
}) {
	return {
		humanProfile: null,
		joinedAt: "2026-08-20T00:00:00.000Z",
		memberId: input.memberId,
		organizationId: "org-a",
		role: input.role,
		user: {
			email: `${input.userId}@example.com`,
			id: input.userId,
			image: null,
			name: input.userId,
		},
		userId: input.userId,
	};
}

function buildMessageChannels(input: {
	connections: MessageChannelConnectionProjection[];
	identityLinks: Array<{
		connectedAt: string;
		id: string;
		openMeldUserId: string;
		provider: MessageChannelConnectionProjection["provider"];
		providerAccountName: string | null;
	}>;
}) {
	return messageChannelConnectionListResponseSchema.parse({
		availableLarkPlatformProviders: ["lark"],
		connections: input.connections,
		identityLinks: input.identityLinks,
		organizationId: "org-a",
	});
}

function buildConnection(input: {
	provider: MessageChannelConnectionProjection["provider"];
	status?: MessageChannelConnectionProjection["status"];
}): MessageChannelConnectionProjection {
	return {
		externalAccountId: `${input.provider}-account`,
		externalAccountName: null,
		grantedCapabilityGroups: [],
		id: `${input.provider}-connection`,
		lastVerifiedAt: "2026-08-20T00:00:00.000Z",
		permissionBundleVersion: null,
		provider: input.provider,
		reasonCode:
			input.status === "repair_required" ? "credentials.invalid" : null,
		status: input.status ?? "connected",
		transport: "webhook",
	};
}

function buildIdentityLink(input: {
	openMeldUserId: string;
	provider: MessageChannelConnectionProjection["provider"];
	providerAccountName: string | null;
}) {
	return {
		connectedAt: "2026-08-20T00:00:00.000Z",
		id: `channel_identity_${"a".repeat(64)}`,
		...input,
	};
}
