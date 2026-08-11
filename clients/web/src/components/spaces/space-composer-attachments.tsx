import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { PaperclipIcon, XIcon } from "@phosphor-icons/react";
import type { ClipboardEvent, DragEvent } from "react";
import { useRef, useState } from "react";
import { PromptInputAction } from "#/components/ibelick/prompt-input";
import type { SpaceComposerAttachment } from "#/lib/spaces/composer-attachment";

export function useSpaceComposerImageInput(input: {
	disabled: boolean;
	onAddImages: (files: readonly File[]) => Promise<void>;
}) {
	const [isDraggingImages, setIsDraggingImages] = useState(false);
	const addImages = (files: readonly File[]) => {
		if (input.disabled || files.length === 0) {
			return;
		}
		input.onAddImages(files).catch((error) => {
			console.error("Failed to add images to the Space composer.", error);
		});
	};
	const handleDragOver = (event: DragEvent<HTMLTextAreaElement>) => {
		if (!event.dataTransfer.types.includes("Files")) {
			return;
		}
		event.preventDefault();
		if (!input.disabled) {
			setIsDraggingImages(true);
		}
	};

	return {
		addImages,
		handleDragLeave: () => setIsDraggingImages(false),
		handleDragOver,
		handleDrop: (event: DragEvent<HTMLTextAreaElement>) => {
			if (!event.dataTransfer.types.includes("Files")) {
				return;
			}
			event.preventDefault();
			setIsDraggingImages(false);
			addImages(Array.from(event.dataTransfer.files));
		},
		handlePaste: (event: ClipboardEvent<HTMLTextAreaElement>) => {
			const imageFiles = Array.from(event.clipboardData.items).flatMap(
				(item) => {
					if (
						item.kind !== "file" ||
						!(item.type === "" || item.type.startsWith("image/"))
					) {
						return [];
					}
					const file = item.getAsFile();
					return file ? [file] : [];
				}
			);
			if (imageFiles.length === 0) {
				return;
			}
			event.preventDefault();
			addImages(imageFiles);
		},
		isDraggingImages,
	};
}

export function SpaceComposerImagePickerAction(input: {
	addImages: (files: readonly File[]) => void;
	disabled: boolean;
	limitReached: boolean;
}) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	return (
		<>
			<input
				accept="image/*"
				aria-label="Choose images to attach"
				className="sr-only"
				disabled={input.disabled}
				multiple={true}
				onChange={(event) => {
					input.addImages(Array.from(event.target.files ?? []));
					event.target.value = "";
				}}
				ref={fileInputRef}
				type="file"
			/>
			<PromptInputAction
				tooltip={
					input.limitReached
						? "You can attach up to 4 images."
						: "Attach images"
				}
			>
				<Button
					aria-label="Attach images"
					disabled={input.disabled}
					onClick={() => fileInputRef.current?.click()}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<PaperclipIcon aria-hidden="true" />
				</Button>
			</PromptInputAction>
		</>
	);
}

export function SpaceComposerAttachmentTray(input: {
	attachments: readonly SpaceComposerAttachment[];
	disabled: boolean;
	onRemove: (localId: string) => void;
}) {
	if (input.attachments.length === 0) {
		return null;
	}

	return (
		<fieldset
			aria-label="Images to send"
			className="m-0 grid min-w-0 grid-cols-1 gap-2 border-0 border-border border-b px-1 pt-1 pb-3 sm:grid-cols-2"
		>
			{input.attachments.map((attachment) => (
				<div
					className={cn(
						"flex min-w-0 items-center gap-2 rounded-md border bg-muted/50 p-2",
						attachment.status === "failed"
							? "border-destructive bg-destructive/5"
							: "border-border"
					)}
					key={attachment.localId}
				>
					<img
						alt={`Preview of ${attachment.fileName}`}
						className="size-12 shrink-0 rounded-sm border border-border bg-background object-cover"
						height={48}
						src={attachment.previewUrl}
						width={48}
					/>
					<div className="min-w-0 flex-1">
						<p className="truncate font-medium text-xs">
							{attachment.fileName}
						</p>
						<p
							className={cn(
								"mt-0.5 text-[11px] leading-4",
								attachment.status === "failed"
									? "break-words text-destructive"
									: "truncate text-muted-foreground"
							)}
						>
							{resolveComposerAttachmentStatusText(attachment)}
						</p>
						{attachment.status === "failed" && attachment.errorRequestId ? (
							<p className="mt-0.5 break-all text-[10px] text-muted-foreground leading-4">
								Request ID: {attachment.errorRequestId}
							</p>
						) : null}
						{attachment.status === "processing" ||
						attachment.status === "uploading" ? (
							<div
								aria-label={`${attachment.fileName} upload progress`}
								aria-valuemax={100}
								aria-valuemin={0}
								aria-valuenow={attachment.progress}
								className="mt-1 h-1 overflow-hidden bg-border"
								role="progressbar"
							>
								<div
									className="h-full bg-foreground transition-[width] duration-200"
									style={{ width: `${String(attachment.progress)}%` }}
								/>
							</div>
						) : null}
					</div>
					<Button
						aria-label={`Remove ${attachment.fileName}`}
						className="size-7 shrink-0"
						disabled={input.disabled}
						onClick={() => input.onRemove(attachment.localId)}
						size="icon-sm"
						type="button"
						variant="ghost"
					>
						<XIcon aria-hidden="true" />
					</Button>
				</div>
			))}
		</fieldset>
	);
}

function resolveComposerAttachmentStatusText(
	attachment: SpaceComposerAttachment
): string {
	switch (attachment.status) {
		case "processing":
			return "Preparing image…";
		case "uploading":
			return "Uploading…";
		case "ready":
			return "Ready";
		case "failed":
			return attachment.errorMessage ?? "Image could not be attached.";
		default:
			return "Preparing image…";
	}
}
