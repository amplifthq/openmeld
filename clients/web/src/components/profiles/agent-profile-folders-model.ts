import type {
	GetAgentProfileFoldersResponse,
	ProfileFolderProjection,
	ProfileFolderProjectionEntry,
} from "@openmeld/schemas/types";

export type AgentProfileFolderRow = ProfileFolderProjectionEntry & {
	/** New work starts here: the Default Project's folder, else the default. */
	effectiveDefault: boolean;
	kindLabel: string;
	/** Why this folder can't be removed, when it can't. */
	removeBlockedReason: string | null;
};

const KIND_LABELS: Record<ProfileFolderProjectionEntry["kind"], string> = {
	custom: "Folder on this computer",
	openmeld_managed: "Chosen by OpenMeld",
	project: "Project",
};

/**
 * A set Default Project wins over the default folder for new work, so the
 * list marks that Project's folder as the default instead.
 */
export function buildAgentProfileFolderRows(input: {
	defaultProjectId: string | null | undefined;
	projection: ProfileFolderProjection;
}): AgentProfileFolderRow[] {
	const projectDefault = input.defaultProjectId
		? input.projection.folders.find(
				(folder) => folder.projectId === input.defaultProjectId
			)
		: undefined;
	return input.projection.folders.map((folder) => {
		const effectiveDefault = input.defaultProjectId
			? folder.folderId === projectDefault?.folderId
			: folder.isDefault;
		let removeBlockedReason: string | null = null;
		if (folder.isDefault) {
			removeBlockedReason =
				"This is the default folder. Make another folder the default first.";
		} else if (effectiveDefault) {
			removeBlockedReason =
				"New work starts in this Project. Make another folder the default first.";
		}
		return {
			...folder,
			effectiveDefault,
			kindLabel: KIND_LABELS[folder.kind],
			removeBlockedReason,
		};
	});
}

export function folderListNotice(
	response: GetAgentProfileFoldersResponse | undefined
): string | null {
	if (response?.status === "recorded") {
		return "The Agent’s computer didn’t answer. This is the last folder list it reported; changes need the computer online.";
	}
	if (response?.status === "unavailable") {
		return `Couldn’t read this Agent’s folders. ${response.message}`;
	}
	return null;
}
