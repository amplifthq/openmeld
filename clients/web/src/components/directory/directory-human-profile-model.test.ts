import {
	messageChannelConnectionListResponseSchema,
	organizationDirectoryResponseSchema,
} from "@openmeld/schemas";
import type {
	AuthProfileView,
	MessageChannelConnectionProjection,
	OrganizationDirectoryResponse,
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
		expect(activeProfile?.lastActiveAt).toBeNull();
	});

	it("uses the Organization activity projection instead of Auth profile use", () => {
		const [member] = buildOrganizationRows({
			messageChannels: buildMessageChannels({
				connections: [],
				identityLinks: [],
			}),
			messageChannelsStatus: "ready",
		});

		expect(member?.lastActiveAt).toBe("2026-08-20T11:00:00.000Z");
	});

	it.each([
		"loading",
		"failed",
	] as const)("keeps Profile Report evidence unavailable while Documents are %s", (documentsStatus) => {
		const rows = buildOrganizationRows({
			documentsStatus,
			messageChannels: buildMessageChannels({
				connections: [],
				identityLinks: [],
			}),
			messageChannelsStatus: "ready",
		});

		expect(rows.every((row) => row.profileReport.state === "unavailable")).toBe(
			true
		);
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

		expect(member?.identityAccounts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					accountEmail: null,
					accountName: "ari@example.com",
					provider: "slack",
					state: "connected",
				}),
			])
		);
	});

	it("uses the canonical provider account email for a connected identity", () => {
		const [member] = buildOrganizationRows({
			messageChannels: buildMessageChannels({
				connections: [buildConnection({ provider: "slack" })],
				identityLinks: [
					buildIdentityLink({
						openMeldUserId: "user-a",
						provider: "slack",
						providerAccountEmail: "ari@amplift.ai",
						providerAccountName: "Ari",
					}),
				],
			}),
			messageChannelsStatus: "ready",
		});

		expect(member?.identityAccounts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					accountEmail: "ari@amplift.ai",
					accountName: "Ari",
					provider: "slack",
					state: "connected",
				}),
			])
		);
	});

	it("lets the current member refresh a legacy Slack link without disconnecting it", () => {
		const [member] = buildOrganizationRows({
			messageChannels: buildMessageChannels({
				connections: [buildConnection({ provider: "slack" })],
				identityLinks: [
					buildIdentityLink({
						openMeldUserId: "user-a",
						provider: "slack",
						providerAccountName: "Ari",
					}),
				],
			}),
			messageChannelsStatus: "ready",
		});

		expect(member?.identityAccounts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					action: {
						kind: "authorize",
						label: "Reconnect Slack",
						path: "/slack/identity/start?organization_slug=acme",
					},
					canDisconnect: true,
					provider: "slack",
					state: "connected",
				}),
			])
		);
	});

	it("does not let an admin reauthorize another member's Slack identity", () => {
		const member = buildOrganizationRows({
			messageChannels: buildMessageChannels({
				connections: [buildConnection({ provider: "slack" })],
				identityLinks: [
					buildIdentityLink({
						openMeldUserId: "user-b",
						provider: "slack",
						providerAccountName: "Grace",
					}),
				],
			}),
			messageChannelsStatus: "ready",
		}).find((row) => row.userId === "user-b");

		expect(member?.identityAccounts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					action: null,
					provider: "slack",
					state: "connected",
				}),
			])
		);
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

		expect(linkedMember?.identityAccounts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					canDisconnect: true,
					channelsPath: null,
					id: expect.any(String),
					provider: "slack",
					state: "unavailable",
				}),
			])
		);
		expect(otherMember?.identityAccounts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					channelsPath: null,
					id: null,
					provider: "slack",
					state: "unavailable",
				}),
			])
		);
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

		expect(member?.identityAccounts).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					channelsPath: "/o/acme/center-agent/channels",
					provider: "lark",
					state: "unavailable",
				}),
			])
		);
	});

	it("groups ordinary Agent Profiles by owner and excludes the Center Agent", () => {
		const rows = buildOrganizationRows({
			agentProfiles: [
				buildAgentProfile({
					agentControllerRef: "builtin:codex",
					ownerUserId: "user-a",
					profileId: "agent-codex",
					profileName: "Ari Codex",
				}),
				buildAgentProfile({
					agentControllerRef: "builtin:claude-code",
					ownerUserId: "user-a",
					profileId: "agent-claude",
					profileName: "Ari Claude",
				}),
				buildAgentProfile({
					agentControllerRef: "builtin:codex",
					isCenterAgent: true,
					ownerUserId: "user-a",
					profileId: "agent-center",
					profileName: "Center Agent",
				}),
				buildAgentProfile({
					agentControllerRef: "builtin:grok-build",
					ownerUserId: "user-b",
					profileId: "agent-grok",
					profileName: "Builder",
				}),
			],
			messageChannels: buildMessageChannels({
				connections: [],
				identityLinks: [],
			}),
			messageChannelsStatus: "ready",
		});

		expect(rows.find((row) => row.userId === "user-a")?.agentProfiles).toEqual([
			{
				agentId: "claude-code",
				avatarImageUrl: null,
				id: "agent-claude",
				name: "Ari Claude",
			},
			{
				agentId: "codex",
				avatarImageUrl: null,
				id: "agent-codex",
				name: "Ari Codex",
			},
		]);
		expect(rows.find((row) => row.userId === "user-a")?.agentProfilesPath).toBe(
			"/o/acme/agents?profileId=agent-claude"
		);
		expect(rows.find((row) => row.userId === "user-b")?.agentProfiles).toEqual([
			{
				agentId: "grok-build",
				avatarImageUrl: null,
				id: "agent-grok",
				name: "Builder",
			},
		]);
	});

	it("includes ordinary Agent Profiles in a personal Human Profile", () => {
		const [member] = buildPersonalRows({
			profiles: [
				buildHumanProfile(),
				buildPersonalAgentProfile({
					avatarUrl: "https://example.com/ari-agent.png",
					managedRole: null,
					openMeldProfileId: "agent-ari",
					profileName: "Ari Agent",
				}),
				buildPersonalAgentProfile({
					managedRole: "center_agent",
					openMeldProfileId: "agent-center",
					profileName: "Center Agent",
				}),
			],
		});

		expect(member?.agentProfiles).toEqual([
			{
				agentId: null,
				avatarImageUrl: "https://example.com/ari-agent.png",
				id: "agent-ari",
				name: "Ari Agent",
			},
		]);
		expect(member?.agentProfilesPath).toBe("/o/ari/agents?profileId=agent-ari");
	});
});

