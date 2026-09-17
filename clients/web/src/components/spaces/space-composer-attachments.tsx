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
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { cn } from "@openmeld/ui/lib/utils";
import {
	FileIcon,
	PlusIcon,
	UsersThreeIcon,
	XIcon,
} from "@phosphor-icons/react";
import type { ClipboardEvent, DragEvent } from "react";
import { useRef, useState } from "react";
import { PromptInputAction } from "#/components/ibelick/prompt-input";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";
import { SpaceFileHtmlBadge } from "./space-file-html-badge";
import { SpaceImagePreview } from "./space-image-preview";

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
}) {
	if (input.files.length === 0) {
		return null;
	}

	return (
		<fieldset
			aria-label="Files to send"
			className="m-0 flex min-w-0 flex-nowrap items-start gap-2 overflow-x-auto overscroll-x-contain border-0 px-1 pt-1 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
		>
			{input.files.map((file) => (
				<div className="flex-none" key={file.localId}>
					<div
						className={cn(
							"relative w-fit rounded-xl",
							surfaceClasses(3, 1),
							file.status === "failed" && "ring-1 ring-destructive"
						)}
					>
						<Tooltip>
							<TooltipTrigger render={<span className="block" />}>
								{file.previewUrl ? (
									<SpaceImagePreview
										altText={file.fileName}
										imageSource={file.previewUrl}
										isSingle={false}
										thumbnailClassName="size-16 rounded-xl"
									/>
								) : (
									<span
										aria-label={file.fileName}
										className="flex size-16 flex-col items-center justify-center gap-1 rounded-xl text-muted-foreground"
										role="img"
									>
										{file.mimeType === "text/html" ? (
											<SpaceFileHtmlBadge />
										) : (
											<FileIcon aria-hidden="true" className="size-7" />
										)}
										<span className="max-w-16 truncate text-[10px] uppercase">
											{file.fileName.includes(".")
												? file.fileName.split(".").at(-1)
												: "File"}
										</span>
									</span>
								)}
							</TooltipTrigger>
							<TooltipContent
								className="max-w-80 break-all text-left"
								side="top"
							>
								{file.fileName}
							</TooltipContent>
						</Tooltip>
						<Button
							aria-label={`Remove ${file.fileName}`}
							className="absolute top-1 right-1 z-10 size-4 rounded-full bg-white p-0 text-black shadow-sm hover:bg-white/90"
							disabled={input.disabled}
							onClick={() => input.onRemove(file.localId)}
							size="icon-sm"
							type="button"
							variant="ghost"
						>
							<XIcon aria-hidden="true" className="size-3" />
						</Button>
					</div>
					{file.status === "failed" ? (
						<div className="mt-1 max-w-56">
							<p className="break-words text-destructive text-xs" role="alert">
								{file.errorMessage ?? "File could not be added."}
							</p>
							{file.errorRequestId ? (
								<p className="mt-0.5 break-all text-[11px] text-muted-foreground">
									Request ID: {file.errorRequestId}
								</p>
							) : null}
						</div>
					) : null}
				</div>
			))}
		</fieldset>
	);
}
