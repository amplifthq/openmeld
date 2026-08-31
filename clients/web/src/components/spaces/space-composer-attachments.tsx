import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { FileIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import type { ClipboardEvent, DragEvent } from "react";
import { useRef, useState } from "react";
import { PromptInputAction } from "#/components/ibelick/prompt-input";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";

export function useSpaceComposerFileInput(input: {
	disabled: boolean;
	onAddFiles: (files: readonly File[]) => Promise<void>;
}) {
	const [isDraggingFiles, setIsDraggingFiles] = useState(false);
	const addFiles = (files: readonly File[]) => {
		if (input.disabled || files.length === 0) {
			return;
		}
		input.onAddFiles(files).catch((error) => {
			console.error("Failed to add files to the Space composer.", error);
		});
	};
	const handleDragOver = (event: DragEvent<HTMLElement>) => {
		if (!event.dataTransfer.types.includes("Files")) {
			return;
		}
		event.preventDefault();
		if (!input.disabled) {
			setIsDraggingFiles(true);
		}
	};

	return {
		addFiles,
		handleDragLeave: () => setIsDraggingFiles(false),
		handleDragOver,
		handleDrop: (event: DragEvent<HTMLElement>) => {
			if (!event.dataTransfer.types.includes("Files")) {
				return;
			}
			event.preventDefault();
			setIsDraggingFiles(false);
			addFiles(Array.from(event.dataTransfer.files));
		},
		handlePaste: (event: ClipboardEvent<HTMLElement>) => {
			const pastedFiles = Array.from(event.clipboardData.items).flatMap(
				(item) => {
					if (item.kind !== "file") {
						return [];
					}
					const file = item.getAsFile();
					return file ? [file] : [];
				}
			);
			if (pastedFiles.length === 0) {
				return;
			}
			event.preventDefault();
			addFiles(pastedFiles);
		},
		isDraggingFiles,
	};
}

export function SpaceComposerFileMenu(input: {
	addFiles: (files: readonly File[]) => void;
	disabled: boolean;
	limitReached: boolean;
}) {
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	return (
		<>
			<input
				aria-label="Choose files to send"
				className="sr-only"
				disabled={input.disabled}
				multiple={true}
				onChange={(event) => {
					input.addFiles(Array.from(event.target.files ?? []));
					event.target.value = "";
				}}
				ref={fileInputRef}
				type="file"
			/>
			<DropdownMenu>
				<PromptInputAction
					tooltip={
						input.limitReached
							? "You can add up to 10 files."
							: "Add to message"
					}
				>
					<DropdownMenuTrigger
						disabled={input.disabled || input.limitReached}
						render={
							<Button
								aria-label="Add to message"
								disabled={input.disabled || input.limitReached}
								size="icon-sm"
								type="button"
								variant="ghost"
							/>
						}
					>
						<PlusIcon aria-hidden="true" />
					</DropdownMenuTrigger>
				</PromptInputAction>
				<FluidDropdownMenuContent
					align="start"
					className="min-w-44"
					side="top"
					sideOffset={8}
				>
					<FluidDropdownMenuItem
						className="text-sm"
						index={0}
						onClick={() => fileInputRef.current?.click()}
					>
						<FileIcon aria-hidden="true" />
						Files
					</FluidDropdownMenuItem>
				</FluidDropdownMenuContent>
			</DropdownMenu>
		</>
	);
}

export function SpaceComposerFileTray(input: {
	disabled: boolean;
	files: readonly SpaceComposerFile[];
	onRemove: (localId: string) => void;
}) {
	if (input.files.length === 0) {
		return null;
	}

	return (
		<fieldset
			aria-label="Files to send"
			className="m-0 grid min-w-0 grid-cols-1 gap-2 border-0 border-border border-b px-1 pt-1 pb-3 sm:grid-cols-2"
		>
			{input.files.map((file) => (
				<div
					className={cn(
						"flex min-w-0 items-center gap-2 rounded-md border bg-muted/50 p-2",
						file.status === "failed"
							? "border-destructive bg-destructive/5"
							: "border-border"
					)}
					key={file.localId}
				>
					{file.previewUrl ? (
						<img
							alt=""
							className="size-12 shrink-0 rounded-sm border border-border bg-background object-cover"
							height={48}
							src={file.previewUrl}
							width={48}
						/>
					) : (
						<div className="flex size-12 shrink-0 items-center justify-center rounded-sm border border-border bg-background text-muted-foreground">
							<FileIcon aria-hidden="true" className="size-5" />
						</div>
					)}
					<div className="min-w-0 flex-1">
						<p className="truncate font-medium text-xs">{file.fileName}</p>
						<p
							className={cn(
								"mt-0.5 text-[11px] leading-4",
								file.status === "failed"
									? "break-words text-destructive"
									: "truncate text-muted-foreground"
							)}
						>
							{resolveComposerFileStatusText(file)}
						</p>
						{file.errorRequestId ? (
							<p className="mt-0.5 truncate text-[11px] text-muted-foreground leading-4">
								Request ID: {file.errorRequestId}
							</p>
						) : null}
						{file.status === "uploading" ? (
							<div
								aria-label={`${file.fileName} upload progress`}
								aria-valuemax={100}
								aria-valuemin={0}
								aria-valuenow={file.progress}
								className="mt-1 h-1 overflow-hidden bg-border"
								role="progressbar"
							>
								<div
									className="h-full bg-foreground transition-[width] motion-reduce:transition-none"
									style={{ width: `${String(file.progress)}%` }}
								/>
							</div>
						) : null}
					</div>
					<Button
						aria-label={`Remove ${file.fileName}`}
						className="size-7 shrink-0"
						disabled={input.disabled}
						onClick={() => input.onRemove(file.localId)}
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

function resolveComposerFileStatusText(file: SpaceComposerFile): string {
	switch (file.status) {
		case "uploading":
			return "Uploading…";
		case "ready":
			return "Ready";
		case "failed":
			return file.errorMessage ?? "File could not be added.";
		default:
			return "Uploading…";
	}
}
