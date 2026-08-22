import type { SpaceMessageFileReference } from "@openmeld/schemas/types";

export type SpaceComposerFile = {
	descriptor: SpaceMessageFileReference | null;
	errorMessage: string | null;
	errorRequestId: string | null;
	fileName: string;
	localId: string;
	mimeType: string;
	previewUrl: string | null;
	progress: number;
	status: "uploading" | "ready" | "failed";
};

export function isSpaceComposerFileInProgress(
	file: SpaceComposerFile
): boolean {
	return file.status === "uploading";
}
