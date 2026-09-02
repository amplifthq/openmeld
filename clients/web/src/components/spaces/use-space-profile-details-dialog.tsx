import { buildProfileDetailsSnapshotFromSpaceMember } from "@openmeld/agent-profile";
import type {
	ModelCatalog,
	ProfileDetailsViewerScope,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import type { ReactElement } from "react";
import { useCallback, useMemo, useState } from "react";
import {
	AgentProfileDetailsPopover,
	ProfileDetailsDialog,
} from "#/components/profiles/profile-details-dialog";
import { buildAgentProfilePath } from "#/lib/profile-routes";
import { resolveWebAgentControllerPermissionModeDisplay } from "#/lib/profiles/agent-controller-permission-mode-display";
import { resolveAgentProfileControllerModelDetail } from "#/lib/profiles/agent-profile-model-display";
import { isSameOwnerUserId } from "./space-member-ownership";

export function useSpaceProfileDetailsDialog(input: {
	currentOwnerUserId: string | null;
	entry: SpaceMemberDirectoryEntry | null;
	entriesByProfileId?: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	modelCatalog: ModelCatalog | null;
	orgSlug?: string;
}) {
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
							moreDetailsHref={
								input.orgSlug
									? buildAgentProfilePath({
											orgSlug: input.orgSlug,
											profileId: entry.profileId,
										})
									: undefined
							}
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
					moreDetailsHref={
						input.orgSlug
							? buildAgentProfilePath({
									orgSlug: input.orgSlug,
									profileId: targetEntry.profileId,
								})
							: undefined
					}
					trigger={trigger}
				/>
			);
		},
		profileDetailsDialog: details ? (
			<ProfileDetailsDialog
				agentEntry={entry ?? undefined}
				details={details}
				moreDetailsHref={
					entry?.profileKind === "agent" && input.orgSlug
						? buildAgentProfilePath({
								orgSlug: input.orgSlug,
								profileId: entry.profileId,
							})
						: undefined
				}
				onOpenChange={setIsOpen}
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
