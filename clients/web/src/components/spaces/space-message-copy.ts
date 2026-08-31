import { toast } from "sonner";
import {
	createOrganizationScopedWebSpaceApi,
	createUnscopedWebSpaceApi,
} from "#/lib/spaces/api";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { buildWebSpaceAttachmentDownloadPath } from "#/lib/spaces/web-space-attachment-path";

export type SpaceMessageCopyResult =
	| "empty"
	| "file"
	| "image"
	| "text"
	| "unavailable"
	| "unsupported";

type CopyableAttachment = {
	id: string;
	mimeType: string;
};

type CopyableFile = {
	fileId: string;
	mimeType: string;
	revision: number;
};

type LoadedFile = {
	bytes: ArrayBuffer | Blob | Uint8Array;
	mimeType: string;
};

type PendingClipboardBlob = {
	promise: Promise<Blob>;
	reject: (reason: Error) => void;
	resolve: (blob: Blob) => void;
};

export async function copySpaceMessage(input: {
	attachments: readonly CopyableAttachment[];
	files: readonly CopyableFile[];
	loadAttachment?: (attachmentId: string) => Promise<Blob>;
	loadFile: (fileId: string, revision: number) => Promise<LoadedFile>;
	text: string;
}): Promise<SpaceMessageCopyResult> {
	if (input.text.trim().length > 0) {
		if (typeof navigator?.clipboard?.writeText !== "function") {
			return "unavailable";
		}
		try {
			await navigator.clipboard.writeText(input.text);
			return "text";
		} catch {
			return "unavailable";
		}
	}

	const resources = [
		...input.attachments.map((attachment) => ({
			kind: "attachment" as const,
			mimeType: attachment.mimeType,
			resource: attachment,
		})),
		...input.files.map((file) => ({
			kind: "file" as const,
			mimeType: file.mimeType,
			resource: file,
		})),
	];
	if (resources.length === 0) {
		return "empty";
	}
	if (
		typeof navigator?.clipboard?.write !== "function" ||
		typeof ClipboardItem === "undefined"
	) {
		return "unavailable";
	}

	const clipboardTypes = resources.map((resource) =>
		resolveClipboardType(resource.mimeType)
	);
	if (clipboardTypes.some((type) => type === null)) {
		return "unsupported";
	}

	const pendingBlobs = clipboardTypes.map(() => createPendingClipboardBlob());
	let write: Promise<void>;
	try {
		write = navigator.clipboard.write(
			pendingBlobs.map(
				(pending, index) =>
					new ClipboardItem({
						[clipboardTypes[index] as string]: pending.promise,
					})
			)
		);
	} catch {
		for (const pending of pendingBlobs) {
			pending.reject(new Error("Clipboard write could not be started."));
		}
		return "unavailable";
	}

	try {
		await Promise.all(
			resources.map(async (resource, index) => {
				const clipboardType = clipboardTypes[index] as string;
				const sourceBlob =
					resource.kind === "attachment"
						? await loadAttachmentBlob({
								attachmentId: resource.resource.id,
								loadAttachment: input.loadAttachment,
							})
						: await loadFileBlob({
								file: resource.resource,
								loadFile: input.loadFile,
							});
				const clipboardBlob =
					clipboardType === "image/png" && sourceBlob.type !== "image/png"
						? await convertImageBlobToPng(sourceBlob)
						: ensureBlobType(sourceBlob, clipboardType);
				pendingBlobs[index]?.resolve(clipboardBlob);
			})
		);
		await write;
	} catch {
		for (const pending of pendingBlobs) {
			pending.reject(new Error("Clipboard content could not be loaded."));
		}
		await write.catch(() => undefined);
		return "unavailable";
	}

	return resources.every((resource) => resource.mimeType.startsWith("image/"))
		? "image"
		: "file";
}

