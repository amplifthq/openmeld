import { buildProfileDetailsSnapshotFromHumanProfile } from "@openmeld/agent-profile";
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
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import {
	buildOrganizationChannelsPath,
	buildOrganizationComputerPath,
	buildOrganizationComputersPath,
	buildOrganizationDocumentPath,
} from "#/lib/organizations/organization-routes";

type DirectoryHumanProfileRole = "admin" | "member" | "owner" | "unknown";

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

export type DirectoryIdentityAccount = {
	accountEmail: string | null;
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

type DirectoryProfileReportAction =
	| { kind: "link"; path: string }
	| { kind: "learn" }
	| { kind: "none" };

export type DirectoryHumanProfileRow = {
	avatarImageUrl: string | null;
	canEdit: boolean;
	computer: DirectoryHumanProfileComputer;
	details: ProfileDetailsSnapshot | null;
	email: string | null;
	hasDraft: boolean;
	id: string;
	identityAccounts: readonly DirectoryIdentityAccount[];
	isDefault: boolean;
	isCurrentUser: boolean;
	joinedAt: string | null;
	lastUsedAt: string | null;
	name: string;
	notice: string | null;
	reportAction: DirectoryProfileReportAction;
	profileStatus: "active" | "disabled" | null;
	role: DirectoryHumanProfileRole | null;
	userId: string;
};

export function buildOrganizationHumanProfileRows(input: {
	canManageConnectedAccounts: boolean;
	computers: OrganizationComputersResponse | null;
	computersStatus: DirectoryProjectionStatus;
	currentUserId: string;
	documents: readonly DirectoryProfileReportDocument[];
	documentsStatus: DirectoryDocumentsStatus;
	messageChannels: MessageChannelConnectionListResponse | null;
	messageChannelsStatus: DirectoryProjectionStatus;
	members: OrganizationDirectoryResponse["members"];
	orgSlug: string;
}): DirectoryHumanProfileRow[] {
	const reportsBySubject = indexProfileReportDocuments(input.documents);
	return input.members
		.map((member) => {
			const document = reportsBySubject.get(member.user.id);
			const humanProfile = member.humanProfile;
			const isCurrentUser = member.user.id === input.currentUserId;
			return {
				avatarImageUrl: member.user.image,
				canEdit: isCurrentUser && humanProfile?.status === "active",
				computer: resolveHumanProfileComputer({
					computers: input.computers,
					isCurrentUser,
					orgSlug: input.orgSlug,
					status: input.computersStatus,
					userId: member.user.id,
				}),
				identityAccounts: resolveIdentityAccounts({
					canManageConnectedAccounts: input.canManageConnectedAccounts,
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
				hasDraft: document?.hasDraft ?? false,
				id: humanProfile?.profileId ?? `member:${member.memberId}`,
				isDefault: false,
				isCurrentUser,
				joinedAt: member.joinedAt,
				lastUsedAt: humanProfile?.lastUsedAt ?? null,
				name:
					humanProfile?.profileName || member.user.name || member.user.email,
				notice: null,
				reportAction: resolveProfileReportAction({
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
	const reportAction = resolveProfileReportAction({
		document,
		documentsStatus: input.documentsStatus,
		orgSlug: input.orgSlug,
	});
	const hasDraft = document?.hasDraft ?? false;
	const profile =
		input.profiles.find((candidate) => candidate.isDefault) ??
		input.profiles[0];
	if (!profile) {
		return [
			{
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
				hasDraft,
				id: `member:${input.subjectUserId || input.orgSlug}`,
				identityAccounts: [],
				isDefault: false,
				isCurrentUser: true,
				joinedAt: null,
				lastUsedAt: null,
				name:
					input.account.name?.trim() ||
					input.account.email?.trim() ||
					"Current member",
				notice: resolveMissingPersonalHumanProfileMessage(
					input.canCreateHumanProfile
				),
				reportAction,
				profileStatus: null,
				role: null,
				userId: input.subjectUserId,
			},
		];
	}
	return [
		{
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
			hasDraft,
			id: profile.openMeldProfileId,
			identityAccounts: [],
			isDefault: profile.isDefault,
			isCurrentUser: true,
			joinedAt: null,
			lastUsedAt: profile.lastUsedAt,
			name: profile.profileName,
			notice: null,
			reportAction,
			profileStatus: profile.status,
			role: null,
			userId: input.subjectUserId,
		},
	];
}

export function resolveMissingPersonalHumanProfileMessage(
	canCreateHumanProfile: boolean
): string {
	return canCreateHumanProfile
		? "You don't have a Human Profile in this workspace yet. Create one to choose the name and identity you use in Spaces."
		: "You don't have a Human Profile in this workspace yet.";
}

function resolveProfileReportAction(input: {
	document: DirectoryProfileReportDocument | undefined;
	documentsStatus: DirectoryDocumentsStatus;
	orgSlug: string;
}): DirectoryProfileReportAction {
	if (input.documentsStatus !== "ready") {
		return { kind: "none" };
	}
	if (input.document) {
		return {
			kind: "link",
			path: buildOrganizationDocumentPath({
				documentId: input.document.id,
				orgSlug: input.orgSlug,
			}),
		};
	}
	return { kind: "learn" };
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
	if (input.status === "loading") {
		return {
			count: 0,
			label: "Checking computer…",
			path: null,
			state: "checking",
		};
	}
	if (input.status === "failed") {
		return {
			count: computers.length,
			label: "Computer status unavailable",
			path: resolveComputerPath({ ...input, computers }),
			state: "unknown",
		};
	}
	const connectedCount = computers.filter(
		(computer) => computer.serviceState === "connected"
	).length;
	if (connectedCount > 0) {
		return {
			count: computers.length,
			label:
				connectedCount === computers.length
					? formatComputerCount(connectedCount, "connected")
					: `${connectedCount} of ${computers.length} computers connected`,
			path: resolveComputerPath({ ...input, computers }),
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
			path: resolveComputerPath({ ...input, computers }),
			state: "needs_attention",
		};
	}
	if (computers.some((computer) => computer.serviceState === "unknown")) {
		return {
			count: computers.length,
			label: "Computer status unavailable",
			path: resolveComputerPath({ ...input, computers }),
			state: "unknown",
		};
	}
	if (computers.length > 0) {
		return {
			count: computers.length,
			label: `${computers.length} ${computers.length === 1 ? "computer" : "computers"} not connected`,
			path: resolveComputerPath({ ...input, computers }),
			state: "not_connected",
		};
	}
	return {
		count: 0,
		label: input.isCurrentUser ? "Connect a computer" : "No computer connected",
		path: resolveComputerPath({ ...input, computers }),
		state: "not_connected",
	};
}

function resolveComputerPath(input: {
	computers: OrganizationComputersResponse["computers"];
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
		deviceId: input.isCurrentUser
			? computer.computerId
			: `computer:${computer.computerId}`,
		orgSlug: input.orgSlug,
	});
}

function formatComputerCount(
	count: number,
	state: "connected" | "needs attention"
): string {
	if (count === 1) {
		return `1 computer ${state === "needs attention" ? "needs attention" : state}`;
	}
	return `${count} computers ${state === "needs attention" ? "need attention" : state}`;
}

function resolveIdentityAccounts(input: {
	canManageConnectedAccounts: boolean;
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
	const providers = new Set([
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
				return {
					accountEmail: null,
					canDisconnect:
						connectionIsReady &&
						(input.isCurrentUser || input.canManageConnectedAccounts),
					channelsPath: null,
					id: link.id,
					provider,
					providerLabel: resolveProviderLabel(provider),
					state: connectionIsReady ? "connected" : "unavailable",
				};
			}
			return {
				accountEmail: null,
				canDisconnect: false,
				channelsPath:
					input.isCurrentUser && connectionIsReady
						? buildOrganizationChannelsPath(input.orgSlug)
						: null,
				id: null,
				provider,
				providerLabel: resolveProviderLabel(provider),
				state: connectionIsReady ? "not_connected" : "unavailable",
			};
		})
		.sort((left, right) =>
			left.providerLabel.localeCompare(right.providerLabel)
		);
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
