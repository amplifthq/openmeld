import type { SpaceApi } from "@openmeld/api-client";
import { QueryClientContext } from "@tanstack/react-query";
import { useContext, useMemo } from "react";
import { toast } from "sonner";
import { getDesktopPlatform } from "#/desktop/platform";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { buildWebSpaceAttachmentDownloadPath } from "#/lib/spaces/web-space-attachment-path";
import { resolveSpaceFileMediaPresentationKey } from "#/query/spaces/space-files";
import { SpaceAttachmentRemoveButton } from "./space-attachment-actions";
import { SpaceAttachmentFileCard } from "./space-attachment-file-card";
import { SpaceAttachmentStrip } from "./space-attachment-strip";
import { downloadUrlContent } from "./space-file-utils";
import { SpaceImagePreview } from "./space-image-preview";
import { useSpaceMessageEditing } from "./space-message-editing";
import { SpaceVideoPreview } from "./space-video-preview";
import { useImageFrameActivity } from "./use-image-frame-activity";
import { useSpaceFileImageSource } from "./use-space-file-image-source";

type MessageAttachments = Pick<SpaceTimelineItem, "attachments" | "files">;
type AttachmentContext = {
	spaceId: string;
	organizationSlug?: string;
	openMeldProfileId?: string;
	onOpenSpaceFile?: (fileId: string, revision: number) => void;
};

export function hasSpaceMessageAttachments(item: Partial<MessageAttachments>) {
	return Boolean(item.attachments?.length || item.files?.length);
}

export function SpaceMessageAttachments(
	input: AttachmentContext & {
		item: Partial<
			MessageAttachments & Pick<SpaceTimelineItem, "id" | "recalledAt">
		>;
		align?: "start" | "end";
	}
) {
	const editing = useSpaceMessageEditing();
	if (
		!hasSpaceMessageAttachments(input.item) ||
		input.item.recalledAt ||
		(input.item.id && editing?.edit?.id === input.item.id)
	) {
		return null;
	}
	return (
		<SpaceAttachmentStrip align={input.align} label="Message attachments">
			<SpaceMessageAttachmentItems {...input} />
		</SpaceAttachmentStrip>
	);
}

/** Both wire collections remain intact; canonical files keep their authored order. */
export function SpaceMessageAttachmentItems(
	input: AttachmentContext & {
		item: Partial<MessageAttachments>;
		disabled?: boolean;
		onRemoveAttachment?: (id: string) => void;
		onRemoveFile?: (id: string) => void;
	}
) {
	const client = useContext(QueryClientContext);
	const api = useMemo(
		() => ({
			downloadFileContent: (
				...args: Parameters<SpaceApi["downloadFileContent"]>
			) => {
				const options = { openMeldProfileId: input.openMeldProfileId };
				const owner = input.organizationSlug
					? createOrganizationScopedWebSpaceApi({
							...options,
							organizationSlug: input.organizationSlug,
						})
					: createUnscopedWebSpaceApi(options);
				return owner.downloadFileContent(...args);
			},
		}),
		[input.openMeldProfileId, input.organizationSlug]
	);
	return (
		<>
			{input.item.attachments?.map((attachment) => (
				<div className="relative shrink-0" key={`attachment:${attachment.id}`}>
					<SpaceMessageAttachmentImage
						attachment={attachment}
						organizationSlug={input.organizationSlug}
						spaceId={input.spaceId}
					/>
					{input.onRemoveAttachment && (
						<SpaceAttachmentRemoveButton
							disabled={input.disabled === true}
							fileName={attachment.fileName ?? "image"}
							onRemove={() => input.onRemoveAttachment?.(attachment.id)}
						/>
					)}
				</div>
			))}
			{input.item.files?.map((file) => (
				<div
					className="relative shrink-0"
					data-attachment-name={file.name}
					key={resolveSpaceFileMediaPresentationKey(
						client,
						input.spaceId,
						file
					)}
				>
					<SpaceMessageFilePreview {...input} api={api} file={file} />
					{input.onRemoveFile && (
						<SpaceAttachmentRemoveButton
							disabled={input.disabled === true}
							fileName={file.name}
							onRemove={() => input.onRemoveFile?.(file.fileId)}
						/>
					)}
				</div>
			))}
		</>
	);
}

