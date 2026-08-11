import type { SpaceMessageAttachment } from "@openmeld/schemas/types";

export type SpaceComposerAttachment = {
	descriptor: SpaceMessageAttachment | null;
	errorMessage: string | null;
	errorRequestId: string | null;
	fileName: string;
	localId: string;
	previewUrl: string;
	progress: number;
	status: "processing" | "uploading" | "ready" | "failed";
};

export function isSpaceComposerAttachmentInProgress(
	attachment: SpaceComposerAttachment
): boolean {
	return (
		attachment.status === "processing" || attachment.status === "uploading"
	);
}
