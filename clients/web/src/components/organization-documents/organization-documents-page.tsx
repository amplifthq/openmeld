"use client";

import type {
	OrganizationDocumentFolder,
	OrganizationDocumentSummary,
} from "@openmeld/schemas/types";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@openmeld/ui/components/alert-dialog";
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { CARD_PICKER_GRID_CLASS_NAME } from "@openmeld/ui/lib/card-picker-contract";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowClockwiseIcon,
	CaretRightIcon,
	DesktopTowerIcon,
	FileTextIcon,
	FolderIcon,
	FolderPlusIcon,
	PlusIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	createCurrentOrganizationDocumentFolder,
	deleteCurrentOrganizationDocument,
	deleteCurrentOrganizationDocumentFolder,
	moveCurrentOrganizationDocument,
	moveCurrentOrganizationDocumentFolder,
	renameCurrentOrganizationDocumentFolder,
	resolveOrganizationDocumentErrorMessage,
} from "#/lib/organizations/organization-documents";
import {
	buildOrganizationDocumentsPath,
	buildOrganizationNewDocumentPath,
} from "#/lib/organizations/organization-routes";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import {
	organizationDocumentQueryKeys,
	organizationDocumentsQueryOptions,
} from "#/query/organizations/organization-documents";
import {
	browserItemDropProps,
	OrganizationDocumentFileCard,
	OrganizationDocumentFolderCard,
} from "./organization-document-browser-cards";
import {
	parentFolderId,
	resolveDirectItemCount,
	resolveDocumentMoveTargets,
	resolveFolderBreadcrumb,
	resolveFolderMoveTargets,
} from "./organization-document-browser-model";

type FolderDialogState =
	| { kind: "closed" }
	| { kind: "create" }
	| { folder: OrganizationDocumentFolder; kind: "delete" }
	| { folder: OrganizationDocumentFolder; kind: "rename" };

