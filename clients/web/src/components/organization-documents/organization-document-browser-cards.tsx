"use client";

import type {
	OrganizationDocumentFolder,
	OrganizationDocumentSummary,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { FluidContextMenu } from "@openmeld/ui/fluid/context-menu";
import {
	FluidDropdownMenuContent as DropdownMenuContent,
	FluidDropdownMenuItem as DropdownMenuItem,
	FluidDropdownMenuSubContent as DropdownMenuSubContent,
	FluidDropdownMenuSubTrigger as DropdownMenuSubTrigger,
	FluidDropdownMenuGroup,
} from "@openmeld/ui/fluid/dropdown-menu";
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
import { useState } from "react";
import { ObjectMenuItems } from "#/components/app/object-menu-items";
import {
	buildOrganizationDocumentPath,
	buildOrganizationFilesPath,
} from "#/lib/organizations/organization-routes";
import {
	browserItemDropProps,
	DOCUMENT_DRAG_TYPE,
	documentKindLabel,
	FOLDER_DRAG_TYPE,
	type FolderMoveTarget,
	organizationDocumentDisplayTitle,
} from "./organization-document-browser-model";
import { setBrowserItemDragPreview } from "./organization-document-drag-preview";

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
	const canManageFolder = input.canManage && !input.folder.isManaged;
	const dropProps = canManageFolder
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
				draggable={canManageFolder}
				onDragStart={(event) => {
					event.dataTransfer.setData(FOLDER_DRAG_TYPE, input.folder.id);
					event.dataTransfer.effectAllowed = "move";
					setBrowserItemDragPreview(event);
				}}
				search={{ folder: input.folder.id, view: "knowledge" }}
				to={buildOrganizationFilesPath(input.orgSlug)}
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
			{canManageFolder ? (
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

	return (
		<FluidContextMenu target={card}>
			<ObjectMenuItems
				href={`${buildOrganizationFilesPath(input.orgSlug)}?view=knowledge&folder=${encodeURIComponent(input.folder.id)}`}
			/>
			{canManageFolder ? (
				<FolderMenuItems
					moveTargets={input.moveTargets}
					onDelete={input.onDelete}
					onMove={input.onMove}
					onRename={input.onRename}
				/>
			) : null}
		</FluidContextMenu>
	);
}

export function OrganizationDocumentFileCard(input: {
	canManage: boolean;
	canMove: boolean;
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
				draggable={input.canMove}
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
						<h2 className="truncate font-medium text-base">
							{organizationDocumentDisplayTitle(document)}
						</h2>
						{document.kind === "brief" ? (
							<Badge variant="outline">Brief</Badge>
						) : null}
						{document.hasDraft && document.kind !== "member_profile" ? (
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
					documentTitle={organizationDocumentDisplayTitle(document)}
					moveTargets={input.canMove ? input.moveTargets : []}
					onDelete={input.onDelete}
					onMove={input.onMove}
				/>
			) : null}
		</article>
	);

	return (
		<FluidContextMenu target={card}>
			<ObjectMenuItems
				href={buildOrganizationDocumentPath({
					documentId: document.id,
					orgSlug: input.orgSlug,
				})}
			/>
			{input.canManage ? (
				<DocumentMenuItems
					moveTargets={input.canMove ? input.moveTargets : []}
					onDelete={input.onDelete}
					onMove={input.onMove}
				/>
			) : null}
		</FluidContextMenu>
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
					<FolderMenuItems {...input} />
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
					<DocumentMenuItems {...input} />
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
}) {
	return (
		<>
			<FluidDropdownMenuGroup>
				<DropdownMenuItem index={0} onClick={input.onRename}>
					<PencilSimpleIcon aria-hidden="true" /> Rename…
				</DropdownMenuItem>
				{input.moveTargets.length > 0 ? (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger index={1}>
							<FolderIcon aria-hidden="true" /> Move to
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{input.moveTargets.map((target, index) => (
								<DropdownMoveTarget
									index={index}
									key={target.id ?? "root"}
									onMove={input.onMove}
									target={target}
								/>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				) : null}
			</FluidDropdownMenuGroup>
			<DropdownMenuSeparator />
			<FluidDropdownMenuGroup>
				<DropdownMenuItem
					index={2}
					onClick={input.onDelete}
					variant="destructive"
				>
					<TrashIcon aria-hidden="true" /> Delete…
				</DropdownMenuItem>
			</FluidDropdownMenuGroup>
		</>
	);
}

function DocumentMenuItems(input: {
	moveTargets: FolderMoveTarget[];
	onDelete: () => void;
	onMove: (folderId: string | null) => void;
}) {
	return (
		<>
			<FluidDropdownMenuGroup>
				{input.moveTargets.length > 0 ? (
					<DropdownMenuSub>
						<DropdownMenuSubTrigger index={1}>
							<FolderIcon aria-hidden="true" /> Move to
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent>
							{input.moveTargets.map((target, index) => (
								<DropdownMoveTarget
									index={index}
									key={target.id ?? "root"}
									onMove={input.onMove}
									target={target}
								/>
							))}
						</DropdownMenuSubContent>
					</DropdownMenuSub>
				) : null}
			</FluidDropdownMenuGroup>
			<DropdownMenuSeparator />
			<FluidDropdownMenuGroup>
				<DropdownMenuItem
					index={2}
					onClick={input.onDelete}
					variant="destructive"
				>
					<TrashIcon aria-hidden="true" /> Delete…
				</DropdownMenuItem>
			</FluidDropdownMenuGroup>
		</>
	);
}

function DropdownMoveTarget(input: {
	index: number;
	onMove: (folderId: string | null) => void;
	target: FolderMoveTarget;
}) {
	return (
		<DropdownMenuItem
			index={input.index}
			onClick={() => input.onMove(input.target.id)}
		>
			{input.target.id === null ? (
				<HouseLineIcon aria-hidden="true" />
			) : (
				<FolderIcon aria-hidden="true" />
			)}
			{input.target.label}
		</DropdownMenuItem>
	);
}
