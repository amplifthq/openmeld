import {
	FileAudioIcon,
	FileCodeIcon,
	FileDocIcon,
	FileIcon,
	FileImageIcon,
	FilePdfIcon,
	FilePptIcon,
	FileTextIcon,
	FileVideoIcon,
	FileXlsIcon,
	FileZipIcon,
} from "@phosphor-icons/react";
import { SpaceFileHtmlBadge } from "./space-file-html-badge";
import { formatFileSize } from "./space-file-utils";
import { SpaceMessageResourceCard } from "./space-message-resource-card";

function attachmentIcon(mimeType: string) {
	if (mimeType.startsWith("image/")) {
		return FileImageIcon;
	}
	if (mimeType.startsWith("video/")) {
		return FileVideoIcon;
	}
	if (mimeType.startsWith("audio/")) {
		return FileAudioIcon;
	}
	if (mimeType === "application/pdf") {
		return FilePdfIcon;
	}
	if (
		mimeType.includes("spreadsheet") ||
		mimeType.includes("excel") ||
		mimeType === "text/csv"
	) {
		return FileXlsIcon;
	}
	if (mimeType.includes("presentation") || mimeType.includes("powerpoint")) {
		return FilePptIcon;
	}
	if (
		mimeType.includes("wordprocessing") ||
		mimeType === "application/msword"
	) {
		return FileDocIcon;
	}
	if (
		mimeType.includes("zip") ||
		mimeType.includes("compressed") ||
		mimeType === "application/x-tar"
	) {
		return FileZipIcon;
	}
	if (
		mimeType.includes("json") ||
		mimeType.includes("xml") ||
		mimeType.includes("javascript")
	) {
		return FileCodeIcon;
	}
	if (mimeType.startsWith("text/")) {
		return FileTextIcon;
	}
	return FileIcon;
}

/** Unsupported binaries stay honest file cards, never broken image previews. */
export function SpaceAttachmentFileCard(input: {
	fileName: string;
	mimeType: string;
	sizeBytes?: number;
	revision?: number;
	onOpen?: () => void;
	className?: string;
}) {
	const Icon = attachmentIcon(input.mimeType);
	const extension = input.fileName.includes(".")
		? input.fileName.split(".").at(-1)?.toUpperCase()
		: "File";
	const content = (
		<>
			<span
				aria-hidden="true"
				className="flex size-8 shrink-0 items-center justify-center text-muted-foreground"
			>
				{input.mimeType === "text/html" ? (
					<SpaceFileHtmlBadge />
				) : (
					<Icon className="size-7" />
				)}
			</span>
			<span className="min-w-0 flex-1">
				<span className="block truncate font-medium text-xs">
					{input.fileName}
				</span>
				<span className="mt-1 block truncate text-muted-foreground text-xs">
					{extension}
					{input.sizeBytes === undefined
						? ""
						: ` · ${formatFileSize(input.sizeBytes)}`}
				</span>
				{input.revision !== undefined && (
					<span className="block truncate text-muted-foreground text-xs">
						Version {input.revision}
					</span>
				)}
			</span>
		</>
	);
	return (
		<SpaceMessageResourceCard
			className={input.className}
			label={input.onOpen ? `Open ${input.fileName} in Files` : input.fileName}
			onOpen={input.onOpen}
			title={
				input.onOpen ? `${input.fileName} · Open in Files` : input.fileName
			}
		>
			{content}
		</SpaceMessageResourceCard>
	);
}
