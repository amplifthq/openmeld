import type { SpaceFileContent } from "@openmeld/api-client";
import { toStructuredApiClientFailure } from "@openmeld/api-client";

const SPACE_FILE_DATE_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
});
const SPACE_FILE_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
	dateStyle: "medium",
	timeStyle: "short",
});

export function resolveSpaceFileErrorMessage(error: unknown): string {
	const failure = toStructuredApiClientFailure(error);
	switch (failure.code) {
		case "space_file.name_conflict":
			return "That name is already used in this folder.";
		case "space_file.folder_not_empty":
			return "This folder still contains files. Move or remove them first.";
		case "space.membership_required":
			return "Join this Space before changing its files.";
		case "space_file.conflict":
			return "Someone saved a newer version. Reload the file before trying again.";
		case "space_file.too_large":
			return "Files must be 10 MiB or smaller.";
		default:
			return failure.message || "OpenMeld couldn’t complete this file action.";
	}
}

export function downloadContent(
	fileName: string,
	content: SpaceFileContent
): void {
	const url = URL.createObjectURL(
		new Blob([content.bytes], { type: content.mimeType })
	);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = fileName;
	anchor.click();
	URL.revokeObjectURL(url);
}

export function formatFileSize(sizeBytes: number): string {
	if (sizeBytes < 1024) {
		return `${sizeBytes} B`;
	}
	if (sizeBytes < 1024 * 1024) {
		return `${(sizeBytes / 1024).toFixed(sizeBytes < 10 * 1024 ? 1 : 0)} KB`;
	}
	return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatShortDate(value: string): string {
	return SPACE_FILE_DATE_FORMATTER.format(new Date(value));
}

export function formatFileDateTime(value: string): string {
	return SPACE_FILE_DATE_TIME_FORMATTER.format(new Date(value));
}

export function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).byteLength;
}
