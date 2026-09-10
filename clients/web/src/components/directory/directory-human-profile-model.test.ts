import {
	messageChannelConnectionListResponseSchema,
	organizationDirectoryResponseSchema,
} from "@openmeld/schemas";
import type {
	AuthProfileView,
	MessageChannelConnectionProjection,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveOrganizationComputerGroups } from "#/components/computers/organization-computers";
import {
	buildOrganizationHumanProfileRows,
	buildPersonalHumanProfileRows,
} from "#/components/directory/directory-human-profile-model";

describe("directory Human Profile model", () => {
	it("keeps Remote controller and model information on the personal user page", () => {
		const modelSelection = {
			modelId: "deepseek/deepseek-v4-flash",
		};
		const rows = buildPersonalHumanProfileRows({
			account: { email: null, name: null },
			canCreateHumanProfile: true,
			computers: null,
			computersStatus: "ready",
			documents: [],
			documentsStatus: "ready",
			orgSlug: "ari",
			profiles: [
				buildHumanProfile(),
				buildPersonalAgentProfile({
					managedRole: null,
					openMeldProfileId: "remote-a",
					profileName: "Ari’s Remote Agent",
				}),
			],
			subjectUserId: "user-a",
			agentProfileSummaries: [
				{
					agentControllerRef: "hosted:remote-agent",
					avatarImageUrl: null,
					id: "remote-a",
					modelSelection,
					modelSelectionIsKnown: true,
					name: "Ari’s Remote Agent",
					path: "/unused-directory-path",
				},
			],
		});
		expect(rows[0]?.agentProfiles[0]).toMatchObject({
			agentControllerRef: "hosted:remote-agent",
			modelSelection,
			modelSelectionIsKnown: true,
			path: "/o/ari/people/human-a/agents/remote-a",
		});
	});
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

	it("keeps the current member first and then sorts by most recent activity instead of role", () => {
		const directory = organizationDirectoryResponseSchema.parse({
			agentProfiles: [],
			generatedAt: "2026-08-20T00:00:00.000Z",
			members: [
				buildDirectoryMember({
					lastActiveAt: "2026-08-01T00:00:00.000Z",
					memberId: "member-self",
					name: "Self",
					role: "member",
					userId: "user-self",
				}),
				buildDirectoryMember({
					lastActiveAt: "2026-08-20T12:00:00.000Z",
					memberId: "member-recent",
					name: "Recent member",
					role: "member",
					userId: "user-recent",
				}),
				buildDirectoryMember({
					lastActiveAt: "2026-08-19T12:00:00.000Z",
					memberId: "member-owner",
					name: "Older owner",
					role: "owner",
					userId: "user-owner",
				}),
				buildDirectoryMember({
					lastActiveAt: null,
					memberId: "member-admin",
					name: "Inactive admin",
					role: "admin",
					userId: "user-admin",
				}),
			],
			organizationId: "org-a",
		});
		const rows = buildOrganizationHumanProfileRows({
			agentProfiles: [],
			canManageConnectedAccounts: true,
			canManageMessageChannels: true,
			computerGroups: resolveOrganizationComputerGroups({
				currentUserId: "user-self",
				directory,
				ownedComputers: [],
			}),
			computersStatus: "ready",
			currentUserComputersStatus: "ready",
			currentUserId: "user-self",
			documents: [],
			documentsStatus: "ready",
			members: directory.members,
			messageChannels: buildMessageChannels({
				connections: [],
				identityLinks: [],
			}),
			messageChannelsStatus: "ready",
			orgSlug: "acme",
		});

		expect(rows.map((row) => row.userId)).toEqual([
			"user-self",
			"user-recent",
			"user-owner",
			"user-admin",
		]);
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

	it("orders connected Channel identities before Channels that still need an account", () => {
		const [member] = buildOrganizationRows({
			messageChannels: buildMessageChannels({
				connections: [
					buildConnection({ provider: "lark" }),
					buildConnection({ provider: "slack" }),
				],
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

		expect(
			member?.identityAccounts.map((account) => ({
				provider: account.provider,
				state: account.state,
			}))
		).toEqual([
			{ provider: "slack", state: "connected" },
			{ provider: "lark", state: "not_connected" },
		]);
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
				agentControllerRef: "builtin:claude-code",
				avatarImageUrl: null,
				id: "agent-claude",
				modelSelection: null,
				modelSelectionIsKnown: true,
				name: "Ari Claude",
				path: "/o/acme/people/11111111-1111-4111-8111-111111111111/agents/agent-claude",
			},
			{
				agentControllerRef: "builtin:codex",
				avatarImageUrl: null,
				id: "agent-codex",
				modelSelection: null,
				modelSelectionIsKnown: true,
				name: "Ari Codex",
				path: "/o/acme/people/11111111-1111-4111-8111-111111111111/agents/agent-codex",
			},
		]);
		expect(rows.find((row) => row.userId === "user-a")?.agentProfilesPath).toBe(
			"/o/acme/people/11111111-1111-4111-8111-111111111111/agents"
		);
		expect(rows.find((row) => row.userId === "user-b")?.agentProfiles).toEqual([
			{
				agentControllerRef: "builtin:grok-build",
				avatarImageUrl: null,
				id: "agent-grok",
				modelSelection: null,
				modelSelectionIsKnown: true,
				name: "Builder",
				path: "/o/acme/people/22222222-2222-4222-8222-222222222222/agents/agent-grok",
			},
		]);
	});

	it.each([
		null,
		"2026-09-05T12:00:00.000Z",
	])("sorts by recorded task activity when available (%s), otherwise creation", (lastTaskActivityAt) => {
		const rows = buildOrganizationRows({
			agentProfiles: [
				buildAgentProfile({
					agentControllerRef: "builtin:codex",
					createdAt: "2026-09-04T12:00:00.000Z",
					ownerUserId: "user-a",
					profileId: "agent-new",
					profileName: "New Agent",
				}),
				buildAgentProfile({
					agentControllerRef: "builtin:claude-code",
					createdAt: "2026-08-01T12:00:00.000Z",
					lastUsedAt: "2026-09-05T12:00:00.000Z",
					ownerUserId: "user-a",
					profileId: "agent-recent",
					lastTaskActivityAt,
					profileName: "Recently Used Agent",
				}),
			],
			messageChannels: buildMessageChannels({
				connections: [],
				identityLinks: [],
			}),
			messageChannelsStatus: "ready",
		});

		expect(
			rows
				.find((row) => row.userId === "user-a")
				?.agentProfiles.map((profile) => profile.id)
		).toEqual(
			lastTaskActivityAt
				? ["agent-recent", "agent-new"]
				: ["agent-new", "agent-recent"]
		);
	});

	it("reads team-visible Controller and model selection from the lightweight directory", () => {
		const rows = buildOrganizationRows({
			agentProfiles: [
				{
					agentControllerRef: "builtin:codex",
					modelSelection: { modelId: "gpt-5.6-sol" },
					avatarUrl: undefined,
					isCenterAgent: false,
					ownerUserId: "user-b",
					profileId: "agent-team",
					profileName: "Team Agent",
					status: "active",
				} as OrganizationProfileDirectoryResponse["agentProfiles"][number],
			],
			messageChannels: buildMessageChannels({
				connections: [],
				identityLinks: [],
			}),
			messageChannelsStatus: "ready",
		});

		expect(rows.find((row) => row.userId === "user-b")?.agentProfiles).toEqual([
			{
				agentControllerRef: "builtin:codex",
				avatarImageUrl: null,
				id: "agent-team",
				modelSelection: { modelId: "gpt-5.6-sol" },
				modelSelectionIsKnown: true,
				name: "Team Agent",
				path: "/o/acme/people/22222222-2222-4222-8222-222222222222/agents/agent-team",
			},
		]);
	});

	it.each([
		{ controller: "builtin:codex", modelSelection: null, known: true },
		{ controller: "builtin:codex", modelSelection: undefined, known: false },
		{ controller: null, modelSelection: null, known: true },
	])("preserves default, unavailable and unbound lightweight configurations: %j", ({
		controller,
		modelSelection,
		known,
	}) => {
		const rows = buildOrganizationRows({
			agentProfiles: [
				{
					...buildAgentProfile({
						agentControllerRef: "builtin:codex",
						ownerUserId: "user-a",
						profileId: "agent-model",
						profileName: "Agent",
					}),
					agentControllerRef: controller,
					modelSelection,
				},
			],
			messageChannels: buildMessageChannels({
				connections: [],
				identityLinks: [],
			}),
			messageChannelsStatus: "ready",
		});
		expect(
			rows.find((row) => row.userId === "user-a")?.agentProfiles[0]
		).toMatchObject({
			agentControllerRef: controller,
			modelSelection: null,
			modelSelectionIsKnown: known,
		});
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
				agentControllerRef: null,
				avatarImageUrl: "https://example.com/ari-agent.png",
				id: "agent-ari",
				modelSelection: null,
				modelSelectionIsKnown: false,
				name: "Ari Agent",
				path: "/o/ari/people/human-a/agents/agent-ari",
			},
		]);
		expect(member?.agentProfilesPath).toBe(
			`/o/ari/people/${member?.id}/agents`
		);
	});
});

