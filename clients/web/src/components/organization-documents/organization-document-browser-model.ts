import type {
	OrganizationDocumentFolder,
	OrganizationDocumentSummary,
} from "@openmeld/schemas/types";
import type { FolderMoveTarget } from "./organization-document-browser-cards";

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
		frontier = folders
			.filter(
				(folder) =>
					!descendants.has(folder.id) &&
					parentIds.has(parentFolderId(folder) ?? "")
			)
			.map((folder) => folder.id);
		for (const descendantId of frontier) {
			descendants.add(descendantId);
		}
	}
	return descendants;
}
