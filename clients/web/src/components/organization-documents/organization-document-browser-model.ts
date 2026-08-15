import type {
	OrganizationDocumentFolder,
	OrganizationDocumentSummary,
} from "@openmeld/schemas/types";
import type { DragEvent } from "react";

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

export function resolveDirectItemCount(input: {
	documents: OrganizationDocumentSummary[];
	folderId: string;
	folders: OrganizationDocumentFolder[];
}): number {
	const directDocuments = input.documents.filter(
		(document) => document.folderId === input.folderId
	).length;
	const directFolders = input.folders.filter(
		(folder) => parentFolderId(folder) === input.folderId
	).length;
	return directDocuments + directFolders;
}

export function resolveFolderBreadcrumb(input: {
	activeFolder: OrganizationDocumentFolder;
	folders: OrganizationDocumentFolder[];
}): OrganizationDocumentFolder[] {
	const folderById = new Map(
		input.folders.map((folder) => [folder.id, folder])
	);
	const breadcrumb: OrganizationDocumentFolder[] = [];
	const visited = new Set<string>();
	let current: OrganizationDocumentFolder | undefined = input.activeFolder;

	while (current && !visited.has(current.id)) {
		breadcrumb.unshift(current);
		visited.add(current.id);
		const parentId = parentFolderId(current);
		current = parentId ? folderById.get(parentId) : undefined;
	}

	return breadcrumb;
}

export function resolveDocumentMoveTargets(input: {
	currentFolderId: string | null;
	folders: OrganizationDocumentFolder[];
}): FolderMoveTarget[] {
	return allFolderTargets(input.folders).filter(
		(target) => target.id !== input.currentFolderId
	);
}

export function resolveFolderMoveTargets(input: {
	folder: OrganizationDocumentFolder;
	folders: OrganizationDocumentFolder[];
}): FolderMoveTarget[] {
	const descendantIds = resolveDescendantIds(input.folder.id, input.folders);
	const currentParentId = parentFolderId(input.folder);
	return allFolderTargets(input.folders).filter(
		(target) =>
			target.id !== currentParentId &&
			target.id !== input.folder.id &&
			(target.id === null || !descendantIds.has(target.id))
	);
}

export function parentFolderId(
	folder: OrganizationDocumentFolder
): string | null {
	return folder.parentFolderId ?? null;
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

function allFolderTargets(
	folders: OrganizationDocumentFolder[]
): FolderMoveTarget[] {
	return [
		{ id: null, label: "Documents" },
		...folders.map((folder) => ({
			id: folder.id,
			label: resolveFolderPath(folder, folders),
		})),
	];
}

function resolveFolderPath(
	folder: OrganizationDocumentFolder,
	folders: OrganizationDocumentFolder[]
): string {
	return resolveFolderBreadcrumb({ activeFolder: folder, folders })
		.map((ancestor) => ancestor.name)
		.join(" / ");
}

function resolveDescendantIds(
	folderId: string,
	folders: OrganizationDocumentFolder[]
): Set<string> {
	const descendants = new Set<string>();
	let frontier = [folderId];
	while (frontier.length > 0) {
		const parentIds = new Set(frontier);
		const nextFrontier: string[] = [];
		for (const folder of folders) {
			if (
				!descendants.has(folder.id) &&
				parentIds.has(parentFolderId(folder) ?? "")
			) {
				nextFrontier.push(folder.id);
			}
		}
		frontier = nextFrontier;
		for (const descendantId of frontier) {
			descendants.add(descendantId);
		}
	}
	return descendants;
}
