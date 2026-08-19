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

export type DirectoryConnectedAccount = {
	canDisconnect: boolean;
	id: string;
	provider: MessageChannelConnectionProjection["provider"];
	providerAccountName: string | null;
	providerLabel: string;
	state: "connected" | "unavailable";
};

export type DirectoryConnectableAccount = {
	channelsPath: string;
	provider: MessageChannelConnectionProjection["provider"];
	providerLabel: string;
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
	connectableAccounts: readonly DirectoryConnectableAccount[];
	connectedAccounts: readonly DirectoryConnectedAccount[];
	details: ProfileDetailsSnapshot | null;
	email: string;
	hasDraft: boolean;
	id: string;
	isDefault: boolean;
	isCurrentUser: boolean;
	name: string;
	notice: string | null;
	reportAction: DirectoryProfileReportAction;
	profileStatus: "active" | "disabled" | null;
	role: DirectoryHumanProfileRole;
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
	return input.members.map((member) => {
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
			connectableAccounts: resolveConnectableAccounts({
				isCurrentUser,
				messageChannels: input.messageChannels,
				orgSlug: input.orgSlug,
				userId: member.user.id,
			}),
			connectedAccounts: resolveConnectedAccounts({
				canManageConnectedAccounts: input.canManageConnectedAccounts,
				isCurrentUser,
				messageChannels: input.messageChannels,
				messageChannelsStatus: input.messageChannelsStatus,
				userId: member.user.id,
			}),
			details:
				humanProfile?.status === "active"
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
			name: humanProfile?.profileName || member.user.name || member.user.email,
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
	});
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
				connectableAccounts: [],
				connectedAccounts: [],
				details: null,
				email: input.account.email?.trim() || "Current member",
				hasDraft,
				id: `member:${input.subjectUserId || input.orgSlug}`,
				isDefault: false,
				isCurrentUser: true,
				name:
					input.account.name?.trim() ||
					input.account.email?.trim() ||
					"Current member",
				notice: resolveMissingPersonalHumanProfileMessage(
					input.canCreateHumanProfile
				),
				reportAction,
				profileStatus: null,
				role: "owner",
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
			connectableAccounts: [],
			connectedAccounts: [],
			details:
				profile.status === "active"
					? buildProfileDetailsSnapshotFromHumanProfile({
							profileId: profile.openMeldProfileId,
							profileName: profile.profileName,
							viewerScope: "owner_self",
						})
					: null,
			email: input.account.email?.trim() || "Current member",
			hasDraft,
			id: profile.openMeldProfileId,
			isDefault: profile.isDefault,
			isCurrentUser: true,
			name: profile.profileName,
			notice: null,
			reportAction,
			profileStatus: profile.status,
			role: "owner",
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
	return {
		count: computers.length,
		label: input.isCurrentUser ? "Connect a computer" : "No computer connected",
		path: resolveComputerPath({ ...input, computers }),
		state: computers.some((computer) => computer.serviceState === "unknown")
			? "unknown"
			: "not_connected",
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

function resolveConnectedAccounts(input: {
	canManageConnectedAccounts: boolean;
	isCurrentUser: boolean;
	messageChannels: MessageChannelConnectionListResponse | null;
	messageChannelsStatus: DirectoryProjectionStatus;
	userId: string;
}): DirectoryConnectedAccount[] {
	const connectionByProvider = new Map(
		(input.messageChannels?.connections ?? []).map((connection) => [
			connection.provider,
			connection,
		])
	);
	const connectedAccounts: DirectoryConnectedAccount[] = [];
	for (const link of input.messageChannels?.identityLinks ?? []) {
		if (link.openMeldUserId !== input.userId) {
			continue;
		}
		connectedAccounts.push({
			canDisconnect: input.isCurrentUser || input.canManageConnectedAccounts,
			id: link.id,
			provider: link.provider,
			providerAccountName: link.providerAccountName,
			providerLabel: resolveProviderLabel(link.provider),
			state:
				input.messageChannelsStatus === "ready" &&
				connectionByProvider.get(link.provider)?.status === "connected"
					? "connected"
					: "unavailable",
		});
	}
	return connectedAccounts;
}

function resolveConnectableAccounts(input: {
	isCurrentUser: boolean;
	messageChannels: MessageChannelConnectionListResponse | null;
	orgSlug: string;
	userId: string;
}): DirectoryConnectableAccount[] {
	if (!(input.isCurrentUser && input.messageChannels)) {
		return [];
	}
	const linkedProviders = new Set<
		MessageChannelConnectionProjection["provider"]
	>();
	for (const link of input.messageChannels.identityLinks) {
		if (link.openMeldUserId === input.userId) {
			linkedProviders.add(link.provider);
		}
	}
	const connectableAccounts: DirectoryConnectableAccount[] = [];
	for (const connection of input.messageChannels.connections) {
		if (
			connection.status !== "connected" ||
			linkedProviders.has(connection.provider)
		) {
			continue;
		}
		connectableAccounts.push({
			channelsPath: buildOrganizationChannelsPath(input.orgSlug),
			provider: connection.provider,
			providerLabel: resolveProviderLabel(connection.provider),
		});
	}
	return connectableAccounts;
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
