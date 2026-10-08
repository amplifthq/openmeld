import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { cn } from "@openmeld/ui/lib/utils";
import {
	CheckSquareIcon,
	FileIcon,
	PlusIcon,
	UsersThreeIcon,
} from "@phosphor-icons/react";
import type { ClipboardEvent, DragEvent } from "react";
import { useRef, useState } from "react";
import { PromptInputAction } from "#/components/ibelick/prompt-input";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";
import type { ComposerFileDraftCleanup } from "#/lib/spaces/composer-file-drafts";
import {
	SpaceAttachmentFailure,
	SpaceAttachmentRemoveButton,
} from "./space-attachment-actions";
import { SpaceAttachmentStrip } from "./space-attachment-strip";
import { SpaceLocalAttachmentPreview } from "./space-local-attachment-preview";

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

export function SpaceComposerAddMenu(input: {
	addFiles: (files: readonly File[]) => void;
	disabled: boolean;
	disabledReason?: string;
	limitReached: boolean;
	onAddPeopleOrAgents?: () => void;
	onCreateTask?: () => void;
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
				<PromptInputAction tooltip="Add">
					<DropdownMenuTrigger
						render={
							<Button
								aria-label="Add"
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
						disabled={input.disabled || input.limitReached}
						index={0}
						onClick={() => fileInputRef.current?.click()}
					>
						<FileIcon aria-hidden="true" />
						Files
					</FluidDropdownMenuItem>
					{input.onAddPeopleOrAgents ? (
						<FluidDropdownMenuItem
							index={1}
							onClick={input.onAddPeopleOrAgents}
						>
							<UsersThreeIcon aria-hidden="true" />
							People or agents
						</FluidDropdownMenuItem>
					) : null}
					{input.onCreateTask ? (
						<FluidDropdownMenuItem index={2} onClick={input.onCreateTask}>
							<CheckSquareIcon aria-hidden="true" />
							Create task
						</FluidDropdownMenuItem>
					) : null}
					{input.disabled || input.limitReached ? (
						<p className="max-w-64 px-2 py-1 text-muted-foreground text-xs">
							{input.disabled
								? (input.disabledReason ??
									"Confirm access to this Space before adding files.")
								: "You can add up to 10 files."}
						</p>
					) : null}
				</FluidDropdownMenuContent>
			</DropdownMenu>
		</>
	);
}

export function SpaceComposerFileTray(input: {
	disabled: boolean;
	files: readonly SpaceComposerFile[];
	onRemove: (localId: string) => void;
	onRetry?: (localId: string) => void;
}) {
	if (input.files.length === 0) {
		return null;
	}

	return (
		<SpaceAttachmentStrip
			className="pb-2"
			label="Files to send"
			size="composer"
		>
			<SpaceComposerFileItems {...input} />
		</SpaceAttachmentStrip>
	);
}

/** Also composed with existing attachments in the inline editor's single rail. */
export function SpaceComposerFileItems(input: {
	disabled: boolean;
	files: readonly SpaceComposerFile[];
	onRemove: (localId: string) => void;
	onRetry?: (localId: string) => void;
}) {
	return (
		<>
			{input.files.map((file) => (
				<div
					className={cn(
						"relative shrink-0 rounded-lg",
						file.status === "failed" && "ring-1 ring-destructive"
					)}
					data-attachment-name={file.fileName}
					key={file.localId}
				>
					<Tooltip>
						<TooltipTrigger render={<div />}>
							<SpaceLocalAttachmentPreview
								editable
								fileName={file.fileName}
								mimeType={file.mimeType}
								previewUrl={file.previewUrl}
							/>
						</TooltipTrigger>
						<TooltipContent className="max-w-80 break-all text-left" side="top">
							{file.fileName}
						</TooltipContent>
					</Tooltip>
					<SpaceAttachmentRemoveButton
						disabled={input.disabled}
						fileName={file.fileName}
						onRemove={() => input.onRemove(file.localId)}
					/>
					{file.status === "failed" && (
						<SpaceAttachmentFailure
							disabled={input.disabled}
							file={file}
							onRemove={() => input.onRemove(file.localId)}
							onRetry={
								input.onRetry ? () => input.onRetry?.(file.localId) : undefined
							}
						/>
					)}
				</div>
			))}
		</>
	);
}

export function SpaceComposerAttachmentRecovery(input: {
	cleanup: readonly ComposerFileDraftCleanup[];
	onRetryCleanup: (id: string) => void;
	onRetryRestoration: () => void;
	restorationError: unknown | null;
}) {
	if (!input.restorationError && input.cleanup.length === 0) {
		return null;
	}
	return (
		<div className="space-y-2 px-1 pb-2 text-xs">
			{input.restorationError ? (
				<div className="flex items-center justify-between gap-3" role="alert">
					<span>Couldn't restore your attachment drafts.</span>
					<Button
						onClick={input.onRetryRestoration}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</div>
			) : null}
			{input.cleanup.map((cleanup) => (
				<div
					className="flex items-center justify-between gap-3"
					key={`${cleanup.id}:${cleanup.revision}`}
					role={cleanup.status === "failed" ? "alert" : "status"}
				>
					<span>{resolveCleanupMessage(cleanup)}</span>
					{cleanup.status === "failed" ? (
						<Button
							onClick={() => input.onRetryCleanup(cleanup.id)}
							size="sm"
							type="button"
							variant="outline"
						>
							Retry cleanup
						</Button>
					) : null}
				</div>
			))}
		</div>
	);
}

function resolveCleanupMessage(cleanup: ComposerFileDraftCleanup): string {
	if (cleanup.status === "pending") {
		return "Removing attachment…";
	}
	if (cleanup.reason === "sent") {
		return "Your message was sent, but its local attachment draft couldn't be cleared.";
	}
	return "Couldn't finish removing this attachment from this device.";
}
