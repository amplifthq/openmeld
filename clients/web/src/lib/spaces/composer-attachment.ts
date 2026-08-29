import type { SpaceComposerUploadDescriptor } from "@openmeld/schemas/types";

export type SpaceComposerFile = {
	errorMessage: string | null;
	errorRequestId: string | null;
	fileName: string;
	localId: string;
	mimeType: string;
	previewUrl: string | null;
	progress: number;
	publishMutationId: string;
	status: "uploading" | "ready" | "failed";
	upload: SpaceComposerUploadDescriptor | null;
};

export function isSpaceComposerFileInProgress(
	file: SpaceComposerFile
): boolean {
	return file.status === "uploading";
}

export function isSpaceComposerFileFailed(file: SpaceComposerFile): boolean {
	return file.status === "failed";
}
