import { toStructuredApiClientFailure } from "@openmeld/api-client";
import { SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE } from "@openmeld/schemas";
import type {
	SpaceAttachmentDescriptor,
	SpaceMessageAttachment,
} from "@openmeld/schemas/types";
import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createOrganizationScopedWebSpaceApi } from "#/lib/spaces/api";
import type { SpaceComposerAttachment } from "#/lib/spaces/composer-attachment";
import { resolveSpaceImageUploadFailure } from "#/lib/spaces/errors";
import { prepareSpaceImageAttachment } from "#/lib/spaces/image-attachment";

export function useSpaceComposerAttachments(input: {
	organizationSlug: string;
	profileId: string;
	spaceId: string;
}) {
	const [attachments, setAttachments] = useState<SpaceComposerAttachment[]>([]);
	const activeAttachmentIdsRef = useRef(new Set<string>());
	const previewUrlsByLocalIdRef = useRef(new Map<string, string>());
	const attachmentScopeKey = `${input.organizationSlug}:${input.profileId}:${input.spaceId}`;
	const previousAttachmentScopeKeyRef = useRef(attachmentScopeKey);

	const clearAttachments = useCallback(() => {
		releasePreviewUrls(previewUrlsByLocalIdRef.current);
		activeAttachmentIdsRef.current.clear();
		setAttachments([]);
	}, []);

	useEffect(() => {
		if (previousAttachmentScopeKeyRef.current !== attachmentScopeKey) {
			releasePreviewUrls(previewUrlsByLocalIdRef.current);
			activeAttachmentIdsRef.current.clear();
			setAttachments([]);
			previousAttachmentScopeKeyRef.current = attachmentScopeKey;
		}
		return () => {
			releasePreviewUrls(previewUrlsByLocalIdRef.current);
			activeAttachmentIdsRef.current.clear();
		};
	}, [attachmentScopeKey]);

	const removeAttachment = useCallback((localId: string) => {
		activeAttachmentIdsRef.current.delete(localId);
		const previewUrl = previewUrlsByLocalIdRef.current.get(localId);
		if (previewUrl) {
			URL.revokeObjectURL(previewUrl);
			previewUrlsByLocalIdRef.current.delete(localId);
		}
		setAttachments((current) =>
			current.filter((attachment) => attachment.localId !== localId)
		);
	}, []);

	const addImages = useCallback(
		async (files: readonly File[]) => {
			const availableSlots = Math.max(
				0,
				SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE -
					activeAttachmentIdsRef.current.size
			);
			const acceptedFiles = files.slice(0, availableSlots);
			if (acceptedFiles.length === 0) {
				return;
			}

			const pending = acceptedFiles.map((file) => {
				const localId = createLocalAttachmentId();
				const previewUrl = URL.createObjectURL(file);
				activeAttachmentIdsRef.current.add(localId);
				previewUrlsByLocalIdRef.current.set(localId, previewUrl);
				return {
					file,
					item: {
						descriptor: null,
						errorMessage: null,
						errorRequestId: null,
						fileName: file.name || "image",
						localId,
						previewUrl,
						progress: 10,
						status: "processing",
					} satisfies SpaceComposerAttachment,
				};
			});
			setAttachments((current) => [
				...current,
				...pending.map(({ item }) => item),
			]);

			await Promise.all(
				pending.map(({ file, item }) =>
					processPendingAttachment({
						activeAttachmentIds: activeAttachmentIdsRef.current,
						file,
						item,
						organizationSlug: input.organizationSlug,
						previewUrlsByLocalId: previewUrlsByLocalIdRef.current,
						profileId: input.profileId,
						setAttachments,
						spaceId: input.spaceId,
					})
				)
			);
		},
		[input.organizationSlug, input.profileId, input.spaceId]
	);

	return {
		addImages,
		attachments,
		clearAttachments,
		isAtLimit: attachments.length >= SPACE_ATTACHMENT_MAX_COUNT_PER_MESSAGE,
		removeAttachment,
	};
}

