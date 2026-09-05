import {
	buildProfileDetailsSnapshotFromSpaceMember,
	type ProfileDetailsSpaceMemberInput,
} from "@openmeld/agent-profile";
import type {
	ModelCatalog,
	ProfileDetailsViewerScope,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import type { ReactElement } from "react";
import {
	AgentProfileDetailsPopover,
	HumanProfileDetailsPopover,
	ProfileDetailsPopover,
} from "#/components/profiles/profile-details-dialog";
import { buildOrganizationCenterAgentChatPath } from "#/lib/organizations/organization-routes";
import {
	buildAgentProfilePath,
	buildHumanProfilePath,
} from "#/lib/profile-routes";
import { resolveWebAgentControllerPermissionModeDisplay } from "#/lib/profiles/agent-controller-permission-mode-display";
import { resolveAgentProfileControllerModelDetail } from "#/lib/profiles/agent-profile-model-display";
import { useOptionalSpaceAgentProfileEditContext } from "./space-agent-profile-edit-context";
import { isSameOwnerUserId } from "./space-member-ownership";

export function useSpaceProfileDetailsPopover(input: {
	centerAgentProfileId?: string | null;
	currentOwnerUserId: string | null;
	entry: SpaceMemberDirectoryEntry | null;
	entriesByProfileId?: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	fallbackEntry?: ProfileDetailsSpaceMemberInput | null;
	modelCatalog: ModelCatalog | null;
	orgSlug?: string;
}) {
	const profileContext = useOptionalSpaceAgentProfileEditContext();
	const buildOpenDirectMessageAction = (profileId: string) => {
		const openDirectMessage = profileContext?.onOpenDirectMessage;
		return openDirectMessage ? () => openDirectMessage(profileId) : undefined;
	};
	const renderProfilePopover = (
		entry: SpaceMemberDirectoryEntry,
		trigger: ReactElement
	) => {
		const details = buildSpaceProfileDetails({
			currentOwnerUserId: input.currentOwnerUserId,
			entry,
			modelCatalog: input.modelCatalog,
		});
		const isCenterAgent = entry.profileId === input.centerAgentProfileId;
		const isOwner = details.viewerScope === "owner_self";
		if (entry.profileKind === "human") {
			return (
				<HumanProfileDetailsPopover
					currentOwnerUserId={input.currentOwnerUserId}
					entry={entry}
					isDirectMessagePending={
						profileContext?.pendingDirectMessageProfileId === entry.profileId
					}
					isSelf={isOwner}
					modelCatalog={input.modelCatalog}
					onOpenDirectMessage={
						isOwner ? undefined : buildOpenDirectMessageAction(entry.profileId)
					}
					organizationId={profileContext?.organizationId ?? null}
					orgSlug={input.orgSlug}
					profileHref={
						input.orgSlug
							? buildHumanProfilePath({
									orgSlug: input.orgSlug,
									profileId: entry.profileId,
								})
							: undefined
					}
					trigger={trigger}
				/>
			);
		}
		return (
			<AgentProfileDetailsPopover
				chatHref={
					isCenterAgent && input.orgSlug
						? buildOrganizationCenterAgentChatPath(input.orgSlug)
						: undefined
				}
				details={details}
				entry={entry}
				isCenterAgent={isCenterAgent}
				isDirectMessagePending={
					profileContext?.pendingDirectMessageProfileId === entry.profileId
				}
				moreDetailsHref={
					!isCenterAgent && input.orgSlug
						? buildAgentProfilePath({
								orgSlug: input.orgSlug,
								profileId: entry.profileId,
							})
						: undefined
				}
				onOpenDirectMessage={
					isCenterAgent
						? undefined
						: buildOpenDirectMessageAction(entry.profileId)
				}
				trigger={trigger}
			/>
		);
	};

	const renderFallbackProfilePopover = (
		entry: ProfileDetailsSpaceMemberInput,
		trigger: ReactElement
	) => (
		<ProfileDetailsPopover
			details={buildProfileDetailsSnapshotFromSpaceMember({
				agentControllerPermissionModeDetail: null,
				entry,
				modelDetail: null,
				viewerScope: resolveViewerScope({
					currentOwnerUserId: input.currentOwnerUserId,
					ownerUserId: entry.ownerUserId,
				}),
			})}
			trigger={trigger}
		/>
	);
	const currentEntry = input.entry;
	const fallbackEntry = input.fallbackEntry;
	const selectedEntry = currentEntry ?? fallbackEntry ?? null;
	let profileDetailsPopoverTrigger:
		| ((trigger: ReactElement) => ReactElement)
		| null = null;
	if (currentEntry) {
		profileDetailsPopoverTrigger = (trigger) =>
			renderProfilePopover(currentEntry, trigger);
	} else if (fallbackEntry) {
		profileDetailsPopoverTrigger = (trigger) =>
			renderFallbackProfilePopover(fallbackEntry, trigger);
	}
	return {
		canOpenProfileDetails: selectedEntry !== null,
		profileDetailsPopoverTrigger,
		profileDetailsPopoverTriggerById: (
			profileId: string,
			trigger: ReactElement
		) => {
			const entry =
				input.entriesByProfileId?.get(profileId) ??
				(input.entry?.profileId === profileId ? input.entry : null);
			if (entry) {
				return renderProfilePopover(entry, trigger);
			}
			return fallbackEntry?.profileId === profileId
				? renderFallbackProfilePopover(fallbackEntry, trigger)
				: trigger;
		},
	};
}

function buildSpaceProfileDetails(input: {
	currentOwnerUserId: string | null;
	entry: SpaceMemberDirectoryEntry;
	modelCatalog: ModelCatalog | null;
}) {
	const viewerScope = resolveViewerScope({
		currentOwnerUserId: input.currentOwnerUserId,
		ownerUserId: input.entry.ownerUserId,
	});
	const modelDetail =
		input.entry.profileKind === "agent"
			? resolveAgentProfileControllerModelDetail({
					agentControllerRef: input.entry.agentControllerRef,
					controllerDisplayName: input.entry.controllerDisplayName,
					modelCatalog: input.modelCatalog,
					modelSelection: input.entry.modelSelection,
				})
			: null;
	const controllerPermissionModeDetail =
		input.entry.profileKind === "agent"
			? (resolveWebAgentControllerPermissionModeDisplay({
					agentControllerPermissionMode:
						input.entry.agentControllerPermissionMode,
					agentControllerRef: input.entry.agentControllerRef,
				})?.label ?? null)
			: null;
	return buildProfileDetailsSnapshotFromSpaceMember({
		agentControllerPermissionModeDetail: controllerPermissionModeDetail,
		entry: input.entry,
		modelDetail,
		viewerScope,
	});
}

function resolveViewerScope(input: {
	currentOwnerUserId: string | null;
	ownerUserId: string | null;
}): ProfileDetailsViewerScope {
	return isSameOwnerUserId(input) ? "owner_self" : "observer";
}
