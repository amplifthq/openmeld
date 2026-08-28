import { buildProfileDetailsSnapshotFromHumanProfile } from "@openmeld/agent-profile";
import { parseAgentControllerRef } from "@openmeld/agent-runtime";
import type {
	AuthProfileView,
	ListOrganizationDocumentsResponse,
	MessageChannelConnectionListResponse,
	MessageChannelConnectionProjection,
	OrganizationComputersResponse,
	OrganizationDirectoryResponse,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import type { AppShellAccount } from "#/components/app/app-shell-account";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import {
	buildOrganizationAgentsPath,
	buildOrganizationChannelsPath,
	buildOrganizationComputerPath,
	buildOrganizationComputersPath,
	buildOrganizationDocumentPath,
} from "#/lib/organizations/organization-routes";
import { buildAgentProfilePath } from "#/lib/profile-routes";
import { buildSlackIdentityStartPath } from "#/lib/slack-oauth-start";

type DirectoryHumanProfileRole = "admin" | "member" | "owner" | "unknown";

const DIRECTORY_IDENTITY_ACCOUNT_STATE_ORDER = {
	connected: 0,
	not_connected: 1,
	unavailable: 2,
} as const;

export type DirectoryDocumentsStatus = "failed" | "loading" | "ready";

export type DirectoryProjectionStatus = "failed" | "loading" | "ready";

export type DirectoryComputerDisplayState =
	| "checking"
	| "connected"
	| "needs_attention"
	| "not_connected"
	| "unknown";

export type DirectoryHumanProfileComputer = {
	count: number;
	label: string;
	path: string | null;
	state: DirectoryComputerDisplayState;
};

export type DirectoryAgentProfileSummary = {
	agentId: string | null;
	avatarImageUrl: string | null;
	id: string;
	name: string;
};

export type DirectoryIdentityAccount = {
	accountEmail: string | null;
	accountName: string | null;
	action: {
		kind:
			| "ask_admin"
			| "authorize"
			| "connect_via_center_agent"
			| "manage_channels";
		label: string;
		path: string | null;
	} | null;
	canDisconnect: boolean;
	channelsPath: string | null;
	id: string | null;
	provider: MessageChannelConnectionProjection["provider"];
	providerLabel: string;
	state: "connected" | "not_connected" | "unavailable";
};

type DirectoryProfileReportDocument = Pick<
	ListOrganizationDocumentsResponse["documents"][number],
	| "hasDraft"
	| "id"
	| "kind"
	| "createdAt"
	| "profileReportDate"
	| "subjectUserId"
	| "updatedAt"
>;

export type DirectoryProfileReport =
	| { hasDraft: boolean; path: string; state: "available" }
	| { state: "missing" }
	| { state: "unavailable" };

export type DirectoryHumanProfileRow = {
	agentProfiles: readonly DirectoryAgentProfileSummary[];
	agentProfilesPath: string;
	avatarImageUrl: string | null;
	canEdit: boolean;
	computer: DirectoryHumanProfileComputer;
	details: ProfileDetailsSnapshot | null;
	email: string | null;
	id: string;
	identityAccounts: readonly DirectoryIdentityAccount[];
	isDefault: boolean;
	isCurrentUser: boolean;
	joinedAt: string | null;
	lastActiveAt: string | null;
	name: string;
	notice: string | null;
	profileReport: DirectoryProfileReport;
	profileStatus: "active" | "disabled" | null;
	role: DirectoryHumanProfileRole | null;
	userId: string;
};

export function buildOrganizationHumanProfileRows(input: {
	agentProfiles: OrganizationDirectoryResponse["agentProfiles"];
	canManageConnectedAccounts: boolean;
	canManageMessageChannels: boolean;
	computerGroups: readonly OrganizationComputerGroup[];
	computersStatus: DirectoryProjectionStatus;
	currentUserComputersStatus: DirectoryProjectionStatus;
	currentUserId: string;
	documents: readonly DirectoryProfileReportDocument[];
	documentsStatus: DirectoryDocumentsStatus;
	messageChannels: MessageChannelConnectionListResponse | null;
	messageChannelsStatus: DirectoryProjectionStatus;
	members: OrganizationDirectoryResponse["members"];
	orgSlug: string;
}): DirectoryHumanProfileRow[] {
	const reportsBySubject = indexProfileReportDocuments(input.documents);
	const agentProfilesByOwner = indexAgentProfilesByOwner(input.agentProfiles);
	return input.members
		.map((member) => {
			const document = reportsBySubject.get(member.user.id);
			const humanProfile = member.humanProfile;
			const isCurrentUser = member.user.id === input.currentUserId;
			const agentProfiles = agentProfilesByOwner.get(member.user.id) ?? [];
			const computerGroup = input.computerGroups.find(
				(group) => group.ownerUserId === member.user.id
			);
			return {
				agentProfiles,
				agentProfilesPath: resolveAgentProfilesPath({
					agentProfiles,
					orgSlug: input.orgSlug,
				}),
				avatarImageUrl: member.user.image,
				canEdit: isCurrentUser && humanProfile?.status === "active",
				computer: resolveHumanProfileComputerGroup({
					computerGroup,
					isCurrentUser,
					orgSlug: input.orgSlug,
					status: isCurrentUser
						? input.currentUserComputersStatus
						: input.computersStatus,
				}),
				identityAccounts: resolveIdentityAccounts({
					canManageConnectedAccounts: input.canManageConnectedAccounts,
					canManageMessageChannels: input.canManageMessageChannels,
					isCurrentUser,
					messageChannels: input.messageChannels,
					messageChannelsStatus: input.messageChannelsStatus,
					orgSlug: input.orgSlug,
					userId: member.user.id,
				}),
				details: humanProfile
					? buildProfileDetailsSnapshotFromHumanProfile({
							profileId: humanProfile.profileId,
							profileName: humanProfile.profileName,
							viewerScope: isCurrentUser ? "owner_self" : "observer",
						})
					: null,
				email: member.user.email,
				id: humanProfile?.profileId ?? `member:${member.memberId}`,
				isDefault: false,
				isCurrentUser,
				joinedAt: member.joinedAt,
				lastActiveAt: member.lastActiveAt ?? null,
				name:
					humanProfile?.profileName || member.user.name || member.user.email,
				notice: null,
				profileReport: resolveProfileReport({
					document,
					documentsStatus: input.documentsStatus,
					orgSlug: input.orgSlug,
				}),
				profileStatus: humanProfile?.status ?? null,
				role: resolveDirectoryHumanProfileRole(member.role),
				userId: member.user.id,
			};
		})
		.sort(compareDirectoryHumanProfileRows);
}

export function buildPersonalHumanProfileRows(input: {
	account: AppShellAccount;
	canCreateHumanProfile: boolean;
	computers: OrganizationComputersResponse | null;
	computersStatus: DirectoryProjectionStatus;
	documents: readonly DirectoryProfileReportDocument[];
	documentsStatus: DirectoryDocumentsStatus;
	orgSlug: string;
	profiles: readonly AuthProfileView[];
	subjectUserId: string;
}): DirectoryHumanProfileRow[] {
	const reportsBySubject = indexProfileReportDocuments(input.documents);
	const document = reportsBySubject.get(input.subjectUserId);
	const humanProfiles = input.profiles.filter(
		(candidate) => candidate.profileKind === "human"
	);
	const agentProfiles = buildPersonalAgentProfileSummaries(input.profiles);
	const profileReport = resolveProfileReport({
		document,
		documentsStatus: input.documentsStatus,
		orgSlug: input.orgSlug,
	});
	const profile =
		humanProfiles.find((candidate) => candidate.isDefault) ?? humanProfiles[0];
	if (!profile) {
		return [
			{
				agentProfiles,
				agentProfilesPath: resolveAgentProfilesPath({
					agentProfiles,
					orgSlug: input.orgSlug,
				}),
				avatarImageUrl: null,
				canEdit: false,
				computer: resolveHumanProfileComputer({
					computers: input.computers,
					isCurrentUser: true,
					orgSlug: input.orgSlug,
					status: input.computersStatus,
					userId: input.subjectUserId,
				}),
				details: null,
				email: input.account.email?.trim() || null,
				id: `member:${input.subjectUserId || input.orgSlug}`,
				identityAccounts: [],
				isDefault: false,
				isCurrentUser: true,
				joinedAt: null,
				lastActiveAt: null,
				name:
					input.account.name?.trim() ||
					input.account.email?.trim() ||
					"Current member",
				notice: resolveMissingPersonalHumanProfileMessage(
					input.canCreateHumanProfile
				),
				profileReport,
				profileStatus: null,
				role: null,
				userId: input.subjectUserId,
			},
		];
	}
	return [
		{
			agentProfiles,
			agentProfilesPath: resolveAgentProfilesPath({
				agentProfiles,
				orgSlug: input.orgSlug,
			}),
			avatarImageUrl: profile.avatarUrl ?? null,
			canEdit: profile.isDefault && profile.status === "active",
			computer: resolveHumanProfileComputer({
				computers: input.computers,
				isCurrentUser: true,
				orgSlug: input.orgSlug,
				status: input.computersStatus,
				userId: input.subjectUserId,
			}),
			details: buildProfileDetailsSnapshotFromHumanProfile({
				profileId: profile.openMeldProfileId,
				profileName: profile.profileName,
				viewerScope: "owner_self",
			}),
			email: input.account.email?.trim() || null,
			id: profile.openMeldProfileId,
			identityAccounts: [],
			isDefault: profile.isDefault,
			isCurrentUser: true,
			joinedAt: null,
			lastActiveAt: null,
			name: profile.profileName,
			notice: null,
			profileReport,
			profileStatus: profile.status,
			role: null,
			userId: input.subjectUserId,
		},
	];
}

function buildPersonalAgentProfileSummaries(
	profiles: readonly AuthProfileView[]
): readonly DirectoryAgentProfileSummary[] {
	const agentProfiles: DirectoryAgentProfileSummary[] = [];
	for (const profile of profiles) {
		if (profile.profileKind !== "agent" || profile.managedRole !== null) {
			continue;
		}
		agentProfiles.push({
			agentId: null,
			avatarImageUrl: profile.avatarUrl ?? null,
			id: profile.openMeldProfileId,
			name: profile.profileName,
		});
	}
	return sortAgentProfileSummaries(agentProfiles);
}

function indexAgentProfilesByOwner(
	agentProfiles: OrganizationDirectoryResponse["agentProfiles"]
): ReadonlyMap<string, readonly DirectoryAgentProfileSummary[]> {
	const profilesByOwner = new Map<string, DirectoryAgentProfileSummary[]>();
	for (const profile of agentProfiles) {
		if (profile.isCenterAgent === true) {
			continue;
		}
		const profiles = profilesByOwner.get(profile.ownerUserId) ?? [];
		profiles.push({
			agentId:
				parseAgentControllerRef(profile.readiness.agentControllerRef)?.id ??
				null,
			avatarImageUrl: profile.avatarUrl ?? null,
			id: profile.profileId,
			name: profile.profileName,
		});
		profilesByOwner.set(profile.ownerUserId, profiles);
	}
	for (const profiles of profilesByOwner.values()) {
		sortAgentProfileSummaries(profiles);
	}
	return profilesByOwner;
}

function sortAgentProfileSummaries(
	profiles: DirectoryAgentProfileSummary[]
): DirectoryAgentProfileSummary[] {
	return profiles.sort((left, right) => {
		const nameComparison = left.name.localeCompare(right.name, "en", {
			numeric: true,
			sensitivity: "base",
		});
		return nameComparison === 0
			? left.id.localeCompare(right.id)
			: nameComparison;
	});
}

function resolveAgentProfilesPath(input: {
	agentProfiles: readonly DirectoryAgentProfileSummary[];
	orgSlug: string;
}): string {
	const firstProfile = input.agentProfiles[0];
	return firstProfile
		? buildAgentProfilePath({
				orgSlug: input.orgSlug,
				profileId: firstProfile.id,
			})
		: buildOrganizationAgentsPath(input.orgSlug);
}

export function resolveMissingPersonalHumanProfileMessage(
	canCreateHumanProfile: boolean
): string {
	return canCreateHumanProfile
		? "You don't have a Human Profile in this workspace yet. Create one to choose the name and identity you use in Spaces."
		: "You don't have a Human Profile in this workspace yet.";
}

function resolveProfileReport(input: {
	document: DirectoryProfileReportDocument | undefined;
	documentsStatus: DirectoryDocumentsStatus;
	orgSlug: string;
}): DirectoryProfileReport {
	if (input.documentsStatus !== "ready") {
		return { state: "unavailable" };
	}
	if (input.document) {
		return {
			hasDraft: input.document.hasDraft,
			path: buildOrganizationDocumentPath({
				documentId: input.document.id,
				orgSlug: input.orgSlug,
			}),
			state: "available",
		};
	}
	return { state: "missing" };
}

function indexProfileReportDocuments(
	documents: readonly DirectoryProfileReportDocument[]
): ReadonlyMap<string, DirectoryProfileReportDocument> {
	const documentsBySubject = new Map<string, DirectoryProfileReportDocument>();
	for (const document of documents) {
		if (document.kind === "member_profile" && document.subjectUserId) {
			const current = documentsBySubject.get(document.subjectUserId);
			if (!current || compareProfileReportRecency(document, current) > 0) {
				documentsBySubject.set(document.subjectUserId, document);
			}
		}
	}
	return documentsBySubject;
}

function compareProfileReportRecency(
	left: DirectoryProfileReportDocument,
	right: DirectoryProfileReportDocument
): number {
	const reportDateComparison = (left.profileReportDate ?? "").localeCompare(
		right.profileReportDate ?? ""
	);
	if (reportDateComparison !== 0) {
		return reportDateComparison;
	}
	const createdAtComparison = left.createdAt.localeCompare(right.createdAt);
	return createdAtComparison === 0
		? left.id.localeCompare(right.id)
		: createdAtComparison;
}

function resolveDirectoryHumanProfileRole(
	role: string
): DirectoryHumanProfileRole {
	switch (role) {
		case "admin":
		case "member":
		case "owner":
			return role;
		default:
			return "unknown";
	}
}

function resolveHumanProfileComputer(input: {
	computers: OrganizationComputersResponse | null;
	isCurrentUser: boolean;
	orgSlug: string;
	status: DirectoryProjectionStatus;
	userId: string;
}): DirectoryHumanProfileComputer {
	const computers =
		input.computers?.computers.filter(
			(computer) => computer.ownerUserId === input.userId
		) ?? [];
	return resolveHumanProfileComputerRecords({
		computers: computers.map((computer) => ({
			routeId: input.isCurrentUser
				? computer.computerId
				: `computer:${computer.computerId}`,
			serviceState: computer.serviceState,
		})),
		isCurrentUser: input.isCurrentUser,
		orgSlug: input.orgSlug,
		status: input.status,
	});
}

function resolveHumanProfileComputerGroup(input: {
	computerGroup: OrganizationComputerGroup | undefined;
	isCurrentUser: boolean;
	orgSlug: string;
	status: DirectoryProjectionStatus;
}): DirectoryHumanProfileComputer {
	return resolveHumanProfileComputerRecords({
		computers: (input.computerGroup?.computers ?? []).map((computer) => ({
			routeId: computer.routeId,
			serviceState:
				computer.serviceState ??
				(computer.ownedComputer?.connectionStatus === "connected"
					? "connected"
					: "unknown"),
		})),
		isCurrentUser: input.isCurrentUser,
		orgSlug: input.orgSlug,
		status: input.status,
	});
}

type HumanProfileComputerRecord = {
	routeId: string;
	serviceState: "connected" | "needs_attention" | "not_connected" | "unknown";
};

function resolveHumanProfileComputerRecords(input: {
	computers: readonly HumanProfileComputerRecord[];
	isCurrentUser: boolean;
	orgSlug: string;
	status: DirectoryProjectionStatus;
}): DirectoryHumanProfileComputer {
	const computers = input.computers;
	if (input.status === "loading") {
		return {
			count: computers.length,
			label: "Checking computer…",
			path: null,
			state: "checking",
		};
	}
	if (input.status === "failed") {
		return {
			count: computers.length,
			label: "Computer status unavailable",
			path: resolveComputerRecordsPath(input),
			state: "unknown",
		};
	}
	const connectedCount = computers.filter(
		(computer) => computer.serviceState === "connected"
	).length;
	if (connectedCount > 0) {
		return {
			count: computers.length,
			label: formatComputerCount(connectedCount, "connected"),
			path: resolveComputerRecordsPath(input),
			state: "connected",
		};
	}
	const needsAttentionCount = computers.filter(
		(computer) => computer.serviceState === "needs_attention"
	).length;
	if (needsAttentionCount > 0) {
		return {
			count: computers.length,
			label: formatComputerCount(needsAttentionCount, "needs attention"),
			path: resolveComputerRecordsPath(input),
			state: "needs_attention",
		};
	}
	if (computers.some((computer) => computer.serviceState === "unknown")) {
		return {
			count: computers.length,
			label: "Computer status unavailable",
			path: resolveComputerRecordsPath(input),
			state: "unknown",
		};
	}
	if (computers.length > 0) {
		return {
			count: computers.length,
			label: "Computer offline",
			path: resolveComputerRecordsPath(input),
			state: "not_connected",
		};
	}
	return {
		count: 0,
		label: input.isCurrentUser ? "Connect a computer" : "No computer connected",
		path: resolveComputerRecordsPath(input),
		state: "not_connected",
	};
}

function resolveComputerRecordsPath(input: {
	computers: readonly HumanProfileComputerRecord[];
	isCurrentUser: boolean;
	orgSlug: string;
}): string | null {
	if (input.computers.length === 0) {
		return input.isCurrentUser
			? buildConnectComputerPath({ orgSlug: input.orgSlug, session: "fresh" })
			: null;
	}
	if (input.computers.length > 1) {
		return buildOrganizationComputersPath(input.orgSlug);
	}
	const computer = input.computers[0];
	if (!computer) {
		return null;
	}
	return buildOrganizationComputerPath({
		deviceId: computer.routeId,
		orgSlug: input.orgSlug,
	});
}

function formatComputerCount(
	count: number,
	state: "connected" | "needs attention"
): string {
	if (count === 1) {
		return `Computer ${state === "needs attention" ? "needs attention" : state}`;
	}
	return `${count} computers ${state === "needs attention" ? "need attention" : state}`;
}

function resolveIdentityAccounts(input: {
	canManageConnectedAccounts: boolean;
	canManageMessageChannels: boolean;
	isCurrentUser: boolean;
	messageChannels: MessageChannelConnectionListResponse | null;
	messageChannelsStatus: DirectoryProjectionStatus;
	orgSlug: string;
	userId: string;
}): DirectoryIdentityAccount[] {
	if (!input.messageChannels) {
		return [];
	}
	const hasFreshConnections = input.messageChannelsStatus === "ready";
	const connectionByProvider = new Map(
		input.messageChannels.connections.map((connection) => [
			connection.provider,
			connection,
		])
	);
	const linkByProvider = new Map<
		DirectoryIdentityAccount["provider"],
		MessageChannelConnectionListResponse["identityLinks"][number]
	>();
	for (const link of input.messageChannels.identityLinks) {
		if (link.openMeldUserId === input.userId) {
			linkByProvider.set(link.provider, link);
		}
	}
	const providers = new Set<DirectoryIdentityAccount["provider"]>([
		"slack",
		...input.messageChannels.availableLarkPlatformProviders,
		...connectionByProvider.keys(),
		...input.messageChannels.identityLinks.map((link) => link.provider),
	]);
	return [...providers]
		.map((provider): DirectoryIdentityAccount => {
			const connection = connectionByProvider.get(provider);
			const link = linkByProvider.get(provider);
			const connectionIsReady =
				hasFreshConnections && connection?.status === "connected";
			if (link) {
				const action =
					input.isCurrentUser &&
					provider === "slack" &&
					connectionIsReady &&
					!link.providerAccountEmail
						? {
								kind: "authorize" as const,
								label: "Reconnect Slack",
								path: buildSlackIdentityStartPath(input.orgSlug),
							}
						: null;
				return {
					accountEmail: link.providerAccountEmail,
					accountName: link.providerAccountName,
					action,
					canDisconnect:
						input.isCurrentUser || input.canManageConnectedAccounts,
					channelsPath: null,
					id: link.id,
					provider,
					providerLabel: resolveProviderLabel(provider),
					state: connectionIsReady ? "connected" : "unavailable",
				};
			}
			const action =
				hasFreshConnections && input.isCurrentUser
					? resolveIdentityAccountAction({
							canManageMessageChannels: input.canManageMessageChannels,
							connectionIsReady,
							connectionStatus: connection?.status ?? null,
							orgSlug: input.orgSlug,
							provider,
							providerLabel: resolveProviderLabel(provider),
						})
					: null;
			return {
				accountEmail: null,
				accountName: null,
				action,
				canDisconnect: false,
				channelsPath: action?.path ?? null,
				id: null,
				provider,
				providerLabel: resolveProviderLabel(provider),
				state:
					hasFreshConnections && connectionIsReady
						? "not_connected"
						: "unavailable",
			};
		})
		.sort((left, right) => {
			const stateOrder =
				DIRECTORY_IDENTITY_ACCOUNT_STATE_ORDER[left.state] -
				DIRECTORY_IDENTITY_ACCOUNT_STATE_ORDER[right.state];
			return (
				stateOrder ||
				left.providerLabel.localeCompare(right.providerLabel, "en")
			);
		});
}

function resolveIdentityAccountAction(input: {
	canManageMessageChannels: boolean;
	connectionIsReady: boolean;
	connectionStatus: MessageChannelConnectionProjection["status"] | null;
	orgSlug: string;
	provider: DirectoryIdentityAccount["provider"];
	providerLabel: string;
}): NonNullable<DirectoryIdentityAccount["action"]> {
	if (input.connectionIsReady) {
		return input.provider === "slack"
			? {
					kind: "authorize",
					label: "Connect Slack",
					path: buildSlackIdentityStartPath(input.orgSlug),
				}
			: {
					kind: "connect_via_center_agent",
					label: `Connect ${input.providerLabel}`,
					path: buildOrganizationChannelsPath(input.orgSlug),
				};
	}
	if (input.canManageMessageChannels) {
		return {
			kind: "manage_channels",
			label:
				input.connectionStatus === "repair_required"
					? `Repair ${input.providerLabel}`
					: `Set up ${input.providerLabel}`,
			path: buildOrganizationChannelsPath(input.orgSlug),
		};
	}
	return {
		kind: "ask_admin",
		label:
			input.connectionStatus === "repair_required"
				? `${input.providerLabel} needs attention`
				: `Ask an admin to set up ${input.providerLabel}`,
		path: null,
	};
}

const DIRECTORY_ROLE_PRIORITY: Record<DirectoryHumanProfileRole, number> = {
	owner: 0,
	admin: 1,
	member: 2,
	unknown: 3,
};

function compareDirectoryHumanProfileRows(
	left: DirectoryHumanProfileRow,
	right: DirectoryHumanProfileRow
): number {
	if (left.isCurrentUser !== right.isCurrentUser) {
		return left.isCurrentUser ? -1 : 1;
	}
	const roleComparison =
		resolveRolePriority(left.role) - resolveRolePriority(right.role);
	if (roleComparison !== 0) {
		return roleComparison;
	}
	const nameComparison = left.name.localeCompare(right.name, "en", {
		numeric: true,
		sensitivity: "base",
	});
	return nameComparison === 0
		? left.userId.localeCompare(right.userId)
		: nameComparison;
}

function resolveRolePriority(role: DirectoryHumanProfileRole | null): number {
	return role === null
		? DIRECTORY_ROLE_PRIORITY.unknown
		: DIRECTORY_ROLE_PRIORITY[role];
}

function resolveProviderLabel(
	provider: MessageChannelConnectionProjection["provider"]
): string {
	switch (provider) {
		case "slack":
			return "Slack";
		case "lark":
			return "Lark";
		case "feishu":
			return "Feishu";
		default:
			return provider;
	}
}
