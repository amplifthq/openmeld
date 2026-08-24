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
import { APP_INLINE_BACK_LINK_CLASS_NAME } from "#/components/app/app-inline-navigation";
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
import { invalidateInboxFacts } from "#/query/organizations/inbox";
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
	const documentFolderSearch = resolveDocumentFolderSearch(document?.folderId);
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
			invalidateInboxFacts({
				organizationId: currentOrganization.id,
				queryClient,
			}),
		]);
	};
	const saveMutation = useMutation({
		mutationFn: async (payload: { content: string; title?: string }) => {
			if (!document) {
				throw new Error("The document is no longer loaded.");
			}
			return await updateCurrentOrganizationDocument({
				content: payload.content,
				documentId: input.documentId,
				expectedDocumentUpdatedAt: document.updatedAt,
				expectedDraftCreatedAt: document.draftCreatedAt,
				expectedOrganizationId: currentOrganization.id,
				...(payload.title === undefined ? {} : { title: payload.title }),
			});
		},
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
	const isProfileReport = document?.kind === "member_profile";
	const profileReportNeedsSave = isPendingProfileReportSave(document);
	const showingDraft = resolveShowingDraft({
		hasDraft: hasDraft && !isProfileReport,
		reviewView,
	});
	const editFormPresentation = resolveDocumentEditFormPresentation(
		document,
		profileReportNeedsSave,
		editorEpoch
	);

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
				className={APP_INLINE_BACK_LINK_CLASS_NAME}
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
						<DocumentDraftStatusBadge
							hasDraft={hasDraft}
							isProfileReport={isProfileReport}
						/>
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

			<DocumentDraftPresentation
				disabled={reviewPending || saveMutation.isPending}
				document={document}
				hasDraft={hasDraft}
				onApprove={() => approveMutation.mutate()}
				onDiscard={() => discardMutation.mutate()}
				onToggleView={() => setReviewView(showingDraft ? "approved" : "draft")}
				showingDraft={showingDraft}
			/>

			{/* Ordinary review drafts keep both surfaces mounted so switching views
			    never drops unsaved approved edits. A Profile Report is one editable
			    working document, even when its latest Center Agent version still uses
			    the legacy draft fields. The inactive review surface is hidden.
			    min-w-0 keeps wide
			    document content scrolling inside the editor instead of stretching
			    the page grid past the layout width. */}
			<div className={cn("min-w-0", showingDraft ? "hidden" : null)}>
				<DocumentEditForm
					disabled={reviewPending}
					document={document}
					initialContent={
						editFormPresentation?.initialContent ?? document.content
					}
					key={editFormPresentation?.key ?? document.id}
					onSave={async (payload) => {
						setErrorMessage(null);
						await saveMutation.mutateAsync(payload);
					}}
					requiresInitialSave={
						editFormPresentation?.requiresInitialSave ?? false
					}
					saving={saveMutation.isPending}
				/>
			</div>
			{document.draftContent === null || isProfileReport ? null : (
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
	initialContent: string;
	onSave: (payload: { content: string; title?: string }) => Promise<void>;
	requiresInitialSave: boolean;
	saving: boolean;
}) {
	const { document } = input;
	const canEditTitle = document.canManage && document.kind === "knowledge";
	const [title, setTitle] = useState(document.title);
	const [content, setContent] = useState(input.initialContent);
	const [savedTitle, setSavedTitle] = useState(document.title);
	const [savedContent, setSavedContent] = useState(input.initialContent);
	const [requiresInitialSave, setRequiresInitialSave] = useState(
		input.requiresInitialSave
	);
	const contentOverLimit =
		content.length > ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS;
	const unchanged = content === savedContent && title === savedTitle;
	const hasUnsavedChanges = requiresInitialSave || !unchanged;
	const save = async (): Promise<boolean> => {
		if (
			input.disabled ||
			input.saving ||
			!hasUnsavedChanges ||
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
			setRequiresInitialSave(false);
			return true;
		} catch {
			return false;
		}
	};

	return (
		<div className="grid gap-6">
			<UnsavedChangesGuard
				description="Your changes to this document haven't been saved."
				hasUnsavedChanges={hasUnsavedChanges}
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
							!hasUnsavedChanges ||
							contentOverLimit ||
							(canEditTitle && title.trim().length === 0)
						}
						onClick={save}
					>
						{resolveDocumentSaveLabel(document, input.saving)}
					</Button>
				</div>
			) : null}
		</div>
	);
}

function resolveDocumentEditFormPresentation(
	document: OrganizationDocument | undefined,
	profileReportNeedsSave: boolean,
	editorEpoch: number
): {
	initialContent: string;
	key: string;
	requiresInitialSave: boolean;
} | null {
	if (!document) {
		return null;
	}
	const initialContent =
		profileReportNeedsSave && document.draftContent !== null
			? document.draftContent
			: document.content;
	const version =
		document.kind === "member_profile"
			? (document.draftCreatedAt ?? document.updatedAt)
			: document.updatedAt;
	return {
		initialContent,
		key: `${document.id}:${editorEpoch}:${version}`,
		requiresInitialSave: profileReportNeedsSave,
	};
}

function resolveDocumentFolderSearch(folderId: string | null | undefined): {
	folder?: string;
} {
	return folderId ? { folder: folderId } : {};
}

function resolveDocumentSaveLabel(
	document: OrganizationDocument,
	saving: boolean
): string {
	if (saving) {
		return "Saving…";
	}
	return document.kind === "member_profile"
		? "Save changes"
		: "Save approved content";
}

function ignoreDraftChange() {
	// The draft surface is read-only; Plate still requires an onChange handler.
}

function resolveShowingDraft(input: {
	hasDraft: boolean;
	reviewView: "approved" | "draft";
}): boolean {
	return input.hasDraft && input.reviewView === "draft";
}

function isPendingProfileReportSave(
	document: OrganizationDocument | undefined
): boolean {
	return document?.kind === "member_profile" && document.draftContent !== null;
}

function DocumentDraftStatusBadge(input: {
	hasDraft: boolean;
	isProfileReport: boolean;
}) {
	if (!(input.hasDraft && !input.isProfileReport)) {
		return null;
	}
	return (
		<Badge className={resolveStatusToneBadgeClassName("warning")}>
			Draft waiting for review
		</Badge>
	);
}

function DocumentDraftPresentation(input: {
	disabled: boolean;
	document: OrganizationDocument;
	hasDraft: boolean;
	onApprove: () => void;
	onDiscard: () => void;
	onToggleView: () => void;
	showingDraft: boolean;
}) {
	if (input.document.kind === "member_profile") {
		return <ProfileReportLearningNote needsSave={input.hasDraft} />;
	}
	if (!input.hasDraft) {
		return null;
	}
	return (
		<DocumentDraftReviewBar
			disabled={input.disabled}
			document={input.document}
			onApprove={input.onApprove}
			onDiscard={input.onDiscard}
			onToggleView={input.onToggleView}
			showingDraft={input.showingDraft}
		/>
	);
}

function ProfileReportLearningNote(input: { needsSave: boolean }) {
	return (
		<section
			aria-labelledby="profile-report-learning-heading"
			className="rounded-md border bg-muted/20 p-4"
		>
			<h2 className="font-medium text-lg" id="profile-report-learning-heading">
				What your Center Agent has learned so far
			</h2>
			<p className="mt-1 text-muted-foreground text-sm">
				{input.needsSave
					? "Your Center Agent updated this Profile Report. Review it, make any changes you need, then save it."
					: "Your Center Agent will update this Profile Report as it learns more about your work. If anything feels off, tell your Center Agent."}
			</p>
		</section>
	);
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
