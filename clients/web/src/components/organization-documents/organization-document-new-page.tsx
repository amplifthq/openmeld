"use client";

import type {
	OrganizationDirectoryResponse,
	OrganizationDocumentKind,
} from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { APP_INLINE_BACK_LINK_CLASS_NAME } from "#/components/app/app-inline-navigation";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	createCurrentOrganizationDocument,
	resolveOrganizationDocumentErrorMessage,
} from "#/lib/organizations/organization-documents";
import {
	buildOrganizationDocumentPath,
	buildOrganizationDocumentsPath,
} from "#/lib/organizations/organization-routes";
import { organizationDirectoryQueryOptions } from "#/query/organizations/organization-directory";
import {
	organizationDocumentQueryKeys,
	organizationDocumentsQueryOptions,
} from "#/query/organizations/organization-documents";
import {
	ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS,
	OrganizationDocumentMarkdownEditor,
} from "./organization-document-markdown-editor";

const KIND_OPTIONS = [
	{ label: "Knowledge", value: "knowledge" },
	{ label: "Profile Report", value: "member_profile" },
	{ label: "Organization Brief", value: "brief" },
] as const;

export function OrganizationDocumentNewPage(input: {
	initialFolderId?: string;
	initialKind?: OrganizationDocumentKind;
	initialSubjectUserId?: string;
}) {
	const { currentOrganization } = useAppOrganization();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
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
	const [kind, setKind] = useState<OrganizationDocumentKind>(
		input.initialKind ?? "knowledge"
	);
	const [subjectUserId, setSubjectUserId] = useState(
		input.initialSubjectUserId ?? ""
	);
	const [title, setTitle] = useState("");
	const [content, setContent] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const canCreate = documentsQuery.data?.canManage === true;
	const createMutation = useMutation({
		mutationFn: async () =>
			await createCurrentOrganizationDocument({
				content,
				expectedOrganizationId: currentOrganization.id,
				kind,
				...(input.initialFolderId ? { folderId: input.initialFolderId } : {}),
				...(kind === "member_profile" ? { subjectUserId } : {}),
				...(kind === "knowledge" ? { title } : {}),
			}),
		onError: (error) => {
			setErrorMessage(resolveOrganizationDocumentErrorMessage(error));
		},
		onSuccess: async (response) => {
			await queryClient.invalidateQueries({
				queryKey: organizationDocumentQueryKeys.list(currentOrganization.id),
			});
			await navigate({
				to: buildOrganizationDocumentPath({
					documentId: response.document.id,
					orgSlug: currentOrganization.slug,
				}),
			});
		},
	});
	const validTarget =
		(kind !== "knowledge" || title.trim().length > 0) &&
		(kind !== "member_profile" || subjectUserId.length > 0) &&
		content.length <= ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS;
	const folderSearch = input.initialFolderId
		? { folder: input.initialFolderId }
		: {};

	return (
		<div className="grid gap-6">
			<Link
				className={APP_INLINE_BACK_LINK_CLASS_NAME}
				search={folderSearch}
				to={buildOrganizationDocumentsPath(currentOrganization.slug)}
			>
				<ArrowLeftIcon aria-hidden="true" /> Back to Documents
			</Link>
			<header>
				<p className="font-medium text-muted-foreground text-xs">Documents</p>
				<h1 className="font-medium text-2xl">New document</h1>
				<p className="mt-1 text-muted-foreground text-sm">
					Create approved Markdown content. Center Agent proposals will appear
					separately as drafts.
				</p>
			</header>

			<DocumentTargetFields
				canManage={documentsQuery.data?.canManage === true}
				disabled={createMutation.isPending}
				initialSubjectUserId={input.initialSubjectUserId}
				kind={kind}
				members={directoryQuery.data?.members ?? []}
				onKindChange={setKind}
				onSubjectUserIdChange={setSubjectUserId}
				onTitleChange={setTitle}
				subjectUserId={subjectUserId}
				title={title}
			/>

			<OrganizationDocumentMarkdownEditor
				disabled={createMutation.isPending || !canCreate}
				onChange={setContent}
				value={content}
			/>
			{documentsQuery.isSuccess && !canCreate ? (
				<p className="text-destructive text-sm" role="alert">
					Only Organization owners and admins can create this document.
				</p>
			) : null}
			{errorMessage ? (
				<p className="text-destructive text-sm" role="alert">
					{errorMessage}
				</p>
			) : null}
			<div className="flex justify-end gap-2 border-t pt-4">
				<Link
					className={buttonVariants({ variant: "outline" })}
					search={folderSearch}
					to={buildOrganizationDocumentsPath(currentOrganization.slug)}
				>
					Cancel
				</Link>
				<Button
					disabled={!(canCreate && validTarget) || createMutation.isPending}
					onClick={() => {
						setErrorMessage(null);
						createMutation.mutate();
					}}
				>
					{createMutation.isPending ? "Creating…" : "Create document"}
				</Button>
			</div>
		</div>
	);
}

