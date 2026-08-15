import { buildProfileDetailsSnapshotFromHumanProfile } from "@openmeld/agent-profile";
import type {
	AuthProfileView,
	ListOrganizationDocumentsResponse,
	OrganizationDirectoryResponse,
	OrganizationMemberOpenMeldServiceState,
	ProfileDetailsSnapshot,
} from "@openmeld/schemas/types";
import type { AppShellAccount } from "#/components/app/app-shell-account";
import {
	buildOrganizationDocumentPath,
	buildOrganizationNewDocumentPath,
} from "#/lib/organizations/organization-routes";
import {
	formatProfileDate,
	formatProfileDateTime,
} from "#/lib/profiles/profile-date-format";

type DirectoryHumanProfileRole = "admin" | "member" | "owner" | "unknown";

export type DirectoryDocumentsStatus = "failed" | "loading" | "ready";

export type DirectoryMemberOpenMeldServiceDisplayState =
	| OrganizationMemberOpenMeldServiceState
	| "checking";

type DirectoryProfileReportDocument = Pick<
	ListOrganizationDocumentsResponse["documents"][number],
	| "hasDraft"
	| "id"
	| "kind"
	| "profileReportDate"
	| "subjectUserId"
	| "updatedAt"
>;

type DirectoryProfileReportAction =
	| { kind: "link"; path: string }
	| { kind: "unavailable"; reason: string };

export type DirectoryHumanProfileRow = {
	avatarImageUrl: string | null;
	canEdit: boolean;
	details: ProfileDetailsSnapshot | null;
	email: string;
	footerDetail: string;
	hasDraft: boolean;
	id: string;
	isDefault: boolean;
	isCurrentUser: boolean;
	name: string;
	reportAction: DirectoryProfileReportAction;
	profileHandle: string | null;
	profileStatus: "active" | "disabled" | null;
	role: DirectoryHumanProfileRole;
	userId: string;
	openMeldServiceState: DirectoryMemberOpenMeldServiceDisplayState | null;
};

export function buildOrganizationHumanProfileRows(input: {
	canCreateProfiles: boolean;
	currentUserId: string;
	documents: readonly DirectoryProfileReportDocument[];
	documentsStatus: DirectoryDocumentsStatus;
	memberOpenMeldServiceFallbackState: DirectoryMemberOpenMeldServiceDisplayState;
	memberOpenMeldServiceStatesByUserId: ReadonlyMap<
		string,
		OrganizationMemberOpenMeldServiceState
	>;
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
			details:
				humanProfile?.status === "active"
					? buildProfileDetailsSnapshotFromHumanProfile({
							profileHandle: humanProfile.profileHandle,
							profileId: humanProfile.profileId,
							profileName: humanProfile.profileName,
							profileStatus: humanProfile.status,
							viewerScope: isCurrentUser ? "owner_self" : "observer",
						})
					: null,
			email: member.user.email,
			footerDetail: resolveOrganizationHumanProfileLastActiveLabel(
				humanProfile?.lastUsedAt ?? null
			),
			hasDraft: document?.hasDraft ?? false,
			id: humanProfile?.profileId ?? `member:${member.memberId}`,
			isDefault: false,
			isCurrentUser,
			name: humanProfile?.profileName || member.user.name || member.user.email,
			reportAction: resolveProfileReportAction({
				canCreate: input.canCreateProfiles,
				document,
				documentsStatus: input.documentsStatus,
				orgSlug: input.orgSlug,
				subjectUserId: member.user.id,
			}),
			profileHandle: humanProfile?.profileHandle ?? null,
			profileStatus: humanProfile?.status ?? null,
			role: resolveDirectoryHumanProfileRole(member.role),
			userId: member.user.id,
			openMeldServiceState:
				input.memberOpenMeldServiceStatesByUserId.get(member.user.id) ??
				input.memberOpenMeldServiceFallbackState,
		};
	});
}

