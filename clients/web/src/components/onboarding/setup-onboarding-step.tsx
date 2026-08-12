"use client";

import {
	ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS,
	ORGANIZATION_PROTECTED_INFORMATION_MAX_CHARS,
} from "@openmeld/schemas";
import type {
	CenterAgentOrganizationMemoryPolicyResponse,
	GetOrganizationBindingAuthorizationPreferenceResponse,
	GetOrganizationDocumentResponse,
	ListOrganizationDocumentsResponse,
	OrganizationDocument,
	OrganizationDocumentSummary,
	OrganizationInformationProtectionPolicyResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Switch } from "@openmeld/ui/components/switch";
import { Textarea } from "@openmeld/ui/components/textarea";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowRightIcon,
	CaretDownIcon,
	CheckCircleIcon,
	FileTextIcon,
	ShieldCheckIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { setCurrentOrganizationCenterAgentMemoryPolicy } from "#/lib/organizations/center-agent-memory";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	createCurrentOrganizationDocument,
	resolveOrganizationDocumentErrorMessage,
	updateCurrentOrganizationDocument,
} from "#/lib/organizations/organization-documents";
import { setCurrentOrganizationInformationProtection } from "#/lib/organizations/organization-information-protection";
import { canManageOrganizationArea } from "#/lib/organizations/organization-permissions";
import { saveOrganizationWakeAccessChoice } from "#/lib/profiles/organization-binding-authorizations";
import {
	centerAgentMemoryPolicyQueryOptions,
	centerAgentQueryKeys,
} from "#/query/organizations/center-agent";
import { organizationMemberRoleQueryOptions } from "#/query/organizations/organization-directory";
import {
	organizationDocumentQueryKeys,
	organizationDocumentQueryOptions,
	organizationDocumentsQueryOptions,
} from "#/query/organizations/organization-documents";
import {
	organizationInformationProtectionQueryKeys,
	organizationInformationProtectionQueryOptions,
} from "#/query/organizations/organization-information-protection";
import {
	organizationBindingAuthorizationPreferenceQueryOptions,
	organizationBindingAuthorizationQueryKeys,
} from "#/query/profiles/organization-binding-authorizations";