function DocumentTargetFields(input: {
	canManage: boolean;
	disabled: boolean;
	initialSubjectUserId?: string;
	kind: OrganizationDocumentKind;
	members: readonly OrganizationDirectoryResponse["members"][number][];
	onKindChange: (kind: OrganizationDocumentKind) => void;
	onSubjectUserIdChange: (userId: string) => void;
	onTitleChange: (title: string) => void;
	subjectUserId: string;
	title: string;
}) {
	return (
		<div className="grid gap-4 rounded-md border p-4 sm:grid-cols-2">
			<div className="grid gap-2">
				<Label htmlFor="organization-document-kind">Type</Label>
				<Select
					disabled={!input.canManage || input.disabled}
					onValueChange={(value) => {
						if (isDocumentKind(value)) {
							input.onKindChange(value);
						}
					}}
					value={input.kind}
				>
					<SelectTrigger
						displayValue={
							KIND_OPTIONS.find((option) => option.value === input.kind)?.label
						}
						id="organization-document-kind"
					/>
					<SelectContent>
						{KIND_OPTIONS.map((option, index) => (
							<SelectItem index={index} key={option.value} value={option.value}>
								{option.label}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			{input.kind === "knowledge" ? (
				<div className="grid gap-2">
					<Label htmlFor="organization-document-title">Title</Label>
					<Input
						disabled={input.disabled}
						id="organization-document-title"
						maxLength={200}
						onChange={(event) => input.onTitleChange(event.target.value)}
						placeholder="Support runbook"
						value={input.title}
					/>
				</div>
			) : null}
			{input.kind === "member_profile" ? (
				<div className="grid gap-2">
					<Label htmlFor="organization-document-member">Member</Label>
					<Select
						disabled={
							(!input.canManage && Boolean(input.initialSubjectUserId)) ||
							input.disabled
						}
						onValueChange={input.onSubjectUserIdChange}
						value={input.subjectUserId}
					>
						<SelectTrigger
							displayValue={
								input.members.find(
									(member) => member.user.id === input.subjectUserId
								)?.user.name ?? "Select a member"
							}
							id="organization-document-member"
						/>
						<SelectContent>
							{input.members.map((member, index) => (
								<SelectItem
									index={index}
									key={member.user.id}
									value={member.user.id}
								>
									{member.humanProfile?.profileName ?? member.user.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			) : null}
			{input.kind === "brief" ? (
				<div>
					<p className="font-medium text-sm">Organization Brief</p>
					<p className="mt-1 text-muted-foreground text-xs">
						The approved content is added to the Center Agent’s context.
					</p>
				</div>
			) : null}
		</div>
	);
}

function isDocumentKind(value: string): value is OrganizationDocumentKind {
	return (
		value === "brief" || value === "member_profile" || value === "knowledge"
	);
}
