import { buildProfileDetailsSnapshotFromHumanProfile } from "@openmeld/agent-profile";
import type {
	AgentProfileBindingModelSelection,
	AuthProfileView,
	ListOrganizationDocumentsResponse,
	MessageChannelConnectionListResponse,
	MessageChannelConnectionProjection,
	OrganizationAgentRuntimeOverviewResponse,
	OrganizationComputersResponse,
	OrganizationDirectoryResponse,
	OrganizationProfileDirectoryResponse,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import type { AppShellAccount } from "#/components/app/app-shell-account";
import type { OrganizationComputerGroup } from "#/components/computers/organization-computers";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import {
	buildOrganizationChannelsPath,
	buildOrganizationComputerPath,
	buildOrganizationComputersPath,
	buildOrganizationDocumentPath,
	buildOrganizationPersonAgentPath,
	buildOrganizationPersonAgentsPath,
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
	agentControllerRef: string | null;
	avatarImageUrl: string | null;
	id: string;
	modelSelection: AgentProfileBindingModelSelection | null;
	modelSelectionIsKnown: boolean;
	name: string;
	path: string;
};

type DirectoryAgentProfileSource =
	| OrganizationProfileDirectoryResponse["agentProfiles"][number]
	| OrganizationDirectoryResponse["agentProfiles"][number];

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
	agentProfiles: readonly (
		| OrganizationProfileDirectoryResponse["agentProfiles"][number]
		| OrganizationDirectoryResponse["agentProfiles"][number]
	)[];
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
	members: OrganizationProfileDirectoryResponse["members"];
	orgSlug: string;
	runtimeOverview?: OrganizationAgentRuntimeOverviewResponse;
}): DirectoryHumanProfileRow[] {
	const reportsBySubject = indexProfileReportDocuments(input.documents);
	const agentProfilesByOwner = buildDirectoryAgentProfilesByOwner({
		members: input.members,
		agentProfiles: input.agentProfiles,
		orgSlug: input.orgSlug,
		runtimeOverview: input.runtimeOverview,
	});
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
					personId: humanProfile?.profileId ?? `member:${member.memberId}`,
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
	agentProfileSummaries?: readonly DirectoryAgentProfileSummary[];
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
	const agentProfiles = buildPersonalAgentProfileSummaries({
		summaries: input.agentProfileSummaries,
		personId: (
			humanProfiles.find((candidate) => candidate.isDefault) ?? humanProfiles[0]
		)?.openMeldProfileId,
		orgSlug: input.orgSlug,
		profiles: input.profiles,
	});
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
					personId: `member:${input.subjectUserId}`,
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
				personId: profile.openMeldProfileId,
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

function buildPersonalAgentProfileSummaries(input: {
	summaries?: readonly DirectoryAgentProfileSummary[];
	personId?: string;
	orgSlug: string;
	profiles: readonly AuthProfileView[];
}): readonly DirectoryAgentProfileSummary[] {
	const agentProfiles: DirectoryAgentProfileSummary[] = [];
	const summariesById = new Map(
		input.summaries?.map((summary) => [summary.id, summary])
	);
	for (const profile of input.profiles) {
		if (profile.profileKind !== "agent" || profile.managedRole !== null) {
			continue;
		}
		const summary = summariesById.get(profile.openMeldProfileId);
		agentProfiles.push({
			agentControllerRef: summary?.agentControllerRef ?? null,
			avatarImageUrl: profile.avatarUrl ?? null,
			id: profile.openMeldProfileId,
			modelSelection: summary?.modelSelection ?? null,
			modelSelectionIsKnown: summary?.modelSelectionIsKnown ?? false,
			name: profile.profileName,
			path: input.personId
				? buildOrganizationPersonAgentPath({
						orgSlug: input.orgSlug,
						personId: input.personId,
						agentId: profile.openMeldProfileId,
					})
				: buildAgentProfilePath({
						orgSlug: input.orgSlug,
						profileId: profile.openMeldProfileId,
					}),
		});
	}
	return sortAgentProfileSummaries(agentProfiles);
}

export function buildDirectoryAgentProfilesByOwner(input: {
	members: OrganizationProfileDirectoryResponse["members"];
	agentProfiles: readonly DirectoryAgentProfileSource[];
	orgSlug: string;
	runtimeOverview?: OrganizationAgentRuntimeOverviewResponse;
}): ReadonlyMap<string, readonly DirectoryAgentProfileSummary[]> {
	const readinessByProfileId = new Map(
		(input.runtimeOverview?.agentProfiles ?? []).map((profile) => [
			profile.profileId,
			profile.readiness,
		])
	);
	const sourcesByOwner = new Map<string, DirectoryAgentProfileSource[]>();
	for (const profile of input.agentProfiles) {
		if (profile.isCenterAgent === true) {
			continue;
		}
		const profiles = sourcesByOwner.get(profile.ownerUserId) ?? [];
		profiles.push(profile);
		sourcesByOwner.set(profile.ownerUserId, profiles);
	}
	const profilesByOwner = new Map<
		string,
		readonly DirectoryAgentProfileSummary[]
	>();
	for (const [ownerUserId, sources] of sourcesByOwner) {
		const owner = input.members.find(
			(member) => member.user.id === ownerUserId
		);
		const personId = owner
			? (owner.humanProfile?.profileId ?? `member:${owner.memberId}`)
			: null;
		const profiles = [...sources]
			.sort(compareAgentProfileSourceRecency)
			.map((profile) => {
				const directoryReadiness =
					"readiness" in profile ? profile.readiness : null;
				const readiness =
					readinessByProfileId.get(profile.profileId) ?? directoryReadiness;
				const lightweightAgentControllerRef =
					"agentControllerRef" in profile ? profile.agentControllerRef : null;
				const agentControllerRef =
					lightweightAgentControllerRef ??
					readiness?.primaryBinding?.executionTarget?.agentControllerRef ??
					readiness?.publicProfileConfiguration?.agentControllerRef ??
					readiness?.agentControllerRef ??
					null;
				return {
					agentControllerRef,
					avatarImageUrl: profile.avatarUrl ?? null,
					id: profile.profileId,
					modelSelection:
						readiness?.primaryBinding?.modelSelection ??
						readiness?.publicProfileConfiguration?.modelSelection ??
						null,
					modelSelectionIsKnown: readiness !== null,
					name: profile.profileName,
					path: personId
						? buildOrganizationPersonAgentPath({
								orgSlug: input.orgSlug,
								personId,
								agentId: profile.profileId,
							})
						: buildAgentProfilePath({
								orgSlug: input.orgSlug,
								profileId: profile.profileId,
							}),
				};
			});
		profilesByOwner.set(ownerUserId, profiles);
	}
	return profilesByOwner;
}

function compareAgentProfileSourceRecency(
	left: Pick<DirectoryAgentProfileSource, "createdAt" | "lastUsedAt"> & {
		profileId: string;
		profileName: string;
	},
	right: Pick<DirectoryAgentProfileSource, "createdAt" | "lastUsedAt"> & {
		profileId: string;
		profileName: string;
	}
): number {
	const leftActivityAt = resolveAgentProfileActivityTime(left);
	const rightActivityAt = resolveAgentProfileActivityTime(right);
	const recencyComparison = rightActivityAt - leftActivityAt;
	if (recencyComparison !== 0) {
		return recencyComparison;
	}
	const nameComparison = left.profileName.localeCompare(
		right.profileName,
		"en",
		{
			numeric: true,
			sensitivity: "base",
		}
	);
	return nameComparison === 0
		? left.profileId.localeCompare(right.profileId)
		: nameComparison;
}

function resolveAgentProfileActivityTime(
	profile: Pick<DirectoryAgentProfileSource, "createdAt" | "lastUsedAt">
): number {
	return Math.max(
		...[profile.createdAt, profile.lastUsedAt]
			.filter((value): value is string => Boolean(value))
			.map((value) => Date.parse(value))
			.filter((value) => !Number.isNaN(value)),
		0
	);
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
	personId: string;
	orgSlug: string;
}): string {
	return buildOrganizationPersonAgentsPath(input);
}