function SpaceMessageFilePreview(
	input: AttachmentContext & {
		api: Pick<SpaceApi, "downloadFileContent">;
		file: NonNullable<SpaceTimelineItem["files"]>[number];
	}
) {
	const { file } = input;
	const onOpen =
		!file.isLocal && input.onOpenSpaceFile
			? () => input.onOpenSpaceFile?.(file.fileId, file.revision)
			: undefined;
	if (file.mimeType.startsWith("image/")) {
		return (
			<SpaceMessageFileImage
				api={input.api}
				file={file}
				onOpen={onOpen}
				spaceId={input.spaceId}
			/>
		);
	}
	if (file.mimeType.startsWith("video/")) {
		return (
			<SpaceVideoPreview
				compact
				fileName={file.name}
				isLocal={file.isLocal}
				localPreviewUrl={file.localPreviewUrl}
				onOpenFile={onOpen}
				target={{
					spaceId: input.spaceId,
					fileId: file.fileId,
					revision: file.revision,
					organizationSlug: input.organizationSlug,
				}}
			/>
		);
	}
	return (
		<SpaceAttachmentFileCard
			fileName={file.name}
			mimeType={file.mimeType}
			onOpen={onOpen}
			revision={file.isLocal ? undefined : file.revision}
			sizeBytes={file.sizeBytes}
		/>
	);
}

function SpaceMessageFileImage(input: {
	api: Pick<SpaceApi, "downloadFileContent">;
	file: NonNullable<SpaceTimelineItem["files"]>[number];
	onOpen?: () => void;
	spaceId: string;
}) {
	const activity = useImageFrameActivity();
	const source = useSpaceFileImageSource({
		api: input.api,
		enabled: activity.active,
		fileId: input.file.fileId,
		isLocal: input.file.isLocal,
		localPreviewUrl: input.file.localPreviewUrl,
		mimeType: input.file.mimeType,
		revision: input.file.revision,
		spaceId: input.spaceId,
	});
	return (
		<SpaceImagePreview
			active={activity.active}
			altText={input.file.name}
			attachmentThumbnail
			error={!source.sourceUrl && Boolean(source.error)}
			focusedAction={
				input.onOpen
					? { label: "Open in Files", onSelect: input.onOpen }
					: undefined
			}
			frameRef={activity.frame}
			height={input.file.imageDimensions?.height}
			imageSource={source.sourceUrl}
			isSingle={false}
			onRetry={source.retry}
			width={input.file.imageDimensions?.width}
		/>
	);
}

function SpaceMessageAttachmentImage(input: {
	attachment: SpaceTimelineItem["attachments"][number];
	organizationSlug?: string;
	spaceId: string;
}) {
	const activity = useImageFrameActivity();
	const downloadPath = buildWebSpaceAttachmentDownloadPath({
		attachmentId: input.attachment.id,
		organizationSlug: input.organizationSlug,
		spaceId: input.spaceId,
	});
	const altText = input.attachment.fileName ?? "Attached image";
	return (
		<SpaceImagePreview
			active={activity.active}
			altText={altText}
			attachmentThumbnail
			cold={!input.attachment.localPreviewUrl}
			focusedAction={
				getDesktopPlatform()
					? {
							label: "Download original",
							onSelect: () => {
								downloadUrlContent(altText, downloadPath).catch(
									(error: unknown) =>
										toast.error(
											error instanceof Error
												? error.message
												: "Could not download this image. Try again."
										)
								);
							},
						}
					: { href: downloadPath, label: "Open original" }
			}
			frameRef={activity.frame}
			height={input.attachment.height}
			imageSource={input.attachment.localPreviewUrl ?? downloadPath}
			isSingle={false}
			width={input.attachment.width}
		/>
	);
}
