"use client";

import type { OrganizationDocument } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	resolveStatusToneBadgeClassName,
	resolveStatusToneSurfaceClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowClockwiseIcon,
	ArrowLeftIcon,
	CheckIcon,
	TrashIcon,
	XIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { UnsavedChangesGuard } from "#/components/forms/unsaved-changes-guard";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	approveCurrentOrganizationDocumentDraft,
	deleteCurrentOrganizationDocument,
	discardCurrentOrganizationDocumentDraft,
	resolveOrganizationDocumentErrorMessage,
	updateCurrentOrganizationDocument,
} from "#/lib/organizations/organization-documents";
import { buildOrganizationDocumentsPath } from "#/lib/organizations/organization-routes";
import {
	organizationDocumentQueryKeys,
	organizationDocumentQueryOptions,
} from "#/query/organizations/organization-documents";
import {
	ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS,
	OrganizationDocumentMarkdownEditor,
} from "./organization-document-markdown-editor";

export function OrganizationDocumentDetailPage(input: { documentId: string }) {
	const { currentOrganization } = useAppOrganization();
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const documentQuery = useQuery(
		organizationDocumentQueryOptions({
			documentId: input.documentId,
			organizationId: currentOrganization.id,
		})
	);
	const document = documentQuery.data?.document;
	const documentFolderSearch = document?.folderId
		? { folder: document.folderId }
		: {};
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [editorEpoch, setEditorEpoch] = useState(0);
	// While a Center Agent draft is pending the one editor surface shows either
	// the read-only proposed draft or the editable approved document.
	const [reviewView, setReviewView] = useState<"draft" | "approved">("draft");
	const refresh = async () => {
		await Promise.all([
			queryClient.invalidateQueries({
				queryKey: organizationDocumentQueryKeys.detail(
					currentOrganization.id,
					input.documentId
				),
			}),
			queryClient.invalidateQueries({
				queryKey: organizationDocumentQueryKeys.list(currentOrganization.id),
			}),
		]);
	};
	const saveMutation = useMutation({
		mutationFn: async (payload: { content: string; title?: string }) =>
			await updateCurrentOrganizationDocument({
				content: payload.content,
				documentId: input.documentId,
				expectedOrganizationId: currentOrganization.id,
				...(payload.title === undefined ? {} : { title: payload.title }),
			}),
		onError: (error) =>
			setErrorMessage(resolveOrganizationDocumentErrorMessage(error)),
		onSuccess: refresh,
	});
	const approveMutation = useMutation({
		mutationFn: async () => {
			if (!document?.draftCreatedAt) {
				throw new Error("The pending draft is missing its review version.");
			}
			return await approveCurrentOrganizationDocumentDraft({
				documentId: input.documentId,
				expectedDraftCreatedAt: document.draftCreatedAt,
				expectedOrganizationId: currentOrganization.id,
			});
		},
		onError: (error) =>
			setErrorMessage(resolveOrganizationDocumentErrorMessage(error)),
		onSuccess: async () => {
			// Approval replaces the approved content, so remount the editor with
			// the fresh document instead of keeping stale editor state.
			setEditorEpoch((epoch) => epoch + 1);
			setReviewView("draft");
			await refresh();
		},
	});
	const discardMutation = useMutation({
		mutationFn: async () => {
			if (!document?.draftCreatedAt) {
				throw new Error("The pending draft is missing its review version.");
			}
			return await discardCurrentOrganizationDocumentDraft({
				documentId: input.documentId,
				expectedDraftCreatedAt: document.draftCreatedAt,
				expectedOrganizationId: currentOrganization.id,
			});
		},
		onError: (error) =>
			setErrorMessage(resolveOrganizationDocumentErrorMessage(error)),
		onSuccess: async () => {
			setReviewView("draft");
			await refresh();
		},
	});
	const deleteMutation = useMutation({
		mutationFn: async () =>
			await deleteCurrentOrganizationDocument({
				documentId: input.documentId,
				expectedOrganizationId: currentOrganization.id,
			}),
		onError: (error) =>
			setErrorMessage(resolveOrganizationDocumentErrorMessage(error)),
		onSuccess: async () => {
			setDeleteOpen(false);
			await queryClient.invalidateQueries({
				queryKey: organizationDocumentQueryKeys.list(currentOrganization.id),
			});
			await navigate({
				search: documentFolderSearch,
				to: buildOrganizationDocumentsPath(currentOrganization.slug),
			});
		},
	});
	const reviewPending =
		approveMutation.isPending ||
		discardMutation.isPending ||
		deleteMutation.isPending;
	const hasDraft = document !== undefined && document.draftContent !== null;
	const showingDraft = hasDraft && reviewView === "draft";

	if (documentQuery.isPending) {
		return (
			<div className="grid gap-4">
				<Skeleton className="h-7 w-52" />
				<Skeleton className="h-96 w-full" />
			</div>
		);
	}
	if (documentQuery.isError) {
		return (
			<div className="grid justify-items-start gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-6">
				<h1 className="font-medium text-xl">Could not load document</h1>
				<p className="text-muted-foreground text-sm">
					OpenMeld could not load this Organization document. Try again.
				</p>
				<Button onClick={() => documentQuery.refetch()} variant="outline">
					<ArrowClockwiseIcon aria-hidden="true" /> Retry
				</Button>
			</div>
		);
	}
	if (!document) {
		return (
			<div className="grid justify-items-start gap-3 rounded-md border p-6">
				<h1 className="font-medium text-xl">Document not found</h1>
				<p className="text-muted-foreground text-sm">
					This document may have been deleted or belongs to another
					Organization.
				</p>
				<Link
					className={buttonVariants({ variant: "outline" })}
					to={buildOrganizationDocumentsPath(currentOrganization.slug)}
				>
					<ArrowLeftIcon aria-hidden="true" /> All Documents
				</Link>
			</div>
		);
	}

	return (
		<div className="grid gap-6">
			<Link
				className="inline-flex items-center gap-2 justify-self-start font-medium text-muted-foreground text-sm hover:text-foreground"
				search={documentFolderSearch}
				to={buildOrganizationDocumentsPath(currentOrganization.slug)}
			>
				<ArrowLeftIcon aria-hidden="true" /> Back to Documents
			</Link>
			<header className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="flex flex-wrap items-center gap-2">
						<p className="font-medium text-muted-foreground text-xs">
							{organizationDocumentKindLabel(document.kind)}
						</p>
						{hasDraft ? (
							<Badge className={resolveStatusToneBadgeClassName("warning")}>
								Draft waiting for review
							</Badge>
						) : null}
					</div>
					<h1 className="mt-1 break-words font-medium text-2xl">
						{document.title}
					</h1>
				</div>
				{document.canManage ? (
					<Button
						disabled={reviewPending || saveMutation.isPending}
						onClick={() => setDeleteOpen(true)}
						variant="outline"
					>
						<TrashIcon aria-hidden="true" /> Delete
					</Button>
				) : null}
			</header>

			{hasDraft ? (
				<DocumentDraftReviewBar
					disabled={reviewPending || saveMutation.isPending}
					document={document}
					onApprove={() => approveMutation.mutate()}
					onDiscard={() => discardMutation.mutate()}
					onToggleView={() =>
						setReviewView(showingDraft ? "approved" : "draft")
					}
					showingDraft={showingDraft}
				/>
			) : null}

			{/* Both surfaces stay mounted so switching views never drops unsaved
			    approved edits; the inactive one is hidden. min-w-0 keeps wide
			    document content scrolling inside the editor instead of stretching
			    the page grid past the layout width. */}
			<div className={cn("min-w-0", showingDraft ? "hidden" : null)}>
				<DocumentEditForm
					disabled={reviewPending}
					document={document}
					key={`${document.id}:${editorEpoch}`}
					onSave={async (payload) => {
						setErrorMessage(null);
						await saveMutation.mutateAsync(payload);
					}}
					saving={saveMutation.isPending}
				/>
			</div>
			{document.draftContent === null ? null : (
				<div className={cn("min-w-0", showingDraft ? null : "hidden")}>
					<OrganizationDocumentMarkdownEditor
						ariaLabel="Center Agent draft content"
						disabled
						key={`${document.id}:${document.draftCreatedAt ?? "draft"}`}
						onChange={ignoreDraftChange}
						value={document.draftContent}
					/>
				</div>
			)}
			{errorMessage ? (
				<p className="text-destructive text-sm" role="alert">
					{errorMessage}
				</p>
			) : null}
			<Dialog onOpenChange={setDeleteOpen} open={deleteOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Delete {document.title}?</DialogTitle>
						<DialogDescription>
							This permanently deletes the approved content and any pending
							draft.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button
							disabled={deleteMutation.isPending}
							onClick={() => setDeleteOpen(false)}
							variant="outline"
						>
							Cancel
						</Button>
						<Button
							disabled={deleteMutation.isPending}
							onClick={() => {
								setErrorMessage(null);
								deleteMutation.mutate();
							}}
							variant="destructive"
						>
							{deleteMutation.isPending ? "Deleting…" : "Delete document"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function DocumentEditForm(input: {
	disabled: boolean;
	document: OrganizationDocument;
	onSave: (payload: { content: string; title?: string }) => Promise<void>;
	saving: boolean;
}) {
	const { document } = input;
	const canEditTitle = document.canManage && document.kind === "knowledge";
	const [title, setTitle] = useState(document.title);
	const [content, setContent] = useState(document.content);
	const [savedTitle, setSavedTitle] = useState(document.title);
	const [savedContent, setSavedContent] = useState(document.content);
	const contentOverLimit =
		content.length > ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS;
	const unchanged = content === savedContent && title === savedTitle;
	const save = async (): Promise<boolean> => {
		if (
			input.disabled ||
			input.saving ||
			unchanged ||
			contentOverLimit ||
			(canEditTitle && title.trim().length === 0)
		) {
			return false;
		}
		try {
			await input.onSave({
				content,
				...(canEditTitle ? { title } : {}),
			});
			setSavedContent(content);
			setSavedTitle(title);
			return true;
		} catch {
			return false;
		}
	};

	return (
		<div className="grid gap-6">
			<UnsavedChangesGuard
				description="Your changes to this document haven't been saved."
				hasUnsavedChanges={!unchanged}
				onSave={save}
				saving={input.saving}
			/>
			{canEditTitle ? (
				<div className="grid max-w-xl gap-2">
					<Label htmlFor="organization-document-title">Title</Label>
					<Input
						disabled={input.disabled || input.saving}
						id="organization-document-title"
						maxLength={200}
						onChange={(event) => setTitle(event.target.value)}
						value={title}
					/>
				</div>
			) : null}
			<OrganizationDocumentMarkdownEditor
				ariaLabel="Document content"
				disabled={!document.canEditContent || input.disabled || input.saving}
				onChange={setContent}
				value={content}
			/>
			{document.canEditContent ? (
				<div className="flex justify-end border-t pt-4">
					<Button
						disabled={
							input.disabled ||
							input.saving ||
							unchanged ||
							contentOverLimit ||
							(canEditTitle && title.trim().length === 0)
						}
						onClick={save}
					>
						{input.saving ? "Saving…" : "Save approved content"}
					</Button>
				</div>
			) : null}
		</div>
	);
}

function ignoreDraftChange() {
	// The draft surface is read-only; Plate still requires an onChange handler.
}

function DocumentDraftReviewBar(input: {
	disabled: boolean;
	document: OrganizationDocument;
	onApprove: () => void;
	onDiscard: () => void;
	onToggleView: () => void;
	showingDraft: boolean;
}) {
	return (
		<section
			aria-labelledby="document-draft-heading"
			className={cn(
				"flex min-w-0 flex-wrap items-start justify-between gap-3 rounded-md border p-4",
				resolveStatusToneSurfaceClassName("warning")
			)}
		>
			<div className="min-w-0">
				<h2 className="font-medium text-lg" id="document-draft-heading">
					Center Agent draft
				</h2>
				<p className="mt-1 text-muted-foreground text-sm">
					{input.showingDraft
						? "You're reading the proposed draft. The approved document stays unchanged until you approve it."
						: "You're viewing the approved document. This draft is still waiting for review."}
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<Button onClick={input.onToggleView} variant="ghost">
					{input.showingDraft ? "View approved" : "View draft"}
				</Button>
				{input.document.canManage ? (
					<>
						<Button
							disabled={input.disabled}
							onClick={input.onDiscard}
							variant="outline"
						>
							<XIcon aria-hidden="true" /> Discard
						</Button>
						<Button disabled={input.disabled} onClick={input.onApprove}>
							<CheckIcon aria-hidden="true" /> Approve draft
						</Button>
					</>
				) : null}
			</div>
		</section>
	);
}

function organizationDocumentKindLabel(
	kind: OrganizationDocument["kind"]
): string {
	switch (kind) {
		case "brief":
			return "Organization Brief";
		case "member_profile":
			return "Profile Report";
		default:
			return "Knowledge";
	}
}
