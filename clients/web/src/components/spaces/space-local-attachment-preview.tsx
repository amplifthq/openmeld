import { SpaceAttachmentFileCard } from "./space-attachment-file-card";
import { SpaceImagePreview } from "./space-image-preview";
import { SpaceVideoPreview } from "./space-video-preview";

/** A draft or pre-Space message uses its existing local source, never a download. */
export function SpaceLocalAttachmentPreview(input: {
	fileName: string;
	mimeType: string;
	previewUrl: string | null;
	sizeBytes?: number;
	editable?: boolean;
}) {
	if (input.mimeType.startsWith("image/")) {
		return (
			<SpaceImagePreview
				altText={input.fileName}
				attachmentThumbnail
				imageSource={input.previewUrl}
				isSingle={false}
			/>
		);
	}
	if (input.mimeType.startsWith("video/")) {
		return (
			<SpaceVideoPreview
				compact
				fileName={input.fileName}
				isLocal
				localPreviewUrl={input.previewUrl}
			/>
		);
	}
	return (
		<SpaceAttachmentFileCard
			className={input.editable ? "pr-8" : undefined}
			fileName={input.fileName}
			mimeType={input.mimeType}
			sizeBytes={input.sizeBytes}
		/>
	);
}
