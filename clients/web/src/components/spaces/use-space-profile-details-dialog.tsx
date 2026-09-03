import { buildProfileDetailsSnapshotFromSpaceMember } from "@openmeld/agent-profile";
import type {
	ModelCatalog,
	ProfileDetailsViewerScope,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";
import { AgentProfileInlineConfigurationController } from "#/components/agents/agent-profile-edit-dialog-controller";
import {
	AgentProfileDetailsPopover,
	ProfileDetailsDialog,
} from "#/components/profiles/profile-details-dialog";
import { buildAgentProfilePath } from "#/lib/profile-routes";
import { resolveWebAgentControllerPermissionModeDisplay } from "#/lib/profiles/agent-controller-permission-mode-display";
import { resolveAgentProfileControllerModelDetail } from "#/lib/profiles/agent-profile-model-display";
import { useOptionalSpaceAgentProfileEditContext } from "./space-agent-profile-edit-context";
import { resolveAgentProfileOwnerEntry } from "./space-collaboration-profile";
import { isSameOwnerUserId } from "./space-member-ownership";

const EMPTY_SPACE_MEMBER_ENTRIES_BY_PROFILE_ID: ReadonlyMap<
	string,
	SpaceMemberDirectoryEntry
> = new Map();

export function useSpaceProfileDetailsDialog(input: {
	centerAgentProfileId?: string | null;
	currentOwnerUserId: string | null;
	entry: SpaceMemberDirectoryEntry | null;
	entriesByProfileId?: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	modelCatalog: ModelCatalog | null;
	orgSlug?: string;
}) {
	const agentProfileEditContext = useOptionalSpaceAgentProfileEditContext();
	const [isOpen, setIsOpen] = useState(false);
	const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
		null
	);
	const entry = selectedProfileId
		? (input.entriesByProfileId?.get(selectedProfileId) ??
			(input.entry?.profileId === selectedProfileId ? input.entry : null))
		: input.entry;
	const details = useMemo(() => {
		if (!entry) {
			return null;
		}
		return buildSpaceProfileDetails({
			currentOwnerUserId: input.currentOwnerUserId,
			entry,
			modelCatalog: input.modelCatalog,
		});
	}, [entry, input.currentOwnerUserId, input.modelCatalog]);
	const openProfileDetails = useCallback(() => {
		if (!input.entry) {
			return;
		}
		setSelectedProfileId(input.entry.profileId);
		setIsOpen(true);
	}, [input.entry]);
	const openProfileDetailsById = useCallback(
		(profileId: string) => {
			const targetEntry =
				input.entriesByProfileId?.get(profileId) ??
				(input.entry?.profileId === profileId ? input.entry : null);
			if (!targetEntry) {
				return;
			}
			setSelectedProfileId(targetEntry.profileId);
			setIsOpen(true);
		},
		[input.entriesByProfileId, input.entry]
	);
	const renderAgentConfiguration = useCallback(
		(
			targetEntry: SpaceMemberDirectoryEntry,
			targetDetails: ReturnType<typeof buildSpaceProfileDetails>
		) => {
			const profile = agentProfileEditContext?.profilesById.get(
				targetEntry.profileId
			);
			if (!(profile && agentProfileEditContext?.context)) {
				return undefined;
			}
			return (
				<AgentProfileInlineConfigurationController
					context={agentProfileEditContext.context}
					details={targetDetails}
					entry={targetEntry}
					modelCatalog={agentProfileEditContext.modelCatalog}
					ownerEntry={resolveAgentProfileOwnerEntry({
						agentEntry: targetEntry,
						entriesByProfileId:
							input.entriesByProfileId ??
							EMPTY_SPACE_MEMBER_ENTRIES_BY_PROFILE_ID,
					})}
					profile={profile}
				/>
			);
		},
		[agentProfileEditContext, input.entriesByProfileId]
	);
	const buildOpenDirectMessageAction = useCallback(
		(profileId: string) => {
			const openDirectMessage = agentProfileEditContext?.onOpenDirectMessage;
			return openDirectMessage ? () => openDirectMessage(profileId) : undefined;
		},
		[agentProfileEditContext]
	);

	return {
		canOpenProfileDetails: input.entry !== null,
		openProfileDetails,
		openProfileDetailsById,
		profileDetailsPopoverTrigger:
			entry?.profileKind === "agent" && details
				? (trigger: ReactElement) => (
						<AgentProfileDetailsPopover
							details={details}
							entry={entry}
							isCenterAgent={entry.profileId === input.centerAgentProfileId}
							isDirectMessagePending={
								agentProfileEditContext?.pendingDirectMessageProfileId ===
								entry.profileId
							}
							moreDetailsHref={
								input.orgSlug
									? buildAgentProfilePath({
											orgSlug: input.orgSlug,
											profileId: entry.profileId,
										})
									: undefined
							}
							onOpenDirectMessage={buildOpenDirectMessageAction(
								entry.profileId
							)}
							trigger={trigger}
						/>
					)
				: null,
		profileDetailsPopoverTriggerById: (
			profileId: string,
			trigger: ReactElement
		) => {
			const targetEntry =
				input.entriesByProfileId?.get(profileId) ??
				(input.entry?.profileId === profileId ? input.entry : null);
			if (targetEntry?.profileKind !== "agent") {
				return trigger;
			}
			const targetDetails = buildSpaceProfileDetails({
				currentOwnerUserId: input.currentOwnerUserId,
				entry: targetEntry,
				modelCatalog: input.modelCatalog,
			});
			return (
				<AgentProfileDetailsPopover
					details={targetDetails}
					entry={targetEntry}
					isCenterAgent={targetEntry.profileId === input.centerAgentProfileId}
					isDirectMessagePending={
						agentProfileEditContext?.pendingDirectMessageProfileId ===
						targetEntry.profileId
					}
					moreDetailsHref={
						input.orgSlug
							? buildAgentProfilePath({
									orgSlug: input.orgSlug,
									profileId: targetEntry.profileId,
								})
							: undefined
					}
					onOpenDirectMessage={buildOpenDirectMessageAction(
						targetEntry.profileId
					)}
					trigger={trigger}
				/>
			);
		},
		profileDetailsDialog: details ? (
			<ProfileDetailsDialog
				agentConfigurationContent={
					entry?.profileKind === "agent"
						? renderAgentConfiguration(entry, details)
						: undefined
				}
				agentEntry={entry ?? undefined}
				details={details}
				isCenterAgent={entry?.profileId === input.centerAgentProfileId}
				isDirectMessagePending={
					agentProfileEditContext?.pendingDirectMessageProfileId ===
					entry?.profileId
				}
				moreDetailsHref={
					entry?.profileKind === "agent" && input.orgSlug
						? buildAgentProfilePath({
								orgSlug: input.orgSlug,
								profileId: entry.profileId,
							})
						: undefined
				}
				onOpenChange={setIsOpen}
				onOpenDirectMessage={
					entry?.profileKind === "agent"
						? buildOpenDirectMessageAction(entry.profileId)
						: undefined
				}
				open={isOpen}
			/>
		) : null,
	};
}

function buildSpaceProfileDetails(input: {
	currentOwnerUserId: string | null;
	entry: SpaceMemberDirectoryEntry;
	modelCatalog: ModelCatalog | null;
}) {
	const viewerScope: ProfileDetailsViewerScope = isSameOwnerUserId({
		currentOwnerUserId: input.currentOwnerUserId,
		ownerUserId: input.entry.ownerUserId,
	})
		? "owner_self"
		: "observer";
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
