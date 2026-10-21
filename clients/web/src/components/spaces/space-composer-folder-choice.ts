import type {
	ExecutionContextSelection,
	GetAgentProfileFoldersResponse,
} from "@openmeld/schemas/types";

export type ComposerFolderOption = {
	displayName: string;
	folderId: string;
	isDefault: boolean;
};

/** Folders the owner can choose; empty when the list is unavailable. */
export function composerFolderOptions(
	response: GetAgentProfileFoldersResponse | undefined
): ComposerFolderOption[] {
	if (!response || response.status === "unavailable") {
		return [];
	}
	return response.projection.folders.map((folder) => ({
		displayName: folder.displayName,
		folderId: folder.folderId,
		isDefault: folder.isDefault,
	}));
}

export function selectedComposerFolderId(
	selection: ExecutionContextSelection | undefined
): string | undefined {
	return selection && selection.mode !== "resume"
		? selection.folderId
		: undefined;
}

/**
 * A chosen folder is always explicit, so a fork never silently inherits the
 * source folder. "Continue in another folder" forks the chosen Session.
 */
export function chooseComposerFolder(input: {
	folder: ComposerFolderOption;
	selection: ExecutionContextSelection | undefined;
}): { label: string; selection: ExecutionContextSelection } {
	const { folder, selection } = input;
	if (selection?.mode === "fork" || selection?.mode === "resume") {
		return {
			label:
				selection.mode === "fork"
					? `Fork in ${folder.displayName}`
					: `Continue in ${folder.displayName}`,
			selection: {
				...(selection.mode === "fork" ? selection : {}),
				folderId: folder.folderId,
				mode: "fork",
				sourceWakeId: selection.sourceWakeId,
			},
		};
	}
	return {
		label: `Start new in ${folder.displayName}`,
		selection: {
			mode: "new",
			...(selection?.access && selection.access !== "space_context"
				? { access: selection.access }
				: {}),
			...(selection?.workspace ? { workspace: selection.workspace } : {}),
			folderId: folder.folderId,
		},
	};
}
