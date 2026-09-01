import { buildProfileDetailsSnapshotFromSpaceMember } from "@openmeld/agent-profile";
import type {
	ModelCatalog,
	ProfileDetailsViewerScope,
} from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { useCallback, useMemo, useState } from "react";
import { ProfileDetailsDialog } from "#/components/profiles/profile-details-dialog";
import { resolveWebAgentControllerPermissionModeDisplay } from "#/lib/profiles/agent-controller-permission-mode-display";
import { resolveAgentProfileControllerModelDetail } from "#/lib/profiles/agent-profile-model-display";
import { isSameOwnerUserId } from "./space-member-ownership";

export function useSpaceProfileDetailsDialog(input: {
	currentOwnerUserId: string | null;
	entry: SpaceMemberDirectoryEntry | null;
	entriesByProfileId?: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	modelCatalog: ModelCatalog | null;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [selectedProfileId, setSelectedProfileId] = useState<string | null>(
		null
	);
	const entry = selectedProfileId
		? (input.entriesByProfileId?.get(selectedProfileId) ??
			(input.entry?.profileId === selectedProfileId ? input.entry : null))
		: input.entry;
	const viewerScope = useMemo<ProfileDetailsViewerScope>(() => {
		return entry &&
			isSameOwnerUserId({
				currentOwnerUserId: input.currentOwnerUserId,
				ownerUserId: entry.ownerUserId,
			})
			? "owner_self"
			: "observer";
	}, [entry, input.currentOwnerUserId]);
	const modelDetail = useMemo(() => {
		if (entry?.profileKind !== "agent") {
			return null;
		}

		return resolveAgentProfileControllerModelDetail({
			agentControllerRef: entry.agentControllerRef,
			controllerDisplayName: entry.controllerDisplayName,
			modelCatalog: input.modelCatalog,
			modelSelection: entry.modelSelection,
		});
	}, [entry, input.modelCatalog]);
	const controllerPermissionModeDetail = useMemo(() => {
		if (entry?.profileKind !== "agent") {
			return null;
		}

		return (
			resolveWebAgentControllerPermissionModeDisplay({
				agentControllerPermissionMode: entry.agentControllerPermissionMode,
				agentControllerRef: entry.agentControllerRef,
			})?.label ?? null
		);
	}, [entry]);
	const details = useMemo(() => {
		if (!entry) {
			return null;
		}

		return buildProfileDetailsSnapshotFromSpaceMember({
			agentControllerPermissionModeDetail: controllerPermissionModeDetail,
			entry,
			modelDetail,
			viewerScope,
		});
	}, [controllerPermissionModeDetail, entry, modelDetail, viewerScope]);
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
		profileDetailsDialog: details ? (
			<ProfileDetailsDialog
				details={details}
				onOpenChange={setIsOpen}
				open={isOpen}
			/>
		) : null,
	};
}
