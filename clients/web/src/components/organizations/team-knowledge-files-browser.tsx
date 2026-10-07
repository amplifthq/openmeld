"use client";

import {
	ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS,
	ORGANIZATION_DOCUMENT_TITLE_MAX_CHARS,
} from "@openmeld/schemas";
import type {
	OrganizationDocumentFolder,
	OrganizationDocumentSummary,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	ContextMenu,
	ContextMenuTrigger,
} from "@openmeld/ui/components/context-menu";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { SkeletonRows } from "@openmeld/ui/components/skeleton-content";
import {
	FluidDropdownMenuContent as ContextMenuContent,
	FluidDropdownMenuItem as ContextMenuItem,
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import {
	ArrowLeftIcon,
	CaretRightIcon,
	FileTextIcon,
	FolderPlusIcon,
	PlusIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { lazy, type ReactNode, Suspense, useMemo, useState } from "react";
import { toast } from "sonner";
import { ObjectMenuItems } from "#/components/app/object-menu-items";
import type { FileSystemItem } from "#/components/extend/file-system";
import { organizationDocumentDisplayTitle } from "#/components/organization-documents/organization-document-browser-model";
import {
	FolderNameDialog,
	NewTextFileDialog,
} from "#/components/spaces/space-file-dialogs";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	createCurrentOrganizationDocument,
	createCurrentOrganizationDocumentFolder,
	resolveOrganizationDocumentErrorMessage,
} from "#/lib/organizations/organization-documents";
import { buildOrganizationFilesPath } from "#/lib/organizations/organization-routes";
import {
	organizationDocumentQueryKeys,
	organizationDocumentsQueryOptions,
} from "#/query/organizations/organization-documents";

const FileSystem = lazy(() =>
	import("#/components/extend/file-system").then((module) => ({
		default: module.FileSystem,
	}))
);

type KnowledgeEntry =
	| { kind: "folder"; folder: OrganizationDocumentFolder }
	| { kind: "file"; document: OrganizationDocumentSummary };

function folderBreadcrumb(
	folder: OrganizationDocumentFolder | undefined,
	folders: OrganizationDocumentFolder[]
): OrganizationDocumentFolder[] {
	const byId = new Map(folders.map((item) => [item.id, item]));
	const result: OrganizationDocumentFolder[] = [];
	let current = folder;
	while (current && result.length <= folders.length) {
		result.unshift(current);
		current = current.parentFolderId
			? byId.get(current.parentFolderId)
			: undefined;
	}
	return result;
}

export function TeamKnowledgeFilesBrowser(input: {
	folderId?: string;
	toolbarTabs: ReactNode;
}) {
	const { currentOrganization } = useAppOrganization();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const knowledge = useQuery(
		organizationDocumentsQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const [folderDialogOpen, setFolderDialogOpen] = useState(false);
	const [folderError, setFolderError] = useState<string | null>(null);
	const [creatingFolder, setCreatingFolder] = useState(false);
	const [newMarkdownOpen, setNewMarkdownOpen] = useState(false);
	const [markdownError, setMarkdownError] = useState<string | null>(null);
	const [creatingMarkdown, setCreatingMarkdown] = useState(false);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);
	const folders = knowledge.data?.folders ?? [];
	const documents = knowledge.data?.documents ?? [];
	const activeFolder = input.folderId
		? folders.find((folder) => folder.id === input.folderId)
		: undefined;
	const missingFolder = knowledge.isSuccess && input.folderId && !activeFolder;
	const parentFolderId = activeFolder?.id ?? null;
	const canCreate =
		knowledge.data?.canManage === true && activeFolder?.isManaged !== true;
	const entries = useMemo(() => {
		const result = new Map<string, KnowledgeEntry>();
		for (const folder of folders) {
			if ((folder.parentFolderId ?? null) !== parentFolderId) {
				continue;
			}
			result.set(`folder-${folder.id}/`, { kind: "folder", folder });
		}
		for (const document of documents) {
			if (document.folderId !== parentFolderId) {
				continue;
			}
			result.set(`document-${document.id}.md`, { kind: "file", document });
		}
		return result;
	}, [documents, folders, parentFolderId]);
	const items: FileSystemItem[] = [...entries].map(([path, entry]) =>
		entry.kind === "folder"
			? {
					kind: "folder",
					path,
					name: entry.folder.name,
					createdAt: entry.folder.createdAt,
					updatedAt: entry.folder.updatedAt,
				}
			: {
					kind: "file",
					path,
					name: organizationDocumentDisplayTitle(entry.document),
					contentType: "text/markdown",
					createdAt: entry.document.createdAt,
					updatedAt: entry.document.updatedAt,
					badge: entry.document.hasDraft ? "Review" : undefined,
				}
	);
	const selectedEntry = selectedPath ? entries.get(selectedPath) : undefined;
	const selectedHref = selectedEntry
		? `${buildOrganizationFilesPath(currentOrganization.slug)}?${new URLSearchParams(
				{
					view: "knowledge",
					...(selectedEntry.kind === "folder"
						? { folder: selectedEntry.folder.id }
						: { document: selectedEntry.document.id }),
				}
			)}`
		: undefined;
	const navigateToFolder = (folderId?: string) => {
		setSelectedPath(null);
		navigate({
			to: buildOrganizationFilesPath(currentOrganization.slug),
			search: folderId
				? { view: "knowledge", folder: folderId }
				: { view: "knowledge" },
		}).catch(console.error);
	};
	const openEntry = (entry: KnowledgeEntry | undefined) => {
		if (!entry) {
			return;
		}
		if (entry.kind === "folder") {
			navigateToFolder(entry.folder.id);
			return;
		}
		navigate({
			to: buildOrganizationFilesPath(currentOrganization.slug),
			search: { view: "knowledge", document: entry.document.id },
		}).catch(console.error);
	};
	const openNewDocument = () => {
		setMarkdownError(null);
		setNewMarkdownOpen(true);
	};
	const openFolderDialog = () => {
		setFolderError(null);
		setFolderDialogOpen(true);
	};
	const breadcrumb = (
		<div className="flex min-w-0 flex-wrap items-center gap-1.5">
			<Button
				onClick={() =>
					navigate({
						to: buildOrganizationFilesPath(currentOrganization.slug),
						search: {},
					}).catch(console.error)
				}
				size="sm"
				variant="ghost"
			>
				<ArrowLeftIcon aria-hidden="true" /> Team files
			</Button>
			<CaretRightIcon
				aria-hidden="true"
				className="size-3 text-muted-foreground"
			/>
			{activeFolder ? (
				<Button onClick={() => navigateToFolder()} size="sm" variant="ghost">
					Team Knowledge
				</Button>
			) : (
				<span className="font-medium text-sm">Team Knowledge</span>
			)}
			{folderBreadcrumb(activeFolder, folders).map((folder) => (
				<span className="flex items-center gap-1" key={folder.id}>
					<CaretRightIcon
						aria-hidden="true"
						className="size-3 text-muted-foreground"
					/>
					{folder.id === activeFolder?.id ? (
						<span className="font-medium text-sm">{folder.name}</span>
					) : (
						<Button
							onClick={() => navigateToFolder(folder.id)}
							size="sm"
							variant="ghost"
						>
							{folder.name}
						</Button>
					)}
				</span>
			))}
		</div>
	);
	const toolbarActions = canCreate ? (
		<DropdownMenu>
			<DropdownMenuTrigger
				render={<Button disabled={creatingFolder} size="sm" />}
			>
				<PlusIcon aria-hidden="true" /> New
			</DropdownMenuTrigger>
			<FluidDropdownMenuContent align="start">
				<FluidDropdownMenuItem index={0} onClick={openNewDocument}>
					<FileTextIcon aria-hidden="true" /> Markdown file
				</FluidDropdownMenuItem>
				<FluidDropdownMenuItem index={1} onClick={openFolderDialog}>
					<FolderPlusIcon aria-hidden="true" /> Folder
				</FluidDropdownMenuItem>
			</FluidDropdownMenuContent>
		</DropdownMenu>
	) : null;
	let errorContent: ReactNode;
	if (missingFolder) {
		errorContent = <p className="p-5">This folder is no longer available.</p>;
	} else if (knowledge.isError) {
		errorContent = (
			<div className="flex items-center gap-3 p-5" role="alert">
				<p>Team Knowledge couldn’t be loaded.</p>
				<Button onClick={() => knowledge.refetch()} size="sm" variant="outline">
					Try again
				</Button>
			</div>
		);
	}
	return (
		<div className="h-full min-h-0">
			<ContextMenu>
				<ContextMenuTrigger
					className="block h-full"
					onContextMenuCapture={(event) => {
						if (!(event.target as Element).closest('[role="option"]')) {
							setSelectedPath(null);
						}
					}}
				>
					<Suspense
						fallback={<SkeletonRows className="p-3" label="Loading files" />}
					>
						<FileSystem
							breadcrumb={breadcrumb}
							className="h-full min-h-96"
							embedded
							errorContent={errorContent}
							isLoading={knowledge.isPending}
							items={items}
							key={input.folderId ?? "root"}
							onEntryContextMenu={(item) => setSelectedPath(item.path)}
							onFileOpen={(file) => openEntry(entries.get(file.path))}
							onFolderOpen={(folder) => openEntry(entries.get(folder.path))}
							onSelectionChange={(item) => setSelectedPath(item?.path ?? null)}
							title={activeFolder?.name ?? "Team Knowledge"}
							toolbarActions={toolbarActions}
							toolbarStart={input.toolbarTabs}
						/>
					</Suspense>
				</ContextMenuTrigger>
				{selectedPath || canCreate ? (
					<ContextMenuContent className="min-w-40 p-1">
						{selectedPath ? (
							<ObjectMenuItems
								href={selectedHref}
								onOpen={() => openEntry(selectedEntry)}
							/>
						) : (
							<>
								<ContextMenuItem index={1} onClick={openNewDocument}>
									<FileTextIcon aria-hidden="true" /> New Markdown file
								</ContextMenuItem>
								<ContextMenuItem index={2} onClick={openFolderDialog}>
									<FolderPlusIcon aria-hidden="true" /> New folder
								</ContextMenuItem>
							</>
						)}
					</ContextMenuContent>
				) : null}
			</ContextMenu>
			<FolderNameDialog
				error={folderError}
				maxLength={200}
				onOpenChange={(open) => {
					setFolderDialogOpen(open);
					if (!open) {
						setFolderError(null);
					}
				}}
				onSubmit={async (name) => {
					setCreatingFolder(true);
					setFolderError(null);
					try {
						const created = await createCurrentOrganizationDocumentFolder({
							expectedOrganizationId: currentOrganization.id,
							name,
							parentFolderId,
						});
						await queryClient.invalidateQueries({
							queryKey: organizationDocumentQueryKeys.list(
								currentOrganization.id
							),
						});
						setFolderDialogOpen(false);
						if (created.folder.name !== name) {
							toast.message(
								`Created “${created.folder.name}” because “${name}” is already here.`
							);
						}
					} catch (error) {
						setFolderError(resolveOrganizationDocumentErrorMessage(error));
					} finally {
						setCreatingFolder(false);
					}
				}}
				open={folderDialogOpen}
				pending={creatingFolder}
			/>
			<NewTextFileDialog
				error={markdownError}
				kind="markdown"
				maxContentChars={ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS}
				maxNameLength={ORGANIZATION_DOCUMENT_TITLE_MAX_CHARS}
				onOpenChange={(open) => {
					setNewMarkdownOpen(open);
					if (!open) {
						setMarkdownError(null);
					}
				}}
				onSubmit={async ({ content, name }) => {
					setCreatingMarkdown(true);
					setMarkdownError(null);
					try {
						await createCurrentOrganizationDocument({
							content,
							expectedOrganizationId: currentOrganization.id,
							kind: "knowledge",
							...(parentFolderId ? { folderId: parentFolderId } : {}),
							title: name,
						});
						await queryClient.invalidateQueries({
							queryKey: organizationDocumentQueryKeys.list(
								currentOrganization.id
							),
						});
						setNewMarkdownOpen(false);
					} catch (error) {
						setMarkdownError(resolveOrganizationDocumentErrorMessage(error));
					} finally {
						setCreatingMarkdown(false);
					}
				}}
				open={newMarkdownOpen}
				pending={creatingMarkdown}
			/>
		</div>
	);
}