export function SetupOnboardingStep(input: { onContinue: () => void }) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const queryClient = useQueryClient();
	const isPersonalWorkspace = currentOrganization.isPersonal === true;
	const [briefExpanded, setBriefExpanded] = useState(false);
	const [protectionExpanded, setProtectionExpanded] = useState(false);
	const [briefDraft, setBriefDraft] = useState("");
	const [protectionDraft, setProtectionDraft] = useState("");
	const wakeAccessDefaultStartedRef = useRef(false);
	const roleQuery = useQuery(
		organizationMemberRoleQueryOptions({
			enabled: !isPersonalWorkspace,
			organizationId: currentOrganization.id,
			userId: currentUserId,
		})
	);
	const canManageMemory =
		isPersonalWorkspace ||
		canManageOrganizationArea(roleQuery.data, { memory: ["manage"] });
	const canManageInformationProtection =
		!isPersonalWorkspace &&
		canManageOrganizationArea(roleQuery.data, {
			informationProtection: ["manage"],
		});
	const memoryPolicyQuery = useQuery(
		centerAgentMemoryPolicyQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	const wakeAccessPreferenceQuery = useQuery(
		organizationBindingAuthorizationPreferenceQueryOptions({
			enabled: !isPersonalWorkspace,
			organizationId: currentOrganization.id,
		})
	);
	const documentsQuery = useQuery(
		organizationDocumentsQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const brief = documentsQuery.data?.documents.find(
		(document) => document.kind === "brief"
	);
	const briefQuery = useQuery(
		organizationDocumentQueryOptions({
			documentId: brief?.id ?? "brief-unavailable",
			enabled: Boolean(brief),
			organizationId: currentOrganization.id,
		})
	);
	const informationProtectionQuery = useQuery(
		organizationInformationProtectionQueryOptions({
			enabled: canManageInformationProtection,
			organizationId: currentOrganization.id,
		})
	);

	const memoryMutation = useMutation<
		CenterAgentOrganizationMemoryPolicyResponse,
		unknown,
		boolean,
		{ previous: CenterAgentOrganizationMemoryPolicyResponse | undefined }
	>({
		mutationFn: async (organizationMemoryOptIn) =>
			await setCurrentOrganizationCenterAgentMemoryPolicy({
				organizationId: currentOrganization.id,
				organizationMemoryOptIn,
			}),
		onError: (_error, _enabled, context) => {
			queryClient.setQueryData(
				centerAgentQueryKeys.memoryPolicy(currentOrganization.id),
				context?.previous
			);
		},
		onMutate: async (organizationMemoryOptIn) => {
			const queryKey = centerAgentQueryKeys.memoryPolicy(
				currentOrganization.id
			);
			await queryClient.cancelQueries({ queryKey });
			const previous =
				queryClient.getQueryData<CenterAgentOrganizationMemoryPolicyResponse>(
					queryKey
				);
			queryClient.setQueryData<CenterAgentOrganizationMemoryPolicyResponse>(
				queryKey,
				{
					organizationId: currentOrganization.id,
					organizationMemoryOptIn,
					provider: previous?.provider ?? "zep_cloud",
					updatedByUserId: currentUserId,
				}
			);
			return { previous };
		},
		onSuccess: (response) => {
			queryClient.setQueryData(
				centerAgentQueryKeys.memoryPolicy(currentOrganization.id),
				response
			);
		},
	});
	const wakeAccessMutation = useMutation<
		GetOrganizationBindingAuthorizationPreferenceResponse,
		unknown,
		boolean,
		{
			previous:
				| GetOrganizationBindingAuthorizationPreferenceResponse
				| undefined;
		}
	>({
		mutationFn: async (enableWakeAccess) =>
			(
				await saveOrganizationWakeAccessChoice({
					enableWakeAccess,
					organizationId: currentOrganization.id,
				})
			).preference,
		onError: (_error, _enabled, context) => {
			queryClient.setQueryData(
				organizationBindingAuthorizationQueryKeys.preference(
					currentOrganization.id
				),
				context?.previous
			);
		},
		onMutate: async (autoAuthorizeAgentProfileBindings) => {
			const queryKey = organizationBindingAuthorizationQueryKeys.preference(
				currentOrganization.id
			);
			await queryClient.cancelQueries({ queryKey });
			const previous =
				queryClient.getQueryData<GetOrganizationBindingAuthorizationPreferenceResponse>(
					queryKey
				);
			queryClient.setQueryData<GetOrganizationBindingAuthorizationPreferenceResponse>(
				queryKey,
				{
					autoAuthorizeAgentProfileBindings,
					organizationId: currentOrganization.id,
					updatedAt: new Date().toISOString(),
					userId: currentUserId,
				}
			);
			return { previous };
		},
		onSuccess: (preference) => {
			queryClient.setQueryData(
				organizationBindingAuthorizationQueryKeys.preference(
					currentOrganization.id
				),
				preference
			);
		},
	});

	const briefMutation = useMutation<
		OrganizationDocument,
		unknown,
		string,
		{
			optimisticId: string;
			previousDetail: GetOrganizationDocumentResponse | undefined;
			previousList: ListOrganizationDocumentsResponse | undefined;
		}
	>({
		mutationFn: async (content) => {
			if (brief) {
				return (
					await updateCurrentOrganizationDocument({
						content,
						documentId: brief.id,
						expectedOrganizationId: currentOrganization.id,
					})
				).document;
			}
			return (
				await createCurrentOrganizationDocument({
					content,
					expectedOrganizationId: currentOrganization.id,
					kind: "brief",
				})
			).document;
		},
		onError: (_error, _content, context) => {
			queryClient.setQueryData(
				organizationDocumentQueryKeys.list(currentOrganization.id),
				context?.previousList
			);
			if (brief) {
				queryClient.setQueryData(
					organizationDocumentQueryKeys.detail(
						currentOrganization.id,
						brief.id
					),
					context?.previousDetail
				);
			}
		},
		onMutate: async (content) => {
			const listQueryKey = organizationDocumentQueryKeys.list(
				currentOrganization.id
			);
			const optimisticId = brief?.id ?? `optimistic-brief-${Date.now()}`;
			await queryClient.cancelQueries({ queryKey: listQueryKey });
			const previousList =
				queryClient.getQueryData<ListOrganizationDocumentsResponse>(
					listQueryKey
				);
			const detailQueryKey = organizationDocumentQueryKeys.detail(
				currentOrganization.id,
				optimisticId
			);
			await queryClient.cancelQueries({ queryKey: detailQueryKey });
			const previousDetail =
				queryClient.getQueryData<GetOrganizationDocumentResponse>(
					detailQueryKey
				);
			const optimisticDocument = buildOptimisticBrief({
				content,
				current: briefQuery.data?.document,
				documentId: optimisticId,
				organizationId: currentOrganization.id,
			});
			if (previousList) {
				queryClient.setQueryData<ListOrganizationDocumentsResponse>(
					listQueryKey,
					{
						...previousList,
						documents: upsertDocumentSummary(
							previousList.documents,
							optimisticDocument
						),
					}
				);
			}
			queryClient.setQueryData<GetOrganizationDocumentResponse>(
				detailQueryKey,
				{ document: optimisticDocument }
			);
			return { optimisticId, previousDetail, previousList };
		},
		onSuccess: (document, _content, context) => {
			queryClient.setQueryData<ListOrganizationDocumentsResponse>(
				organizationDocumentQueryKeys.list(currentOrganization.id),
				(current) =>
					current
						? {
								...current,
								documents: upsertDocumentSummary(
									current.documents.filter(
										(candidate) => candidate.id !== context.optimisticId
									),
									document
								),
							}
						: current
			);
			queryClient.setQueryData<GetOrganizationDocumentResponse>(
				organizationDocumentQueryKeys.detail(
					currentOrganization.id,
					document.id
				),
				{ document }
			);
			if (context.optimisticId !== document.id) {
				queryClient.removeQueries({
					queryKey: organizationDocumentQueryKeys.detail(
						currentOrganization.id,
						context.optimisticId
					),
				});
			}
			setBriefDraft(document.content);
		},
	});

	const informationProtectionMutation = useMutation<
		OrganizationInformationProtectionPolicyResponse,
		unknown,
		string | null,
		{
			previous: OrganizationInformationProtectionPolicyResponse | undefined;
		}
	>({
		mutationFn: async (protectedInformation) =>
			await setCurrentOrganizationInformationProtection({
				organizationId: currentOrganization.id,
				protectedInformation,
			}),
		onError: (_error, _value, context) => {
			queryClient.setQueryData(
				organizationInformationProtectionQueryKeys.policy(
					currentOrganization.id
				),
				context?.previous
			);
		},
		onMutate: async (protectedInformation) => {
			const queryKey = organizationInformationProtectionQueryKeys.policy(
				currentOrganization.id
			);
			await queryClient.cancelQueries({ queryKey });
			const previous =
				queryClient.getQueryData<OrganizationInformationProtectionPolicyResponse>(
					queryKey
				);
			queryClient.setQueryData<OrganizationInformationProtectionPolicyResponse>(
				queryKey,
				{
					organizationId: currentOrganization.id,
					protectedInformation,
					updatedAt: new Date().toISOString(),
					updatedByUserId: currentUserId,
				}
			);
			return { previous };
		},
		onSuccess: (response) => {
			queryClient.setQueryData(
				organizationInformationProtectionQueryKeys.policy(
					currentOrganization.id
				),
				response
			);
			setProtectionDraft(response.protectedInformation ?? "");
		},
	});

	useEffect(() => {
		if (briefQuery.data) {
			setBriefDraft(briefQuery.data.document.content);
		}
	}, [briefQuery.data]);
	useEffect(() => {
		if (informationProtectionQuery.data) {
			setProtectionDraft(
				informationProtectionQuery.data.protectedInformation ?? ""
			);
		}
	}, [informationProtectionQuery.data]);
	useEffect(() => {
		if (
			wakeAccessDefaultStartedRef.current ||
			isPersonalWorkspace ||
			wakeAccessPreferenceQuery.data?.updatedAt !== null ||
			wakeAccessMutation.isPending
		) {
			return;
		}
		wakeAccessDefaultStartedRef.current = true;
		wakeAccessMutation.mutate(true);
	}, [
		isPersonalWorkspace,
		wakeAccessMutation,
		wakeAccessPreferenceQuery.data?.updatedAt,
	]);

	const briefContent = briefQuery.data?.document.content ?? "";
	const normalizedBriefDraft = briefDraft.trim();
	const briefChanged =
		documentsQuery.data?.canManage === true &&
		normalizedBriefDraft.length > 0 &&
		normalizedBriefDraft !== briefContent;
	const protectedInformation =
		informationProtectionQuery.data?.protectedInformation ?? "";
	const normalizedProtectionDraft = protectionDraft.trim();
	const protectionChanged =
		canManageInformationProtection &&
		normalizedProtectionDraft !== protectedInformation;
	const mutationError =
		memoryMutation.error ??
		wakeAccessMutation.error ??
		briefMutation.error ??
		informationProtectionMutation.error;
	const saving =
		briefMutation.isPending || informationProtectionMutation.isPending;
	const continueOnboarding = async () => {
		const writes: Promise<unknown>[] = [];
		if (briefChanged) {
			writes.push(briefMutation.mutateAsync(normalizedBriefDraft));
		}
		if (protectionChanged) {
			writes.push(
				informationProtectionMutation.mutateAsync(
					normalizedProtectionDraft || null
				)
			);
		}
		try {
			await Promise.all(writes);
			input.onContinue();
		} catch {
			// Each mutation owns its visible error and precise cache rollback.
		}
	};

	return (
		<div className="flex flex-1 flex-col">
			<div className="space-y-2">
				<EnabledSettingRow
					checked={memoryPolicyQuery.data?.organizationMemoryOptIn ?? false}
					description="Center Agent can keep useful context from shared conversations."
					disabled={
						!canManageMemory ||
						memoryPolicyQuery.isPending ||
						memoryPolicyQuery.isError ||
						memoryMutation.isPending
					}
					label={
						isPersonalWorkspace ? "Workspace memory" : "Organization memory"
					}
					onCheckedChange={(checked) => memoryMutation.mutate(checked)}
				/>
				{isPersonalWorkspace ? null : (
					<EnabledSettingRow
						checked={
							wakeAccessPreferenceQuery.data
								?.autoAuthorizeAgentProfileBindings ?? false
						}
						description="Your connected Codex or Claude Code can receive work from this organization."
						disabled={
							wakeAccessPreferenceQuery.isPending ||
							wakeAccessPreferenceQuery.isError ||
							wakeAccessMutation.isPending
						}
						label="Use my connected agents"
						onCheckedChange={(checked) => wakeAccessMutation.mutate(checked)}
					/>
				)}
			</div>

			{documentsQuery.data?.canManage ? (
				<OptionalSetupSection
					added={Boolean(brief)}
					description="Give Center Agent a short source of truth about your organization."
					expanded={briefExpanded}
					icon={<FileTextIcon />}
					onExpandedChange={setBriefExpanded}
					title="Organization brief"
				>
					<Textarea
						disabled={Boolean(brief) && briefQuery.isPending}
						maxLength={ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS}
						onChange={(event) => setBriefDraft(event.target.value)}
						placeholder="What does your organization do, and what is it trying to achieve?"
						rows={4}
						value={briefDraft}
					/>
					<p className="mt-2 text-right text-[11px] text-muted-foreground">
						{briefDraft.length.toLocaleString()} /{" "}
						{ORGANIZATION_DOCUMENT_CONTENT_MAX_CHARS.toLocaleString()}
					</p>
				</OptionalSetupSection>
			) : null}

			{canManageInformationProtection ? (
				<OptionalSetupSection
					added={Boolean(protectedInformation)}
					description="Name information that should stay within appropriate private contexts."
					expanded={protectionExpanded}
					icon={<ShieldCheckIcon />}
					onExpandedChange={setProtectionExpanded}
					title="Information protection"
				>
					<Textarea
						disabled={informationProtectionQuery.isPending}
						maxLength={ORGANIZATION_PROTECTED_INFORMATION_MAX_CHARS}
						onChange={(event) => setProtectionDraft(event.target.value)}
						placeholder="Examples: customer contract pricing, unreleased Board forecasts, or acquisition plans."
						rows={4}
						value={protectionDraft}
					/>
					<div className="mt-2 flex justify-between gap-4 text-[11px] text-muted-foreground leading-5">
						<p>Describe categories, not passwords, tokens, or records.</p>
						<p className="shrink-0">
							{protectionDraft.length.toLocaleString()} /{" "}
							{ORGANIZATION_PROTECTED_INFORMATION_MAX_CHARS.toLocaleString()}
						</p>
					</div>
				</OptionalSetupSection>
			) : null}

			{mutationError ? (
				<p className="mt-3 text-destructive text-xs" role="alert">
					{resolveSetupMutationError({
						briefError: briefMutation.error,
						mutationError,
					})}
				</p>
			) : null}

			<div className="mt-auto flex items-center justify-between gap-4 border-border/70 border-t pt-5">
				<p className="text-muted-foreground text-xs">
					Optional details save when you continue.
				</p>
				<Button
					disabled={saving}
					onClick={() => {
						continueOnboarding().catch((error: unknown) => {
							console.error("OpenMeld could not continue onboarding.", {
								error,
								organizationId: currentOrganization.id,
							});
						});
					}}
					type="button"
				>
					{saving ? "Saving…" : "Continue"}
					<ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
				</Button>
			</div>
		</div>
	);
}

function EnabledSettingRow(input: {
	checked: boolean;
	description: string;
	disabled: boolean;
	label: string;
	onCheckedChange: (checked: boolean) => void;
}) {
	return (
		<div className="flex items-center gap-4 rounded-md border border-border/80 bg-card/30 p-4">
			<span className="grid size-8 shrink-0 place-items-center rounded-md bg-emerald-500/10 text-emerald-500">
				<CheckCircleIcon aria-hidden="true" className="size-4" weight="fill" />
			</span>
			<div className="min-w-0 flex-1">
				<p className="font-medium text-sm">{input.label}</p>
				<p className="mt-1 text-muted-foreground text-xs leading-5">
					{input.description}
				</p>
			</div>
			<div className="flex shrink-0 items-center gap-2">
				<span className="text-[11px] text-muted-foreground">
					{input.checked ? "On" : "Off"}
				</span>
				<Switch
					aria-label={input.label}
					checked={input.checked}
					disabled={input.disabled}
					onCheckedChange={input.onCheckedChange}
				/>
			</div>
		</div>
	);
}

function OptionalSetupSection(input: {
	added: boolean;
	children: ReactNode;
	description: string;
	expanded: boolean;
	icon: ReactNode;
	onExpandedChange: (expanded: boolean) => void;
	title: string;
}) {
	return (
		<div className="mt-3 overflow-hidden rounded-md border border-border/80 bg-card/20">
			<button
				aria-expanded={input.expanded}
				className="flex w-full items-center gap-3 p-4 text-left"
				onClick={() => input.onExpandedChange(!input.expanded)}
				type="button"
			>
				<span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">
					{input.icon}
				</span>
				<span className="min-w-0 flex-1">
					<span className="flex items-center gap-2 font-medium text-sm">
						{input.title}
						{input.added ? (
							<span className="text-[10px] text-emerald-500 uppercase tracking-wide">
								Added
							</span>
						) : (
							<span className="text-[10px] text-muted-foreground uppercase tracking-wide">
								Optional
							</span>
						)}
					</span>
					<span className="mt-1 block text-muted-foreground text-xs">
						{input.description}
					</span>
				</span>
				<CaretDownIcon
					aria-hidden="true"
					className={cn(
						"size-4 text-muted-foreground transition-transform",
						input.expanded && "rotate-180"
					)}
				/>
			</button>
			{input.expanded ? (
				<div className="border-border/70 border-t p-4">{input.children}</div>
			) : null}
		</div>
	);
}

function buildOptimisticBrief(input: {
	content: string;
	current?: OrganizationDocument;
	documentId: string;
	organizationId: string;
}): OrganizationDocument {
	const now = new Date().toISOString();
	return {
		canEditContent: true,
		canManage: true,
		content: input.content,
		createdAt: input.current?.createdAt ?? now,
		draftContent: input.current?.draftContent ?? null,
		draftCreatedAt: input.current?.draftCreatedAt ?? null,
		draftCreatedBy: input.current?.draftCreatedBy ?? null,
		folderId: null,
		id: input.documentId,
		kind: "brief",
		organizationId: input.organizationId,
		subjectUserId: null,
		title: input.current?.title ?? "Organization Brief",
		updatedAt: now,
	};
}

function upsertDocumentSummary(
	documents: OrganizationDocumentSummary[],
	document: OrganizationDocument
): OrganizationDocumentSummary[] {
	const summary: OrganizationDocumentSummary = {
		canEditContent: document.canEditContent,
		canManage: document.canManage,
		createdAt: document.createdAt,
		folderId: document.folderId,
		hasDraft: document.draftContent !== null,
		id: document.id,
		kind: document.kind,
		organizationId: document.organizationId,
		subjectUserId: document.subjectUserId,
		title: document.title,
		updatedAt: document.updatedAt,
	};
	return [
		summary,
		...documents.filter((candidate) => candidate.id !== document.id),
	];
}

function resolveSetupMutationError(input: {
	briefError: unknown;
	mutationError: unknown;
}): string {
	if (input.briefError) {
		return resolveOrganizationDocumentErrorMessage(input.briefError);
	}
	if (input.mutationError instanceof Error) {
		return input.mutationError.message;
	}
	return "OpenMeld could not save this setting.";
}