export function resolveMissingPersonalHumanProfileMessage(
	canCreateHumanProfile: boolean
): string {
	return canCreateHumanProfile
		? "You aren't listed in this workspace yet. Create a profile to choose the name and identity you use in Spaces."
		: "You aren't listed in this workspace yet.";
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

export function resolveHumanProfileComputer(input: {
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
			// Inventory connection identity means this Computer is registered as one
			// current record. It is not OpenMeld Service liveness.
			serviceState: computer.serviceState ?? "unknown",
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
			label: "Computer disconnected",
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

function compareDirectoryHumanProfileRows(
	left: DirectoryHumanProfileRow,
	right: DirectoryHumanProfileRow
): number {
	if (left.isCurrentUser !== right.isCurrentUser) {
		return left.isCurrentUser ? -1 : 1;
	}
	const activityComparison = compareLastActiveAt(
		left.lastActiveAt,
		right.lastActiveAt
	);
	if (activityComparison !== 0) {
		return activityComparison;
	}
	const nameComparison = left.name.localeCompare(right.name, "en", {
		numeric: true,
		sensitivity: "base",
	});
	return nameComparison === 0
		? left.userId.localeCompare(right.userId)
		: nameComparison;
}

function compareLastActiveAt(
	left: string | null,
	right: string | null
): number {
	if (left === null || right === null) {
		if (left === right) {
			return 0;
		}
		return left === null ? 1 : -1;
	}
	return Date.parse(right) - Date.parse(left);
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
