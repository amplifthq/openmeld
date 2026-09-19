"use client";

import type {
	GetOrganizationSkillResponse,
	OrganizationSkill,
	OrganizationSkillBundle,
} from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { ArrowClockwiseIcon, ArrowLeftIcon } from "@phosphor-icons/react";
import {
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
	type SetStateAction,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { APP_INLINE_BACK_LINK_CLASS_NAME } from "#/components/app/app-inline-navigation";
import {
	type SaveBeforeLeaveResult,
	UnsavedChangesGuard,
} from "#/components/forms/unsaved-changes-guard";
import { OrganizationSkillMaintainersDialog } from "#/components/organization-skills/organization-skill-maintainers-dialog";
import { copyTextToClipboard } from "#/lib/clipboard";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationSkillPath,
	buildOrganizationSkillsPath,
} from "#/lib/organizations/organization-routes";
import {
	deleteCurrentOrganizationSkill,
	type OrganizationSkillFailure,
	resolveOrganizationSkillErrorMessage,
	setCurrentOrganizationSkillEnabled,
	setCurrentOrganizationSkillMaintainers,
	updateCurrentOrganizationSkill,
} from "#/lib/organizations/organization-skills";
import {
	organizationSkillQueryKeys,
	organizationSkillQueryOptions,
} from "#/query/organizations/organization-skills";
import {
	OrganizationSkillActions,
	type SkillAction,
} from "./organization-skill-actions";
import {
	OrganizationSkillContextDialog,
	type SkillContextView,
} from "./organization-skill-context-dialog";
import { OrganizationSkillDocument } from "./organization-skill-document";

import {
	skillDraftValidationMessage,
	skillSaveStatus,
} from "./organization-skill-validation";

export function OrganizationSkillDetailPage(input: { skillId: string }) {
	const { currentOrganization, storageScope } = useAppOrganization();
	const skillQuery = useQuery(
		organizationSkillQueryOptions({
			organizationId: currentOrganization.id,
			skillId: input.skillId,
		})
	);

	return (
		<OrganizationSkillDetailContent
			identityKey={JSON.stringify([
				storageScope,
				currentOrganization.id,
				input.skillId,
			])}
			organizationId={currentOrganization.id}
			organizationName={currentOrganization.name}
			orgSlug={currentOrganization.slug}
			query={skillQuery}
			skillId={input.skillId}
		/>
	);
}

function OrganizationSkillDetailContent(input: {
	identityKey: string;
	orgSlug: string;
	organizationId: string;
	organizationName: string;
	query: UseQueryResult<GetOrganizationSkillResponse, OrganizationSkillFailure>;
	skillId: string;
}) {
	if (input.query.isPending) {
		return (
			<div className="grid gap-5">
				<Skeleton className="h-5 w-24" />
				<Skeleton className="h-12 w-72" />
				<Skeleton className="h-96 w-full" />
			</div>
		);
	}
	if (input.query.isError && !input.query.data?.skill) {
		return (
			<div className="grid justify-items-start gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-6">
				<h1 className="font-medium text-xl">Could not load Skill</h1>
				<p className="text-muted-foreground text-sm">
					Try again or return to the skills catalog.
				</p>
				<Button onClick={() => input.query.refetch()} variant="outline">
					<ArrowClockwiseIcon aria-hidden="true" /> Retry
				</Button>
				<Link
					className={APP_INLINE_BACK_LINK_CLASS_NAME}
					to={buildOrganizationSkillsPath(input.orgSlug)}
				>
					All Skills
				</Link>
			</div>
		);
	}
	if (!input.query.data?.skill) {
		return (
			<div className="grid justify-items-start gap-3 rounded-md border p-6">
				<h1 className="font-medium text-xl">Skill not found</h1>
				<p className="text-muted-foreground text-sm">
					This Skill may have been removed or belongs to another Organization.
				</p>
				<Link
					className={buttonVariants({ variant: "outline" })}
					to={buildOrganizationSkillsPath(input.orgSlug)}
				>
					<ArrowLeftIcon aria-hidden="true" /> All Skills
				</Link>
			</div>
		);
	}
	return (
		<>
			{input.query.isError && (
				<p className="text-destructive text-sm" role="alert">
					Could not refresh this skill. Your changes are still here.{" "}
					<Button
						onClick={() => input.query.refetch()}
						size="sm"
						variant="outline"
					>
						Retry
					</Button>
				</p>
			)}
			<OrganizationSkillEditor
				key={input.identityKey}
				organizationId={input.organizationId}
				organizationName={input.organizationName}
				orgSlug={input.orgSlug}
				skill={input.query.data.skill}
			/>
		</>
	);
}