export function OrganizationDocumentsPage(input: { folderId?: string }) {
	const { currentOrganization } = useAppOrganization();
	const documentsQuery = useQuery(
		organizationDocumentsQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const directoryQuery = useQuery(
		organizationDirectoryQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const [folderDialog, setFolderDialog] = useState<FolderDialogState>({
		kind: "closed",
	});
	const [documentToDelete, setDocumentToDelete] =
		useState<OrganizationDocumentSummary | null>(null);
	const folders = documentsQuery.data?.folders ?? [];
	const documents = documentsQuery.data?.documents ?? [];
	const canManage = documentsQuery.data?.canManage === true;
	const activeFolder = input.folderId
		? folders.find((folder) => folder.id === input.folderId)
		: undefined;
	const currentFolderId = activeFolder?.id ?? null;
	const missingFolderId =
		documentsQuery.isSuccess && input.folderId && !activeFolder
			? input.folderId
			: null;
	const visibleFolders = folders.filter(
		(folder) => parentFolderId(folder) === currentFolderId
	);
	const visibleDocuments = documents.filter(
		(document) => document.folderId === currentFolderId
	);
	const memberNames = new Map(
		(directoryQuery.data?.members ?? []).map((member) => [
			member.user.id,
			member.humanProfile?.profileName ?? member.user.name,
		])
	);
	const breadcrumb = activeFolder
		? resolveFolderBreadcrumb({ activeFolder, folders })
		: [];
	const {
		deleteDocumentMutation,
		deleteFolderMutation,
		moveDocument,
		moveFolder,
	} = useDocumentsPageMutations({
		activeFolder,
		onDocumentDeleted: () => setDocumentToDelete(null),
		onFolderDeleted: () => setFolderDialog({ kind: "closed" }),
	});
	const newDocumentPath = buildOrganizationNewDocumentPath({
		orgSlug: currentOrganization.slug,
	});
	const folderDialogKey =
		folderDialog.kind === "rename"
			? `rename-${folderDialog.folder.id}`
			: `${folderDialog.kind}-${currentFolderId ?? "root"}`;
	let contentStatus: "error" | "pending" | "ready" = "ready";
	if (documentsQuery.isPending) {
		contentStatus = "pending";
	} else if (documentsQuery.isError && documentsQuery.data === undefined) {
		contentStatus = "error";
	}

	return (
		<div className="grid gap-5">
			<DocumentsPageHeader
				breadcrumb={breadcrumb}
				canManage={canManage}
				isPersonal={currentOrganization.isPersonal === true}
				newDocumentPath={newDocumentPath}
				onMoveDocument={moveDocument}
				onMoveFolder={moveFolder}
				onNewFolder={() => setFolderDialog({ kind: "create" })}
				orgSlug={currentOrganization.slug}
			/>
			{breadcrumb.length === 0 ? <DocumentsComputerBridge /> : null}

			{documentsQuery.isRefetchError && documentsQuery.data ? (
				<output className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-card/35 px-4 py-3">
					<p className="text-muted-foreground text-sm">
						Couldn't refresh Documents. Showing the last saved view from this
						browser.
					</p>
					<Button
						disabled={documentsQuery.isFetching}
						onClick={() => documentsQuery.refetch()}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
				</output>
			) : null}

			<DocumentsPageContent
				activeFolder={activeFolder}
				canManage={canManage}
				documents={documents}
				folders={folders}
				memberNames={memberNames}
				missingFolderId={missingFolderId}
				newDocumentPath={newDocumentPath}
				onDeleteDocument={setDocumentToDelete}
				onDeleteFolder={(folder) => setFolderDialog({ folder, kind: "delete" })}
				onMoveDocument={moveDocument}
				onMoveFolder={moveFolder}
				onRenameFolder={(folder) => setFolderDialog({ folder, kind: "rename" })}
				onRetry={() => documentsQuery.refetch()}
				orgSlug={currentOrganization.slug}
				status={contentStatus}
				visibleDocuments={visibleDocuments}
				visibleFolders={visibleFolders}
			/>

			<FolderNameDialog
				dialog={folderDialog}
				key={folderDialogKey}
				onClose={() => setFolderDialog({ kind: "closed" })}
				organizationId={currentOrganization.id}
				parentFolderId={currentFolderId}
			/>
			<DeleteFolderDialog
				deleting={deleteFolderMutation.isPending}
				folder={folderDialog.kind === "delete" ? folderDialog.folder : null}
				folders={folders}
				onClose={() => setFolderDialog({ kind: "closed" })}
				onConfirm={(folderId) => deleteFolderMutation.mutate(folderId)}
			/>
			<DeleteDocumentDialog
				deleting={deleteDocumentMutation.isPending}
				document={documentToDelete}
				onClose={() => setDocumentToDelete(null)}
				onConfirm={(documentId) => deleteDocumentMutation.mutate(documentId)}
			/>
		</div>
	);
}

function DocumentsComputerBridge() {
	return (
		<section
			aria-labelledby="documents-computer-bridge-title"
			className="flex flex-wrap items-center justify-between gap-4 rounded-md border border-border/70 bg-card px-4 py-3"
		>
			<div className="flex min-w-0 items-start gap-3">
				<span className="grid size-9 shrink-0 place-items-center rounded-md border border-border/70 bg-background text-muted-foreground">
					<DesktopTowerIcon aria-hidden="true" className="size-4" />
				</span>
				<div className="min-w-0">
					<h2
						className="font-medium text-sm"
						id="documents-computer-bridge-title"
					>
						Shared with Center Agent
					</h2>
					<p className="mt-0.5 max-w-3xl text-muted-foreground text-sm leading-5">
						Approved Documents are available on its Computer. Proposed changes
						come back here as drafts, so your team reviews them before anything
						is replaced.
					</p>
				</div>
			</div>
			<Badge className="shrink-0" variant="outline">
				Stays in sync
			</Badge>
		</section>
	);
}

function DocumentsPageContent(input: {
	activeFolder: OrganizationDocumentFolder | undefined;
	canManage: boolean;
	documents: OrganizationDocumentSummary[];
	folders: OrganizationDocumentFolder[];
	memberNames: Map<string, string>;
	missingFolderId: string | null;
	newDocumentPath: string;
	onDeleteDocument: (document: OrganizationDocumentSummary) => void;
	onDeleteFolder: (folder: OrganizationDocumentFolder) => void;
	onMoveDocument: (documentId: string, folderId: string | null) => void;
	onMoveFolder: (folderId: string, parentFolderId: string | null) => void;
	onRenameFolder: (folder: OrganizationDocumentFolder) => void;
	onRetry: () => void;
	orgSlug: string;
	status: "error" | "pending" | "ready";
	visibleDocuments: OrganizationDocumentSummary[];
	visibleFolders: OrganizationDocumentFolder[];
}) {
	if (input.status === "pending") {
		return (
			<output
				aria-busy="true"
				aria-label="Loading documents"
				className={CARD_PICKER_GRID_CLASS_NAME}
			>
				<Skeleton className="h-40 w-full rounded-md" />
				<Skeleton className="h-40 w-full rounded-md" />
			</output>
		);
	}

	if (input.status === "error") {
		return (
			<div
				className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-4"
				role="alert"
			>
				<p className="text-destructive text-sm">
					OpenMeld could not load Organization documents. Try again.
				</p>
				<Button onClick={input.onRetry} size="sm" variant="outline">
					<ArrowClockwiseIcon aria-hidden="true" /> Retry
				</Button>
			</div>
		);
	}

	if (input.missingFolderId !== null) {
		return (
			<div className="grid justify-items-start gap-3 rounded-md border bg-card p-6">
				<h2 className="font-medium text-lg">Folder not found</h2>
				<p className="max-w-xl text-muted-foreground text-sm">
					If this folder was deleted, its direct contents were moved to the
					folder that contained it.
				</p>
				<Link
					className={buttonVariants({ variant: "outline" })}
					to={buildOrganizationDocumentsPath(input.orgSlug)}
				>
					Back to Documents
				</Link>
			</div>
		);
	}

	const hasItems =
		input.visibleFolders.length > 0 || input.visibleDocuments.length > 0;
	if (!hasItems) {
		return (
			<DocumentsEmptyState
				activeFolder={input.activeFolder}
				canManage={input.canManage}
				newDocumentPath={input.newDocumentPath}
			/>
		);
	}

	const currentFolderId = input.activeFolder?.id ?? null;
	const documentMoveTargets = resolveDocumentMoveTargets({
		currentFolderId,
		folders: input.folders,
	});

	return (
		<FluidCardGroup>
			<ul
				aria-label="Documents and folders"
				className={CARD_PICKER_GRID_CLASS_NAME}
			>
				{input.visibleFolders.map((folder) => (
					<li key={folder.id}>
						<FluidCardItem itemId={`folder:${folder.id}`}>
							<OrganizationDocumentFolderCard
								canManage={input.canManage}
								folder={folder}
								itemCount={resolveDirectItemCount({
									documents: input.documents,
									folderId: folder.id,
									folders: input.folders,
								})}
								moveTargets={resolveFolderMoveTargets({
									folder,
									folders: input.folders,
								})}
								onDelete={() => input.onDeleteFolder(folder)}
								onDropDocument={(documentId) =>
									input.onMoveDocument(documentId, folder.id)
								}
								onDropFolder={(folderId) => {
									if (folderId !== folder.id) {
										input.onMoveFolder(folderId, folder.id);
									}
								}}
								onMove={(parentId) => input.onMoveFolder(folder.id, parentId)}
								onRename={() => input.onRenameFolder(folder)}
								orgSlug={input.orgSlug}
							/>
						</FluidCardItem>
					</li>
				))}
				{input.visibleDocuments.map((document) => (
					<li key={document.id}>
						<FluidCardItem itemId={`document:${document.id}`}>
							<OrganizationDocumentFileCard
								canManage={input.canManage}
								document={document}
								memberName={
									document.subjectUserId
										? input.memberNames.get(document.subjectUserId)
										: undefined
								}
								moveTargets={documentMoveTargets}
								onDelete={() => input.onDeleteDocument(document)}
								onMove={(folderId) =>
									input.onMoveDocument(document.id, folderId)
								}
								orgSlug={input.orgSlug}
							/>
						</FluidCardItem>
					</li>
				))}
			</ul>
		</FluidCardGroup>
	);
}

function DocumentsEmptyState(input: {
	activeFolder: OrganizationDocumentFolder | undefined;
	canManage: boolean;
	newDocumentPath: string;
}) {
	const inFolder = input.activeFolder !== undefined;
	return (
		<section className="grid min-h-64 place-items-center rounded-md border border-border/70 border-dashed bg-card/25 p-8 text-center">
			<div>
				<span className="mx-auto grid size-10 place-items-center rounded-md border border-border/70 bg-background/45 text-muted-foreground">
					{inFolder ? (
						<FolderIcon aria-hidden="true" className="size-5" />
					) : (
						<FileTextIcon aria-hidden="true" className="size-5" />
					)}
				</span>
				<h2 className="mt-3 font-medium text-lg">
					{inFolder ? "This folder is empty" : "No documents yet"}
				</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					{inFolder
						? "Create a folder or document here to build out this workspace."
						: "Start with an Organization Brief or add shared knowledge."}
				</p>
				{input.canManage ? (
					<Link
						className={cn(buttonVariants({ size: "sm" }), "mt-4")}
						search={input.activeFolder ? { folder: input.activeFolder.id } : {}}
						to={input.newDocumentPath}
					>
						Create a document
					</Link>
				) : null}
			</div>
		</section>
	);
}

function useDocumentsPageMutations(options: {
	activeFolder: OrganizationDocumentFolder | undefined;
	onDocumentDeleted: () => void;
	onFolderDeleted: () => void;
}) {
	const { currentOrganization } = useAppOrganization();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const refreshList = async () => {
		await queryClient.invalidateQueries({
			queryKey: organizationDocumentQueryKeys.list(currentOrganization.id),
		});
	};
	const onMutationError = (error: unknown) => {
		toast.error(resolveOrganizationDocumentErrorMessage(error));
	};
	const moveDocumentMutation = useMutation({
		mutationFn: async (move: { documentId: string; folderId: string | null }) =>
			await moveCurrentOrganizationDocument({
				...move,
				expectedOrganizationId: currentOrganization.id,
			}),
		onError: onMutationError,
		onSuccess: refreshList,
	});
	const moveFolderMutation = useMutation({
		mutationFn: async (move: {
			folderId: string;
			parentFolderId: string | null;
		}) =>
			await moveCurrentOrganizationDocumentFolder({
				...move,
				expectedOrganizationId: currentOrganization.id,
			}),
		onError: onMutationError,
		onSuccess: refreshList,
	});
	const deleteFolderMutation = useMutation({
		mutationFn: async (folderId: string) =>
			await deleteCurrentOrganizationDocumentFolder({
				expectedOrganizationId: currentOrganization.id,
				folderId,
			}),
		onError: onMutationError,
		onSuccess: async (_response, folderId) => {
			options.onFolderDeleted();
			await refreshList();
			if (options.activeFolder?.id === folderId) {
				const parentId = parentFolderId(options.activeFolder);
				await navigate({
					search: parentId ? { folder: parentId } : {},
					to: buildOrganizationDocumentsPath(currentOrganization.slug),
				});
			}
		},
	});
	const deleteDocumentMutation = useMutation({
		mutationFn: async (documentId: string) =>
			await deleteCurrentOrganizationDocument({
				documentId,
				expectedOrganizationId: currentOrganization.id,
			}),
		onError: onMutationError,
		onSuccess: async () => {
			options.onDocumentDeleted();
			await refreshList();
		},
	});

	return {
		deleteDocumentMutation,
		deleteFolderMutation,
		moveDocument: (documentId: string, folderId: string | null) =>
			moveDocumentMutation.mutate({ documentId, folderId }),
		moveFolder: (folderId: string, parentFolderId: string | null) =>
			moveFolderMutation.mutate({ folderId, parentFolderId }),
	};
}

function DocumentsPageHeader(input: {
	breadcrumb: OrganizationDocumentFolder[];
	canManage: boolean;
	isPersonal: boolean;
	newDocumentPath: string;
	onMoveDocument: (documentId: string, folderId: string | null) => void;
	onMoveFolder: (folderId: string, parentFolderId: string | null) => void;
	onNewFolder: () => void;
	orgSlug: string;
}) {
	const activeFolder = input.breadcrumb.at(-1);
	return (
		<header className="flex flex-wrap items-end justify-between gap-3">
			<div className="min-w-0">
				<p className="font-medium text-muted-foreground text-xs">
					{input.isPersonal ? "Personal workspace" : "Organization"}
				</p>
				{activeFolder ? (
					<FolderBreadcrumb {...input} />
				) : (
					<>
						<h1 className="font-medium text-2xl">Documents</h1>
						<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
							Your Organization’s shared source of truth for people and agents.
						</p>
					</>
				)}
			</div>
			{input.canManage ? (
				<div className="flex flex-wrap items-center gap-2">
					<Button onClick={input.onNewFolder} size="sm" variant="outline">
						<FolderPlusIcon aria-hidden="true" /> New folder
					</Button>
					<Link
						className={buttonVariants({ size: "sm" })}
						search={activeFolder ? { folder: activeFolder.id } : {}}
						to={input.newDocumentPath}
					>
						<PlusIcon aria-hidden="true" /> New document
					</Link>
				</div>
			) : null}
		</header>
	);
}

function FolderBreadcrumb(input: {
	breadcrumb: OrganizationDocumentFolder[];
	canManage: boolean;
	onMoveDocument: (documentId: string, folderId: string | null) => void;
	onMoveFolder: (folderId: string, parentFolderId: string | null) => void;
	orgSlug: string;
}) {
	const activeFolder = input.breadcrumb.at(-1);
	return (
		<nav aria-label="Folder path" className="mt-0.5">
			<h1 className="flex min-w-0 flex-wrap items-center gap-1.5 font-medium text-2xl">
				<BreadcrumbLink
					canManage={input.canManage}
					label="Documents"
					onDropDocument={(documentId) =>
						input.onMoveDocument(documentId, null)
					}
					onDropFolder={(folderId) => input.onMoveFolder(folderId, null)}
					orgSlug={input.orgSlug}
					targetFolderId={null}
				/>
				{input.breadcrumb.map((folder) => {
					const isActive = folder.id === activeFolder?.id;
					return (
						<span className="contents" key={folder.id}>
							<CaretRightIcon
								aria-hidden="true"
								className="size-4 shrink-0 text-muted-foreground"
							/>
							{isActive ? (
								<span className="inline-flex min-w-0 items-center gap-2">
									<FolderIcon
										aria-hidden="true"
										className="size-5 shrink-0 text-muted-foreground"
									/>
									<span className="truncate">{folder.name}</span>
								</span>
							) : (
								<BreadcrumbLink
									canManage={input.canManage}
									label={folder.name}
									onDropDocument={(documentId) =>
										input.onMoveDocument(documentId, folder.id)
									}
									onDropFolder={(folderId) =>
										input.onMoveFolder(folderId, folder.id)
									}
									orgSlug={input.orgSlug}
									targetFolderId={folder.id}
								/>
							)}
						</span>
					);
				})}
			</h1>
		</nav>
	);
}

function BreadcrumbLink(input: {
	canManage: boolean;
	label: string;
	onDropDocument: (documentId: string) => void;
	onDropFolder: (folderId: string) => void;
	orgSlug: string;
	targetFolderId: string | null;
}) {
	const [dropActive, setDropActive] = useState(false);
	const dropProps = input.canManage
		? browserItemDropProps({
				onDropDocument: input.onDropDocument,
				onDropFolder: input.onDropFolder,
				setDropActive,
			})
		: {};
	return (
		<Link
			className={cn(
				"rounded-sm text-muted-foreground transition-colors hover:text-foreground",
				dropActive && "bg-primary/10 text-foreground ring-1 ring-primary/40"
			)}
			search={input.targetFolderId ? { folder: input.targetFolderId } : {}}
			to={buildOrganizationDocumentsPath(input.orgSlug)}
			{...dropProps}
		>
			{input.label}
		</Link>
	);
}

function DeleteFolderDialog(input: {
	deleting: boolean;
	folder: OrganizationDocumentFolder | null;
	folders: OrganizationDocumentFolder[];
	onClose: () => void;
	onConfirm: (folderId: string) => void;
}) {
	const parentId = input.folder ? parentFolderId(input.folder) : null;
	const destination = parentId
		? (input.folders.find((folder) => folder.id === parentId)?.name ??
			"its parent folder")
		: "Documents";
	return (
		<AlertDialog
			onOpenChange={(open) => {
				if (!open) {
					input.onClose();
				}
			}}
			open={input.folder !== null}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						Delete {input.folder?.name ?? "this folder"}?
					</AlertDialogTitle>
					<AlertDialogDescription>
						Items directly inside this folder move to {destination}. Nested
						folders keep their contents. No document content is deleted.
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={input.deleting}>
						Cancel
					</AlertDialogCancel>
					<AlertDialogAction
						disabled={input.deleting}
						onClick={() => {
							if (input.folder) {
								input.onConfirm(input.folder.id);
							}
						}}
					>
						{input.deleting ? "Deleting…" : "Delete folder"}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}

function DeleteDocumentDialog(input: {
	deleting: boolean;
	document: OrganizationDocumentSummary | null;
	onClose: () => void;
	onConfirm: (documentId: string) => void;
}) {
	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					input.onClose();
				}
			}}
			open={input.document !== null}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Delete {input.document?.title}?</DialogTitle>
				</DialogHeader>
				<p className="text-muted-foreground text-sm">
					This permanently deletes the approved content and any pending draft.
				</p>
				<DialogFooter>
					<Button
						disabled={input.deleting}
						onClick={input.onClose}
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={input.deleting}
						onClick={() => {
							if (input.document) {
								input.onConfirm(input.document.id);
							}
						}}
						variant="destructive"
					>
						{input.deleting ? "Deleting…" : "Delete document"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function FolderNameDialog(input: {
	dialog: FolderDialogState;
	onClose: () => void;
	organizationId: string;
	parentFolderId: string | null;
}) {
	const queryClient = useQueryClient();
	const open = input.dialog.kind === "create" || input.dialog.kind === "rename";
	const renameTarget =
		input.dialog.kind === "rename" ? input.dialog.folder : null;
	const [name, setName] = useState(renameTarget?.name ?? "");
	const saveMutation = useMutation({
		mutationFn: async () =>
			renameTarget
				? await renameCurrentOrganizationDocumentFolder({
						expectedOrganizationId: input.organizationId,
						folderId: renameTarget.id,
						name: name.trim(),
					})
				: await createCurrentOrganizationDocumentFolder({
						expectedOrganizationId: input.organizationId,
						name: name.trim(),
						parentFolderId: input.parentFolderId,
					}),
		onError: (error) => {
			toast.error(resolveOrganizationDocumentErrorMessage(error));
		},
		onSuccess: async () => {
			input.onClose();
			await queryClient.invalidateQueries({
				queryKey: organizationDocumentQueryKeys.list(input.organizationId),
			});
		},
	});
	const invalidName = name.trim().length === 0 || name.trim().length > 200;
	const actionLabel = renameTarget ? "Rename folder" : "Create folder";

	return (
		<Dialog
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					input.onClose();
				}
			}}
			open={open}
		>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{renameTarget ? `Rename ${renameTarget.name}` : "New folder"}
					</DialogTitle>
				</DialogHeader>
				<form
					className="grid gap-2"
					onSubmit={(event) => {
						event.preventDefault();
						if (!(invalidName || saveMutation.isPending)) {
							saveMutation.mutate();
						}
					}}
				>
					<Label htmlFor="organization-document-folder-name">Name</Label>
					<Input
						autoFocus
						disabled={saveMutation.isPending}
						id="organization-document-folder-name"
						maxLength={200}
						onChange={(event) => setName(event.target.value)}
						placeholder="Team playbooks"
						value={name}
					/>
				</form>
				<DialogFooter>
					<Button
						disabled={saveMutation.isPending}
						onClick={input.onClose}
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={invalidName || saveMutation.isPending}
						onClick={() => saveMutation.mutate()}
					>
						{saveMutation.isPending ? "Saving…" : actionLabel}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