function buildOrganizationRows(input: {
	agentProfiles?: readonly (
		| OrganizationDirectoryResponse["agentProfiles"][number]
		| OrganizationProfileDirectoryResponse["agentProfiles"][number]
	)[];
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
		computerGroups: resolveOrganizationComputerGroups({
			currentUserId: "user-a",
			directory,
			ownedComputers: [],
		}),
		computersStatus: "ready",
		currentUserComputersStatus: "ready",
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
	createdAt?: string;
	isCenterAgent?: boolean;
	lastUsedAt?: string | null;
	ownerUserId: string;
	profileId: string;
	profileName: string;
}): OrganizationDirectoryResponse["agentProfiles"][number] {
	return {
		avatarUrl: undefined,
		createdAt: input.createdAt ?? "2026-08-20T00:00:00.000Z",
		isCenterAgent: input.isCenterAgent,
		lastUsedAt: input.lastUsedAt ?? null,
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
	lastActiveAt?: string | null;
	memberId: string;
	name?: string;
	role: string;
	userId: string;
}) {
	let lastActiveAt = input.lastActiveAt;
	if (lastActiveAt === undefined) {
		lastActiveAt =
			input.userId === "user-a" ? "2026-08-20T11:00:00.000Z" : null;
	}
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
		lastActiveAt,
		memberId: input.memberId,
		organizationId: "org-a",
		role: input.role,
		user: {
			email: `${input.userId}@example.com`,
			id: input.userId,
			image: null,
			name: input.name ?? input.userId,
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