function OrganizationSkillEditor(input: {
	orgSlug: string;
	organizationId: string;
	organizationName: string;
	skill: OrganizationSkill;
}) {
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const active = useRef(false);
	useLayoutEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const [contextView, setContextView] = useState<SkillContextView | null>(null);
	const hash = useRouterState({ select: (state) => state.location.hash });
	useEffect(() => {
		if (hash === "skill-history-heading") {
			setContextView("history");
		} else if (hash === "skill-details-heading") {
			setContextView("properties");
		} else if (
			hash === "skill-files-heading" ||
			hash === "skill-instructions-heading"
		) {
			setContextView(null);
		}
	}, [hash]);
	const [clipboardNotice, setClipboardNotice] = useState<string | null>(null);
	const actionsRef = useRef<HTMLButtonElement>(null);
	// Identity is isolated above. Content and concurrency expectations advance
	// together, never merely because a newer query result arrived while editing.
	const [draft, setDraft] = useState(() => ({
		baseline: input.skill,
		bundle: input.skill.bundle,
		contentGeneration: 0,
	}));
	// Event callbacks and Save settlement must see the same draft even before
	// React commits the next render. Keep every draft transition on this path.
	const latestDraft = useRef(draft);
	const updateDraft = useCallback(
		(update: (current: typeof draft) => typeof draft) => {
			const next = update(latestDraft.current);
			latestDraft.current = next;
			setDraft(next);
		},
		[]
	);
	const bundle = draft.bundle;
	const setBundle = (update: SetStateAction<OrganizationSkillBundle>) => {
		updateDraft((current) =>
			current.contentGeneration !== draft.contentGeneration || !active.current
				? current
				: {
						...current,
						bundle:
							typeof update === "function" ? update(current.bundle) : update,
					}
		);
	};
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [maintainersOpen, setMaintainersOpen] = useState(false);
	const [removed, setRemoved] = useState(false);
	const hasUnsavedChanges =
		!removed &&
		canonicalBundle(bundle) !== canonicalBundle(draft.baseline.bundle);
	const validationMessage = skillDraftValidationMessage(bundle);
	const bundleValid = validationMessage === null;
	const [catalogRefreshFailed, setCatalogRefreshFailed] = useState(false);
	const refreshCatalog = () => {
		queryClient
			.invalidateQueries(
				{ queryKey: organizationSkillQueryKeys.list(input.organizationId) },
				{ throwOnError: true }
			)
			.then(() => {
				if (active.current) {
					setCatalogRefreshFailed(false);
				}
			})
			.catch(() => {
				if (active.current) {
					setCatalogRefreshFailed(true);
				}
			});
	};
	const refresh = (skill: OrganizationSkill) => {
		queryClient.setQueryData<GetOrganizationSkillResponse>(
			organizationSkillQueryKeys.detail(input.organizationId, skill.id),
			(current) =>
				current?.skill && current.skill.version > skill.version
					? current
					: { skill }
		);
		// Catalog freshness is not the outcome of an already confirmed write.
		refreshCatalog();
	};
	const saveMutation = useMutation({
		mutationFn: async (submitted: typeof draft) =>
			await updateCurrentOrganizationSkill({
				bundle: submitted.bundle,
				expectedActiveReleaseId: submitted.baseline.activeRelease.id,
				expectedOrganizationId: input.organizationId,
				expectedVersion: submitted.baseline.version,
				skillId: input.skill.id,
			}),
		onError: (error) => {
			setErrorMessage(resolveOrganizationSkillErrorMessage(error));
		},
		onMutate: () => {
			setErrorMessage(null);
		},
		onSuccess: (response, submitted) => {
			updateDraft((current) => {
				const adoptSavedContent =
					canonicalBundle(current.bundle) === canonicalBundle(submitted.bundle);
				return {
					baseline: response.skill,
					bundle: adoptSavedContent ? response.skill.bundle : current.bundle,
					// Plate owns its document. Reload only when accepting a whole
					// external bundle, never when typing or retaining queued input.
					contentGeneration:
						current.contentGeneration + (adoptSavedContent ? 1 : 0),
				};
			});
			refresh(response.skill);
		},
	});
	useEffect(() => {
		if (saveMutation.isPending) {
			return;
		}
		updateDraft((current) => {
			if (
				input.skill.version <= current.baseline.version ||
				canonicalBundle(current.bundle) !==
					canonicalBundle(current.baseline.bundle)
			) {
				return current;
			}
			return {
				baseline: input.skill,
				bundle: input.skill.bundle,
				contentGeneration: current.contentGeneration + 1,
			};
		});
	}, [input.skill, saveMutation.isPending, updateDraft]);
	const enabledMutation = useMutation({
		mutationFn: async (enabled: boolean) =>
			await setCurrentOrganizationSkillEnabled({
				enabled,
				expectedOrganizationId: input.organizationId,
				expectedVersion: input.skill.version,
				skillId: input.skill.id,
			}),
		onError: (error) =>
			setErrorMessage(resolveOrganizationSkillErrorMessage(error)),
		onSuccess: (response) => refresh(response.skill),
	});
	const maintainersMutation = useMutation({
		mutationFn: async (maintainerUserIds: string[]) =>
			await setCurrentOrganizationSkillMaintainers({
				expectedOrganizationId: input.organizationId,
				expectedVersion: input.skill.version,
				maintainerUserIds,
				skillId: input.skill.id,
			}),
		onError: (error) =>
			setErrorMessage(resolveOrganizationSkillErrorMessage(error)),
		onSuccess: (response) => {
			setMaintainersOpen(false);
			refresh(response.skill);
		},
	});
	const deleteMutation = useMutation({
		mutationFn: async () =>
			await deleteCurrentOrganizationSkill({
				expectedOrganizationId: input.organizationId,
				expectedVersion: input.skill.version,
				skillId: input.skill.id,
			}),
		onError: (error) =>
			setErrorMessage(resolveOrganizationSkillErrorMessage(error)),
		onSuccess: async () => {
			setRemoved(true);
			setDeleteOpen(false);
			refreshCatalog();
			if (!active.current) {
				return;
			}
			await navigate({
				to: buildOrganizationSkillsPath(input.orgSlug),
			});
		},
	});
	const save = async (): Promise<SaveBeforeLeaveResult> => {
		if (
			!(input.skill.permissions.canEdit && bundleValid && hasUnsavedChanges) ||
			saveMutation.isPending
		) {
			return false;
		}
		try {
			await saveMutation.mutateAsync(latestDraft.current);
			// Only remaining content blocks leaving: identical callbacks or an
			// edit reverted during Save are not newer unsaved work.
			const current = latestDraft.current;
			return canonicalBundle(current.bundle) ===
				canonicalBundle(current.baseline.bundle)
				? true
				: "saved-with-unsaved-changes";
		} catch {
			return false;
		}
	};
	const busy =
		saveMutation.isPending ||
		enabledMutation.isPending ||
		maintainersMutation.isPending ||
		deleteMutation.isPending;
	const saveStatus = skillSaveStatus({
		dirty: hasUnsavedChanges,
		failed: saveMutation.isError && Boolean(errorMessage),
		saving: saveMutation.isPending,
	});
	const handleAction = (action: SkillAction) => {
		if (action === "copy") {
			const path = buildOrganizationSkillPath({
				orgSlug: input.orgSlug,
				skillId: input.skill.id,
			});
			copyTextToClipboard(new URL(path, window.location.origin).href)
				.then((copied) => {
					if (active.current) {
						setClipboardNotice(
							copied
								? "Link copied"
								: "Could not copy the link. Copy the page address instead."
						);
					}
				})
				.catch(() => {
					if (active.current) {
						setClipboardNotice(
							"Could not copy the link. Copy the page address instead."
						);
					}
				});
			return;
		}
		if (action === "properties" || action === "history" || action === "usage") {
			setContextView(action);
			return;
		}
		if (!input.skill.permissions.canManage || hasUnsavedChanges || busy) {
			return;
		}
		setErrorMessage(null);
		if (action === "maintainers") {
			setMaintainersOpen(true);
		}
		if (action === "remove") {
			setDeleteOpen(true);
		}
		if (action === "toggle") {
			enabledMutation.mutate(!input.skill.enabled);
		}
	};

	return (
		<div className="mx-auto grid w-full max-w-[880px] gap-6 pb-8">
			<UnsavedChangesGuard
				description="Your changes to this skill haven't been saved."
				hasUnsavedChanges={hasUnsavedChanges}
				onSave={save}
				saving={busy}
			/>
			<div
				className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 border-b bg-background py-3"
				data-slot="skill-document-actions"
			>
				<Link
					className={APP_INLINE_BACK_LINK_CLASS_NAME}
					resetScroll={false}
					to={buildOrganizationSkillsPath(input.orgSlug)}
				>
					<ArrowLeftIcon aria-hidden="true" /> All Skills
				</Link>
				<div className="flex flex-wrap items-center gap-2">
					<output
						aria-label="Skill save status"
						className="text-muted-foreground text-xs"
					>
						{input.skill.permissions.canEdit ? saveStatus : "Read only"}
					</output>
					{input.skill.permissions.canEdit && (
						<Button
							disabled={!(hasUnsavedChanges && bundleValid) || busy}
							onClick={save}
						>
							{saveMutation.isPending ? "Saving…" : "Save"}
						</Button>
					)}
					<OrganizationSkillActions
						canManage={input.skill.permissions.canManage}
						enabled={input.skill.enabled}
						managementBlocked={hasUnsavedChanges || busy}
						onAction={handleAction}
						triggerRef={actionsRef}
					/>
				</div>
			</div>
			{catalogRefreshFailed && (
				<div className="flex flex-wrap items-center gap-2 text-sm" role="alert">
					<span>Your change was saved, but the catalog could not refresh.</span>
					<Button onClick={refreshCatalog} size="sm" variant="outline">
						Retry refresh
					</Button>
				</div>
			)}
			{clipboardNotice && (
				<output className="text-muted-foreground text-sm">
					{clipboardNotice}
				</output>
			)}
			{errorMessage &&
				!deleteOpen &&
				!maintainersOpen &&
				contextView !== "properties" && (
					<p className="text-destructive text-sm" role="alert">
						{errorMessage}
					</p>
				)}
			{!bundleValid && hasUnsavedChanges && (
				<p className="text-destructive text-sm" role="alert">
					{validationMessage}
				</p>
			)}
			<OrganizationSkillDocument
				bundle={bundle}
				contentGeneration={draft.contentGeneration}
				onChange={setBundle}
				saving={busy}
				skill={input.skill}
			/>
			<OrganizationSkillContextDialog
				bundle={bundle}
				canEdit={input.skill.permissions.canEdit}
				errorMessage={errorMessage}
				finalFocus={actionsRef}
				hasUnsavedChanges={hasUnsavedChanges}
				onChange={setBundle}
				onClose={() => setContextView(null)}
				onSave={save}
				organizationName={input.organizationName}
				saving={busy}
				skill={input.skill}
				valid={bundleValid}
				view={contextView}
			/>

			<OrganizationSkillMaintainersDialog
				errorMessage={errorMessage}
				finalFocus={actionsRef}
				onOpenChange={setMaintainersOpen}
				onSave={(maintainerUserIds) =>
					maintainersMutation.mutate(maintainerUserIds)
				}
				open={maintainersOpen}
				organizationId={input.organizationId}
				saving={maintainersMutation.isPending}
				selectedUserIds={input.skill.maintainerUserIds}
			/>
			<Dialog
				onOpenChange={(open) => {
					if (!deleteMutation.isPending) {
						setDeleteOpen(open);
					}
				}}
				open={deleteOpen}
			>
				<DialogContent
					finalFocus={actionsRef}
					showCloseButton={!deleteMutation.isPending}
					size="lg"
				>
					<DialogHeader>
						<DialogTitle>
							Remove {input.skill.name} from {input.organizationName}?
						</DialogTitle>
						<DialogDescription>
							Agents will no longer be able to load this skill. Work already in
							progress is not affected.
						</DialogDescription>
					</DialogHeader>
					{errorMessage && (
						<p className="text-destructive text-sm" role="alert">
							{errorMessage}
						</p>
					)}
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
							{deleteMutation.isPending ? "Removing…" : "Remove Skill"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	);
}

function canonicalBundle(bundle: OrganizationSkillBundle): string {
	return JSON.stringify(bundle);
}