function buildOrganizationRows(input: {
	agentProfiles?: OrganizationDirectoryResponse["agentProfiles"];
	documentsStatus?: "failed" | "loading" | "ready";
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
		agentProfiles: input.agentProfiles ?? [],
		canManageConnectedAccounts: true,
		canManageMessageChannels: true,
		computers: null,
		computersStatus: "ready",
		currentUserId: "user-a",
		documents: [],
		documentsStatus: input.documentsStatus ?? "ready",
		members: directory.members,
		messageChannels: input.messageChannels,
		messageChannelsStatus: input.messageChannelsStatus,
		orgSlug: "acme",
	});
}

function buildAgentProfile(input: {
	agentControllerRef: string;
	isCenterAgent?: boolean;
	ownerUserId: string;
	profileId: string;
	profileName: string;
}): OrganizationDirectoryResponse["agentProfiles"][number] {
	return {
		avatarUrl: undefined,
		isCenterAgent: input.isCenterAgent,
		ownerUserId: input.ownerUserId,
		profileId: input.profileId,
		profileName: input.profileName,
		readiness: { agentControllerRef: input.agentControllerRef },
		status: "active",
	} as OrganizationDirectoryResponse["agentProfiles"][number];
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

function buildPersonalAgentProfile(input: {
	avatarUrl?: string;
	managedRole: AuthProfileView["managedRole"];
	openMeldProfileId: string;
	profileName: string;
}): AuthProfileView {
	return {
		...buildHumanProfile(),
		...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
		isDefault: false,
		managedRole: input.managedRole,
		openMeldProfileId: input.openMeldProfileId,
		profileHandle: input.openMeldProfileId,
		profileKind: "agent",
		profileName: input.profileName,
	};
}

function buildDirectoryMember(input: {
	memberId: string;
	role: string;
	userId: string;
}) {
	return {
		humanProfile: {
			lastUsedAt: "2026-08-20T12:00:00.000Z",
			profileHandle: input.userId,
			profileId:
				input.userId === "user-a"
					? "11111111-1111-4111-8111-111111111111"
					: "22222222-2222-4222-8222-222222222222",
			profileName: input.userId,
			status: "active",
		},
		joinedAt: "2026-08-20T00:00:00.000Z",
		lastActiveAt: input.userId === "user-a" ? "2026-08-20T11:00:00.000Z" : null,
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
		providerAccountEmail?: string | null;
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
	providerAccountEmail?: string | null;
	providerAccountName: string | null;
}) {
	return {
		connectedAt: "2026-08-20T00:00:00.000Z",
		id: `channel_identity_${"a".repeat(64)}`,
		...input,
	};
}