export function buildPersonalHumanProfileRows(input: {
	account: AppShellAccount;
	canCreateHumanProfile: boolean;
	canCreateProfiles: boolean;
	documents: readonly DirectoryProfileReportDocument[];
	documentsStatus: DirectoryDocumentsStatus;
	orgSlug: string;
	profiles: readonly AuthProfileView[];
	subjectUserId: string;
}): DirectoryHumanProfileRow[] {
	const reportsBySubject = indexProfileReportDocuments(input.documents);
	const document = reportsBySubject.get(input.subjectUserId);
	const reportAction = resolveProfileReportAction({
		canCreate: input.canCreateProfiles,
		document,
		documentsStatus: input.documentsStatus,
		orgSlug: input.orgSlug,
		subjectUserId: input.subjectUserId,
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
				details: null,
				email: input.account.email?.trim() || "Current member",
				footerDetail: resolveMissingPersonalHumanProfileMessage(
					input.canCreateHumanProfile
				),
				hasDraft,
				id: `member:${input.subjectUserId || input.orgSlug}`,
				isDefault: false,
				isCurrentUser: true,
				name:
					input.account.name?.trim() ||
					input.account.email?.trim() ||
					"Current member",
				reportAction,
				profileHandle: null,
				profileStatus: null,
				role: "owner",
				userId: input.subjectUserId,
				openMeldServiceState: null,
			},
		];
	}
	return [
		{
			avatarImageUrl: profile.avatarUrl ?? null,
			canEdit: profile.isDefault && profile.status === "active",
			details:
				profile.status === "active"
					? buildProfileDetailsSnapshotFromHumanProfile({
							profileHandle: profile.profileHandle,
							profileId: profile.openMeldProfileId,
							profileName: profile.profileName,
							profileStatus: profile.status,
							viewerScope: "owner_self",
						})
					: null,
			email: input.account.email?.trim() || "Current member",
			footerDetail: resolvePersonalHumanProfileFooterDetail(profile),
			hasDraft,
			id: profile.openMeldProfileId,
			isDefault: profile.isDefault,
			isCurrentUser: true,
			name: profile.profileName,
			reportAction,
			profileHandle: profile.profileHandle,
			profileStatus: profile.status,
			role: "owner",
			userId: input.subjectUserId,
			openMeldServiceState: null,
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

function resolveOrganizationHumanProfileLastActiveLabel(
	lastUsedAt: string | null
): string {
	const formatted = formatProfileDateTime(lastUsedAt);
	return formatted ? `Last active ${formatted}` : "No recent activity";
}

function resolveProfileReportAction(input: {
	canCreate: boolean;
	document: DirectoryProfileReportDocument | undefined;
	documentsStatus: DirectoryDocumentsStatus;
	orgSlug: string;
	subjectUserId: string;
}): DirectoryProfileReportAction {
	if (input.documentsStatus === "loading") {
		return { kind: "unavailable", reason: "Report access is loading." };
	}
	if (input.documentsStatus === "failed") {
		return {
			kind: "unavailable",
			reason: "Report unavailable because Documents could not be loaded.",
		};
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
	if (input.canCreate) {
		return {
			kind: "link",
			path: buildOrganizationNewDocumentPath({
				kind: "member_profile",
				orgSlug: input.orgSlug,
				subjectUserId: input.subjectUserId,
			}),
		};
	}
	return {
		kind: "unavailable",
		reason: "Only organization owners and admins can create this report.",
	};
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
	const updatedAtComparison = left.updatedAt.localeCompare(right.updatedAt);
	return updatedAtComparison === 0
		? left.id.localeCompare(right.id)
		: updatedAtComparison;
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

function resolvePersonalHumanProfileFooterDetail(
	profile: AuthProfileView
): string {
	const primary = profile.isDefault
		? "Default Human Profile for this account"
		: "Human teammate identity for Spaces";
	const lastUsed = formatProfileDate(profile.lastUsedAt);
	if (lastUsed) {
		return `${primary} / Last used ${lastUsed}`;
	}
	const created = formatProfileDate(profile.createdAt);
	return created ? `${primary} / Created ${created}` : primary;
}