export async function copySpaceTimelineItem(input: {
	item: SpaceTimelineItem;
	openMeldProfileId?: string;
	organizationSlug?: string;
}): Promise<SpaceMessageCopyResult> {
	const api = input.organizationSlug
		? createOrganizationScopedWebSpaceApi({
				openMeldProfileId: input.openMeldProfileId,
				organizationSlug: input.organizationSlug,
			})
		: createUnscopedWebSpaceApi({
				openMeldProfileId: input.openMeldProfileId,
			});
	return await copySpaceMessage({
		attachments: input.item.attachments,
		files: input.item.files ?? [],
		loadAttachment: async (attachmentId) => {
			const response = await fetch(
				buildWebSpaceAttachmentDownloadPath({
					attachmentId,
					organizationSlug: input.organizationSlug,
					spaceId: input.item.spaceId,
				})
			);
			if (!response.ok) {
				throw new Error("Attachment download failed.");
			}
			return await response.blob();
		},
		loadFile: async (fileId, revision) =>
			await api.downloadFileContent({
				fileId,
				revision,
				spaceId: input.item.spaceId,
			}),
		text: input.item.text,
	});
}

export function copySpaceTimelineItemWithFeedback(input: {
	item: SpaceTimelineItem;
	openMeldProfileId?: string;
	organizationSlug?: string;
}): void {
	copySpaceTimelineItem(input)
		.then((result) => {
			switch (result) {
				case "text":
					toast.success("Message copied.");
					return;
				case "image":
					toast.success("Image copied.");
					return;
				case "file":
					toast.success("File copied.");
					return;
				case "unsupported":
					toast.error("This file type can’t be copied from this browser.");
					return;
				case "empty":
					toast.error("This message has nothing to copy.");
					return;
				case "unavailable":
					toast.error("OpenMeld couldn’t copy this message.");
					return;
				default: {
					const _exhaustive: never = result;
					return _exhaustive;
				}
			}
		})
		.catch(() => {
			toast.error("OpenMeld couldn’t copy this message.");
		});
}

function resolveClipboardType(mimeType: string): string | null {
	if (ClipboardItem.supports(mimeType)) {
		return mimeType;
	}
	if (mimeType.startsWith("image/") && ClipboardItem.supports("image/png")) {
		return "image/png";
	}
	return null;
}

function createPendingClipboardBlob(): PendingClipboardBlob {
	let resolve!: (blob: Blob) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<Blob>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	promise.catch(() => undefined);
	return { promise, reject, resolve };
}

async function loadAttachmentBlob(input: {
	attachmentId: string;
	loadAttachment?: (attachmentId: string) => Promise<Blob>;
}): Promise<Blob> {
	if (!input.loadAttachment) {
		throw new Error("Attachment download is unavailable.");
	}
	return await input.loadAttachment(input.attachmentId);
}

async function loadFileBlob(input: {
	file: CopyableFile;
	loadFile: (fileId: string, revision: number) => Promise<LoadedFile>;
}): Promise<Blob> {
	const content = await input.loadFile(input.file.fileId, input.file.revision);
	if (content.bytes instanceof Blob) {
		return ensureBlobType(content.bytes, content.mimeType);
	}
	const bytes =
		content.bytes instanceof Uint8Array
			? Uint8Array.from(content.bytes).buffer
			: content.bytes;
	return new Blob([bytes], { type: content.mimeType });
}

function ensureBlobType(blob: Blob, mimeType: string): Blob {
	return blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
}

async function convertImageBlobToPng(blob: Blob): Promise<Blob> {
	if (typeof createImageBitmap !== "function") {
		throw new Error(
			"This browser cannot convert this image for the clipboard."
		);
	}
	const image = await createImageBitmap(blob);
	try {
		const canvas = document.createElement("canvas");
		canvas.width = image.width;
		canvas.height = image.height;
		const context = canvas.getContext("2d");
		if (!context) {
			throw new Error("Image conversion is unavailable.");
		}
		context.drawImage(image, 0, 0);
		return await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((converted) => {
				if (converted) {
					resolve(converted);
					return;
				}
				reject(new Error("Image conversion failed."));
			}, "image/png");
		});
	} finally {
		image.close();
	}
}
