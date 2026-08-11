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
	modelCatalog: ModelCatalog | null;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const viewerScope = useMemo<ProfileDetailsViewerScope>(() => {
		return input.entry &&
			isSameOwnerUserId({
				currentOwnerUserId: input.currentOwnerUserId,
				ownerUserId: input.entry.ownerUserId,
			})
			? "owner_self"
			: "observer";
	}, [input.currentOwnerUserId, input.entry]);
	const modelDetail = useMemo(() => {
		if (input.entry?.profileKind !== "agent") {
			return null;
		}

		return resolveAgentProfileControllerModelDetail({
			agentControllerRef: input.entry.agentControllerRef,
			controllerDisplayName: input.entry.controllerDisplayName,
			modelCatalog: input.modelCatalog,
			modelSelection: input.entry.modelSelection,
		});
	}, [input.entry, input.modelCatalog]);
	const controllerPermissionModeDetail = useMemo(() => {
		if (input.entry?.profileKind !== "agent") {
			return null;
		}

		return (
			resolveWebAgentControllerPermissionModeDisplay({
				agentControllerPermissionMode:
					input.entry.agentControllerPermissionMode,
				agentControllerRef: input.entry.agentControllerRef,
			})?.label ?? null
		);
	}, [input.entry]);
	const details = useMemo(() => {
		if (!input.entry) {
			return null;
		}

		return buildProfileDetailsSnapshotFromSpaceMember({
			agentControllerPermissionModeDetail: controllerPermissionModeDetail,
			entry: input.entry,
			modelDetail,
			viewerScope,
		});
	}, [controllerPermissionModeDetail, input.entry, modelDetail, viewerScope]);
	const openProfileDetails = useCallback(() => {
		if (details) {
			setIsOpen(true);
		}
	}, [details]);

	return {
		canOpenProfileDetails: details !== null,
		openProfileDetails,
		profileDetailsDialog: details ? (
			<ProfileDetailsDialog
				details={details}
				onOpenChange={setIsOpen}
				open={isOpen}
			/>
		) : null,
	};
}
