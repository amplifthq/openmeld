"use client";

import type {
	OrganizationDocumentFolder,
	OrganizationDocumentSummary,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuSeparator,
	ContextMenuSub,
	ContextMenuSubContent,
	ContextMenuSubTrigger,
	ContextMenuTrigger,
} from "@openmeld/ui/components/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { cardPickerCardClassName } from "@openmeld/ui/lib/card-picker-contract";
import { cn } from "@openmeld/ui/lib/utils";
import {
	DotsThreeIcon,
	FileTextIcon,
	FolderIcon,
	FolderOpenIcon,
	FolderSimpleIcon,
	HouseLineIcon,
	PencilSimpleIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { type DragEvent, useState } from "react";
import {
	buildOrganizationDocumentPath,
	buildOrganizationDocumentsPath,
} from "#/lib/organizations/organization-routes";
import { setBrowserItemDragPreview } from "./organization-document-drag-preview";

export const DOCUMENT_DRAG_TYPE = "application/x-openmeld-document-id";
export const FOLDER_DRAG_TYPE = "application/x-openmeld-folder-id";

export type FolderMoveTarget = {
	id: string | null;
	label: string;
};

type BrowserItemDropHandlers = {
	onDropDocument?: (documentId: string) => void;
	onDropFolder?: (folderId: string) => void;
	setDropActive: (active: boolean) => void;
};

export function OrganizationDocumentFolderCard(input: {
	canManage: boolean;
	folder: OrganizationDocumentFolder;
	itemCount: number;
	moveTargets: FolderMoveTarget[];
	onDelete: () => void;
	onDropDocument: (documentId: string) => void;
	onDropFolder: (folderId: string) => void;
	onMove: (parentFolderId: string | null) => void;
	onRename: () => void;
	orgSlug: string;
}) {
	const [dropActive, setDropActive] = useState(false);
	const dropProps = input.canManage
		? browserItemDropProps({
				onDropDocument: input.onDropDocument,
				onDropFolder: input.onDropFolder,
				setDropActive,
			})
		: {};
	const card = (
		<article className="group/card relative h-full" {...dropProps}>
			<Link
				className={cn(
					cardPickerCardClassName(),
					"min-h-40 cursor-grab bg-transparent p-4 pr-12 transition-[border-color] duration-150 ease-out hover:bg-transparent active:cursor-grabbing",
					dropActive && "border-primary/50 bg-primary/5 ring-1 ring-primary/40"
				)}
				draggable={input.canManage}
				onDragStart={(event) => {
					event.dataTransfer.setData(FOLDER_DRAG_TYPE, input.folder.id);
					event.dataTransfer.effectAllowed = "move";
					setBrowserItemDragPreview(event);
				}}
				search={{ folder: input.folder.id }}
				to={buildOrganizationDocumentsPath(input.orgSlug)}
			>
				<span className="grid size-12 place-items-center rounded-md border border-border/70 bg-background/70 text-foreground/75">
					{dropActive ? (
						<FolderOpenIcon
							aria-hidden="true"
							className="size-7"
							weight="duotone"
						/>
					) : (
						<FolderSimpleIcon
							aria-hidden="true"
							className="size-8"
							weight="duotone"
						/>
					)}
				</span>
				<div className="mt-auto min-w-0 pt-5">
					<h2 className="truncate font-medium text-base">
						{input.folder.name}
					</h2>
					<p className="mt-1 text-muted-foreground text-xs">
						{input.itemCount === 1 ? "1 item" : `${input.itemCount} items`}
					</p>
				</div>
			</Link>
			{input.canManage ? (
				<FolderActions
					folderName={input.folder.name}
					moveTargets={input.moveTargets}
					onDelete={input.onDelete}
					onMove={input.onMove}
					onRename={input.onRename}
				/>
			) : null}
		</article>
	);

	if (!input.canManage) {
		return card;
	}
	return (
		<ContextMenu>
			<ContextMenuTrigger render={card} />
			<ContextMenuContent>
				<FolderMenuItems
					moveTargets={input.moveTargets}
					onDelete={input.onDelete}
					onMove={input.onMove}
					onRename={input.onRename}
					variant="context"
				/>
			</ContextMenuContent>
		</ContextMenu>
	);
}

export function OrganizationDocumentFileCard(input: {
	canManage: boolean;
	document: OrganizationDocumentSummary;
	memberName?: string;
	moveTargets: FolderMoveTarget[];
	onDelete: () => void;
	onMove: (folderId: string | null) => void;
	orgSlug: string;
}) {
	const { document } = input;
	const card = (
		<article className="group/card relative h-full">
			<Link
				className={cn(
					cardPickerCardClassName(),
					"min-h-40 cursor-grab bg-transparent p-4 pr-12 transition-[border-color] duration-150 ease-out hover:bg-transparent active:cursor-grabbing"
				)}
				draggable={input.canManage}
				onDragStart={(event) => {
					event.dataTransfer.setData(DOCUMENT_DRAG_TYPE, document.id);
					event.dataTransfer.effectAllowed = "move";
					setBrowserItemDragPreview(event);
				}}
				to={buildOrganizationDocumentPath({
					documentId: document.id,
					orgSlug: input.orgSlug,
				})}
			>
				<span className="grid size-12 place-items-center rounded-md border border-border/70 bg-background/70 text-foreground/75">
					<FileTextIcon
						aria-hidden="true"
						className="size-7"
						weight="duotone"
					/>
				</span>
				<div className="mt-auto min-w-0 pt-5">
					<div className="flex min-w-0 flex-wrap items-center gap-2">
						<h2 className="truncate font-medium text-base">{document.title}</h2>
						{document.kind === "brief" ? (
							<Badge variant="outline">Brief</Badge>
						) : null}
						{document.hasDraft ? (
							<Badge variant="secondary">Draft</Badge>
						) : null}
					</div>
					<p className="mt-1 truncate text-muted-foreground text-xs">
						{documentKindLabel(document.kind)}
						{input.memberName ? ` · ${input.memberName}` : ""}
					</p>
				</div>
			</Link>
			{input.canManage ? (
				<DocumentActions
					documentTitle={document.title}
					moveTargets={input.moveTargets}
					onDelete={input.onDelete}
					onMove={input.onMove}
				/>
			) : null}
		</article>
	);

	if (!input.canManage) {
		return card;
	}
	return (
		<ContextMenu>
			<ContextMenuTrigger render={card} />
			<ContextMenuContent>
				<DocumentMenuItems
					moveTargets={input.moveTargets}
					onDelete={input.onDelete}
					onMove={input.onMove}
					variant="context"
				/>
			</ContextMenuContent>
		</ContextMenu>
	);
}

function FolderActions(input: {
	folderName: string;
	moveTargets: FolderMoveTarget[];
	onDelete: () => void;
	onMove: (folderId: string | null) => void;
	onRename: () => void;
}) {
	return (
		<div className="absolute top-3 right-3 z-20">
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={`Folder actions for ${input.folderName}`}
							className="opacity-60 transition-opacity focus-visible:opacity-100 group-hover/card:opacity-100 data-popup-open:opacity-100"
							size="icon-sm"
							variant="ghost"
						/>
					}
				>
					<DotsThreeIcon aria-hidden="true" weight="bold" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<FolderMenuItems {...input} variant="dropdown" />
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function DocumentActions(input: {
	documentTitle: string;
	moveTargets: FolderMoveTarget[];
	onDelete: () => void;
	onMove: (folderId: string | null) => void;
}) {
	return (
		<div className="absolute top-3 right-3 z-20">
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label={`Document actions for ${input.documentTitle}`}
							className="opacity-60 transition-opacity focus-visible:opacity-100 group-hover/card:opacity-100 data-popup-open:opacity-100"
							size="icon-sm"
							variant="ghost"
						/>
					}
				>
					<DotsThreeIcon aria-hidden="true" weight="bold" />
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DocumentMenuItems {...input} variant="dropdown" />
				</DropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}

function FolderMenuItems(input: {
	moveTargets: FolderMoveTarget[];
	onDelete: () => void;
	onMove: (folderId: string | null) => void;
	onRename: () => void;
	variant: "context" | "dropdown";
}) {
	if (input.variant === "context") {
		return (
			<>
				<ContextMenuItem onClick={input.onRename}>
					<PencilSimpleIcon aria-hidden="true" /> Rename…
				</ContextMenuItem>
				{input.moveTargets.length > 0 ? (
					<ContextMenuSub>
						<ContextMenuSubTrigger>
							<FolderIcon aria-hidden="true" /> Move to
						</ContextMenuSubTrigger>
						<ContextMenuSubContent>
							{input.moveTargets.map((target) => (
								<ContextMoveTarget
									key={target.id ?? "root"}
									onMove={input.onMove}
									target={target}
								/>
							))}
						</ContextMenuSubContent>
					</ContextMenuSub>
				) : null}
				<ContextMenuSeparator />
				<ContextMenuItem onClick={input.onDelete} variant="destructive">
					<TrashIcon aria-hidden="true" /> Delete…
				</ContextMenuItem>
			</>
		);
	}
	return (
		<>
			<DropdownMenuItem onClick={input.onRename}>
				<PencilSimpleIcon aria-hidden="true" /> Rename…
			</DropdownMenuItem>
			{input.moveTargets.length > 0 ? (
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<FolderIcon aria-hidden="true" /> Move to
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						{input.moveTargets.map((target) => (
							<DropdownMoveTarget
								key={target.id ?? "root"}
								onMove={input.onMove}
								target={target}
							/>
						))}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			) : null}
			<DropdownMenuSeparator />
			<DropdownMenuItem onClick={input.onDelete} variant="destructive">
				<TrashIcon aria-hidden="true" /> Delete…
			</DropdownMenuItem>
		</>
	);
}

function DocumentMenuItems(input: {
	moveTargets: FolderMoveTarget[];
	onDelete: () => void;
	onMove: (folderId: string | null) => void;
	variant: "context" | "dropdown";
}) {
	if (input.variant === "context") {
		return (
			<>
				{input.moveTargets.length > 0 ? (
					<ContextMenuSub>
						<ContextMenuSubTrigger>
							<FolderIcon aria-hidden="true" /> Move to
						</ContextMenuSubTrigger>
						<ContextMenuSubContent>
							{input.moveTargets.map((target) => (
								<ContextMoveTarget
									key={target.id ?? "root"}
									onMove={input.onMove}
									target={target}
								/>
							))}
						</ContextMenuSubContent>
					</ContextMenuSub>
				) : null}
				<ContextMenuSeparator />
				<ContextMenuItem onClick={input.onDelete} variant="destructive">
					<TrashIcon aria-hidden="true" /> Delete…
				</ContextMenuItem>
			</>
		);
	}
	return (
		<>
			{input.moveTargets.length > 0 ? (
				<DropdownMenuSub>
					<DropdownMenuSubTrigger>
						<FolderIcon aria-hidden="true" /> Move to
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						{input.moveTargets.map((target) => (
							<DropdownMoveTarget
								key={target.id ?? "root"}
								onMove={input.onMove}
								target={target}
							/>
						))}
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			) : null}
			<DropdownMenuSeparator />
			<DropdownMenuItem onClick={input.onDelete} variant="destructive">
				<TrashIcon aria-hidden="true" /> Delete…
			</DropdownMenuItem>
		</>
	);
}

function ContextMoveTarget(input: {
	onMove: (folderId: string | null) => void;
	target: FolderMoveTarget;
}) {
	return (
		<ContextMenuItem onClick={() => input.onMove(input.target.id)}>
			{input.target.id === null ? (
				<HouseLineIcon aria-hidden="true" />
			) : (
				<FolderIcon aria-hidden="true" />
			)}
			{input.target.label}
		</ContextMenuItem>
	);
}

function DropdownMoveTarget(input: {
	onMove: (folderId: string | null) => void;
	target: FolderMoveTarget;
}) {
	return (
		<DropdownMenuItem onClick={() => input.onMove(input.target.id)}>
			{input.target.id === null ? (
				<HouseLineIcon aria-hidden="true" />
			) : (
				<FolderIcon aria-hidden="true" />
			)}
			{input.target.label}
		</DropdownMenuItem>
	);
}

export function browserItemDropProps(input: BrowserItemDropHandlers) {
	const accepts = (event: DragEvent<HTMLElement>) =>
		(Boolean(input.onDropDocument) &&
			event.dataTransfer.types.includes(DOCUMENT_DRAG_TYPE)) ||
		(Boolean(input.onDropFolder) &&
			event.dataTransfer.types.includes(FOLDER_DRAG_TYPE));
	return {
		onDragLeave: (event: DragEvent<HTMLElement>) => {
			if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
				input.setDropActive(false);
			}
		},
		onDragOver: (event: DragEvent<HTMLElement>) => {
			if (accepts(event)) {
				event.preventDefault();
				event.dataTransfer.dropEffect = "move";
				input.setDropActive(true);
			}
		},
		onDrop: (event: DragEvent<HTMLElement>) => {
			input.setDropActive(false);
			const documentId = event.dataTransfer.getData(DOCUMENT_DRAG_TYPE);
			if (documentId && input.onDropDocument) {
				event.preventDefault();
				input.onDropDocument(documentId);
				return;
			}
			const folderId = event.dataTransfer.getData(FOLDER_DRAG_TYPE);
			if (folderId && input.onDropFolder) {
				event.preventDefault();
				input.onDropFolder(folderId);
			}
		},
	};
}

export function documentKindLabel(
	kind: OrganizationDocumentSummary["kind"]
): string {
	switch (kind) {
		case "brief":
			return "Center Agent context";
		case "member_profile":
			return "Profile Report";
		default:
			return "Knowledge";
	}
}
