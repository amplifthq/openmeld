import type {
	SpaceComposerUploadDescriptor,
	SpaceFileImageDimensions,
} from "@openmeld/schemas/types";

export type ComposerFileFailurePhase =
	| "validation"
	| "persist-draft"
	| "stage"
	| "persist-upload"
	| "publish";

export type SpaceComposerFile = {
	errorMessage: string | null;
	errorRequestId: string | null;
	failurePhase: ComposerFileFailurePhase | null;
	fileName: string;
	localId: string;
	mimeType: string;
	previewUrl: string | null;
	imageDimensions?: SpaceFileImageDimensions;
	progress: number;
	publishMutationId: string;
	publicationAttempted?: boolean;
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