async function processPendingAttachment(input: {
	activeAttachmentIds: Set<string>;
	file: File;
	item: SpaceComposerAttachment;
	organizationSlug: string;
	previewUrlsByLocalId: Map<string, string>;
	profileId: string;
	setAttachments: Dispatch<SetStateAction<SpaceComposerAttachment[]>>;
	spaceId: string;
}): Promise<void> {
	let uploadStarted = false;
	try {
		updateAttachment(input.setAttachments, input.item.localId, (current) => ({
			...current,
			progress: 35,
		}));
		const prepared = await prepareSpaceImageAttachment(input.file);
		if (!input.activeAttachmentIds.has(input.item.localId)) {
			return;
		}

		const convertedPreviewUrl = URL.createObjectURL(prepared.blob);
		const previousPreviewUrl = input.previewUrlsByLocalId.get(
			input.item.localId
		);
		input.previewUrlsByLocalId.set(input.item.localId, convertedPreviewUrl);
		if (previousPreviewUrl) {
			URL.revokeObjectURL(previousPreviewUrl);
		}
		updateAttachment(input.setAttachments, input.item.localId, (current) => ({
			...current,
			errorMessage: null,
			errorRequestId: null,
			fileName: prepared.fileName,
			previewUrl: convertedPreviewUrl,
			progress: 65,
			status: "uploading",
		}));

		uploadStarted = true;
		const descriptor = await createOrganizationScopedWebSpaceApi({
			organizationSlug: input.organizationSlug,
			openMeldProfileId: input.profileId,
		}).uploadAttachment({
			bytes: prepared.blob,
			fileName: prepared.fileName,
			height: prepared.height,
			mimeType: prepared.mimeType,
			spaceId: input.spaceId,
			width: prepared.width,
		});
		if (!input.activeAttachmentIds.has(input.item.localId)) {
			return;
		}
		updateAttachment(input.setAttachments, input.item.localId, (current) => ({
			...current,
			descriptor: toMessageAttachment(descriptor),
			errorMessage: null,
			errorRequestId: null,
			fileName: descriptor.fileName ?? prepared.fileName,
			progress: 100,
			status: "ready",
		}));
	} catch (error) {
		if (!input.activeAttachmentIds.has(input.item.localId)) {
			return;
		}
		const failure = uploadStarted
			? resolveSpaceImageUploadFailure(toStructuredApiClientFailure(error))
			: {
					message:
						error instanceof Error && error.message !== ""
							? error.message
							: "OpenMeld couldn't prepare this image. Try another image.",
					requestId: null,
				};
		console.error("[openmeld.web.space.image_attachment_failed]", {
			error,
			phase: uploadStarted ? "upload" : "preparation",
			requestId: failure.requestId,
			spaceId: input.spaceId,
		});
		updateAttachment(input.setAttachments, input.item.localId, (current) => ({
			...current,
			descriptor: null,
			errorMessage: failure.message,
			errorRequestId: failure.requestId,
			progress: 100,
			status: "failed",
		}));
	}
}

function releasePreviewUrls(previewUrlsByLocalId: Map<string, string>): void {
	for (const previewUrl of previewUrlsByLocalId.values()) {
		URL.revokeObjectURL(previewUrl);
	}
	previewUrlsByLocalId.clear();
}

function updateAttachment(
	setAttachments: Dispatch<SetStateAction<SpaceComposerAttachment[]>>,
	localId: string,
	update: (attachment: SpaceComposerAttachment) => SpaceComposerAttachment
): void {
	setAttachments((current) =>
		current.map((attachment) =>
			attachment.localId === localId ? update(attachment) : attachment
		)
	);
}

function toMessageAttachment(
	descriptor: SpaceAttachmentDescriptor
): SpaceMessageAttachment {
	return {
		id: descriptor.id,
		mimeType: descriptor.mimeType,
		sizeBytes: descriptor.sizeBytes,
		...(descriptor.width === undefined ? {} : { width: descriptor.width }),
		...(descriptor.height === undefined ? {} : { height: descriptor.height }),
		...(descriptor.fileName === undefined
			? {}
			: { fileName: descriptor.fileName }),
	};
}

function createLocalAttachmentId(): string {
	return `composer-image:${crypto.randomUUID()}`;
}
