import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	OrganizationSkill,
	OrganizationSkillGitHubPreview,
	OrganizationSkillGitHubRepositoryPreview,
	OrganizationSkillSummary,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { DialogClose, DialogFooter } from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { useMutation } from "@tanstack/react-query";
import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import {
	importCurrentOrganizationSkillFromGitHub,
	previewCurrentOrganizationSkillFromGitHub,
	previewCurrentOrganizationSkillRepository,
	resolveOrganizationSkillErrorMessage,
} from "#/lib/organizations/organization-skills";
import { OrganizationSkillFlowDialog } from "./organization-skill-flow-dialog";
import { GitHubSkillPreview } from "./organization-skill-import-preview";
import {
	OrganizationSkillRepositoryCatalog,
	type RepositoryBatchResult,
} from "./organization-skill-repository-catalog";

type BoundPreview = {
	operationId: string;
	rootUrl: string;
	url: string;
	preview: OrganizationSkillGitHubPreview;
};
type BoundCatalog = {
	rootUrl: string;
	preview: OrganizationSkillGitHubRepositoryPreview;
};

export function InstallSkillDialog(input: {
	organizationId: string;
	finalFocus: RefObject<HTMLButtonElement | null>;
	installedSkills: OrganizationSkillSummary[];
	onClose: () => void;
	onBatchChanged: () => void;
	onInstalled: (skill: OrganizationSkill) => void;
}) {
	const [url, setUrl] = useState("");
	const [review, setReview] = useState<BoundPreview | null>(null);
	const [catalog, setCatalog] = useState<BoundCatalog | null>(null);
	const [selectedUrls, setSelectedUrls] = useState<Set<string>>(new Set());
	const [batchResults, setBatchResults] = useState<
		Map<string, RepositoryBatchResult>
	>(new Map());
	const [batchInstalling, setBatchInstalling] = useState(false);
	const existingPaths = getExistingGitHubPaths(catalog, input.installedSkills);
	const [error, setError] = useState<string | null>(null);
	const [reviewing, setReviewing] = useState(false);
	const request = useRef(0);
	const mounted = useRef(false);
	const submitting = useRef(false);
	const batchOperationIds = useRef(new Map<string, string>());
	useLayoutEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
			request.current += 1;
		};
	}, []);
	const install = useMutation({
		mutationFn: (
			body: Parameters<typeof importCurrentOrganizationSkillFromGitHub>[0]
		) => importCurrentOrganizationSkillFromGitHub(body),
	});
	const changeUrl = (value: string) => {
		request.current += 1;
		setUrl(value);
		setReview(null);
		setCatalog(null);
		setSelectedUrls(new Set());
		setBatchResults(new Map());
		batchOperationIds.current.clear();
		setReviewing(false);
		setError(null);
	};
	const isCurrent = (ticket: number) =>
		mounted.current && request.current === ticket;
	const loadRepositoryCatalog = async (
		requestedUrl: string,
		ticket: number
	) => {
		try {
			const response = await previewCurrentOrganizationSkillRepository({
				expectedOrganizationId: input.organizationId,
				url: requestedUrl,
			});
			if (isCurrent(ticket)) {
				const nextCatalog = {
					rootUrl: requestedUrl,
					preview: response.preview,
				};
				const existing = getExistingGitHubPaths(
					nextCatalog,
					input.installedSkills
				);
				setCatalog(nextCatalog);
				setSelectedUrls(
					new Set(
						response.preview.skills
							.filter((skill) => !(skill.blocker || existing.has(skill.path)))
							.map((skill) => skill.url)
					)
				);
			}
		} catch (failure) {
			if (isCurrent(ticket)) {
				setError(resolveOrganizationSkillErrorMessage(failure));
			}
		}
	};
	const preview = async () => {
		if (
			reviewing ||
			submitting.current ||
			!url.trim().startsWith("https://github.com/")
		) {
			return;
		}
		const ticket = ++request.current;
		const requestedUrl = url.trim();
		setError(null);
		setReviewing(true);
		try {
			const response = await previewCurrentOrganizationSkillFromGitHub({
				expectedOrganizationId: input.organizationId,
				url: requestedUrl,
			});
			if (isCurrent(ticket)) {
				setReview({
					operationId: crypto.randomUUID(),
					rootUrl: requestedUrl,
					url: requestedUrl,
					preview: response.preview,
				});
			}
		} catch (failure) {
			const structured = toStructuredApiClientFailure(failure);
			if (
				(structured.upstreamCode ?? structured.code) ===
				"organization_skill.github_selection_required"
			) {
				await loadRepositoryCatalog(requestedUrl, ticket);
			} else if (isCurrent(ticket)) {
				setError(resolveOrganizationSkillErrorMessage(failure));
			}
		} finally {
			if (isCurrent(ticket)) {
				setReviewing(false);
			}
		}
	};
	const previewSkill = async (
		skillUrl: string,
		rootUrl: string,
		ticket = ++request.current
	) => {
		setError(null);
		setReviewing(true);
		try {
			const response = await previewCurrentOrganizationSkillFromGitHub({
				expectedOrganizationId: input.organizationId,
				url: skillUrl,
			});
			if (isCurrent(ticket)) {
				setReview({
					operationId: crypto.randomUUID(),
					rootUrl,
					url: skillUrl,
					preview: response.preview,
				});
			}
		} catch (failure) {
			if (isCurrent(ticket)) {
				setError(resolveOrganizationSkillErrorMessage(failure));
			}
		} finally {
			if (isCurrent(ticket)) {
				setReviewing(false);
			}
		}
	};
	const submit = async () => {
		if (!review || review.rootUrl !== url.trim() || submitting.current) {
			return;
		}
		submitting.current = true;
		setError(null);
		try {
			const response = await install.mutateAsync({
				expectedOrganizationId: input.organizationId,
				expectedCommitSha: review.preview.source.commitSha,
				operationId: review.operationId,
				url: review.url,
			});
			input.onInstalled(response.skill);
		} catch (failure) {
			if (mounted.current) {
				setError(resolveOrganizationSkillErrorMessage(failure));
			}
		} finally {
			submitting.current = false;
		}
	};
	const installSelected = async () => {
		if (!catalog || submitting.current) {
			return;
		}
		const pending = catalog.preview.skills.filter(
			(skill) =>
				selectedUrls.has(skill.url) &&
				!skill.blocker &&
				!existingPaths.has(skill.path) &&
				batchResults.get(skill.url)?.status !== "installed"
		);
		if (pending.length === 0) {
			return;
		}
		submitting.current = true;
		setBatchInstalling(true);
		setError(null);
		let installedAny = false;
		for (const skill of pending) {
			const operationId =
				batchOperationIds.current.get(skill.url) ?? crypto.randomUUID();
			batchOperationIds.current.set(skill.url, operationId);
			try {
				const response = await importCurrentOrganizationSkillFromGitHub({
					expectedCommitSha: catalog.preview.commitSha,
					expectedOrganizationId: input.organizationId,
					operationId,
					url: skill.url,
				});
				if (response.skill.organizationId !== input.organizationId) {
					throw new Error("The installed Skill belongs to a different Team.");
				}
				installedAny = true;
				setBatchResults((previous) =>
					new Map(previous).set(skill.url, { status: "installed" })
				);
			} catch (failure) {
				setBatchResults((previous) =>
					new Map(previous).set(skill.url, {
						error: resolveOrganizationSkillErrorMessage(failure),
						status: "failed",
					})
				);
			}
		}
		if (installedAny && mounted.current) {
			input.onBatchChanged();
		}
		submitting.current = false;
		if (mounted.current) {
			setBatchInstalling(false);
		}
	};
	const pendingSelection = countPendingSelection(
		catalog,
		selectedUrls,
		batchResults,
		existingPaths
	);
	const batchButtonLabel = getBatchButtonLabel(
		batchInstalling,
		batchResults.size,
		pendingSelection
	);
	const description = getDialogDescription(Boolean(catalog), Boolean(review));
	return (
		<OrganizationSkillFlowDialog
			committing={install.isPending || batchInstalling}
			description={description}
			dirty={Boolean(url.trim()) && batchResults.size === 0}
			discardDescription="This skill hasn't been installed. Discarding will clear the URL and preview."
			discardTitle="Discard this import?"
			finalFocus={input.finalFocus}
			footer={
				<DialogFooter>
					<DialogClose
						disabled={install.isPending || batchInstalling}
						render={<Button variant="outline" />}
					>
						{batchResults.size > 0 ? "Done" : "Cancel"}
					</DialogClose>
					{review && (
						<>
							<Button
								disabled={install.isPending}
								onClick={() => {
									setReview(null);
									setError(null);
									request.current += 1;
								}}
								variant="outline"
							>
								Back
							</Button>
							<Button disabled={install.isPending} onClick={submit}>
								{install.isPending ? "Installing…" : "Install skill"}
							</Button>
						</>
					)}
					{!review && catalog && (
						<>
							<Button
								disabled={reviewing || batchInstalling}
								onClick={() => {
									setCatalog(null);
									setError(null);
									request.current += 1;
								}}
								variant="outline"
							>
								Back
							</Button>
							{(pendingSelection > 0 || batchResults.size === 0) && (
								<Button
									disabled={
										reviewing || batchInstalling || pendingSelection === 0
									}
									onClick={installSelected}
								>
									{batchButtonLabel}
								</Button>
							)}
						</>
					)}
					{!(review || catalog) && (
						<Button
							disabled={
								reviewing || !url.trim().startsWith("https://github.com/")
							}
							onClick={preview}
						>
							{reviewing ? "Reviewing…" : "Review skill"}
						</Button>
					)}
				</DialogFooter>
			}
			onClose={input.onClose}
			size="lg"
			title="Install from GitHub"
		>
			<div className="grid min-w-0 gap-4">
				{review && <GitHubSkillPreview preview={review.preview} />}
				{!review && catalog && (
					<OrganizationSkillRepositoryCatalog
						batchInstalling={batchInstalling}
						existingPaths={existingPaths}
						onReview={(skillUrl) => previewSkill(skillUrl, catalog.rootUrl)}
						preview={catalog.preview}
						results={batchResults}
						reviewing={reviewing}
						selectedUrls={selectedUrls}
						setSelectedUrls={setSelectedUrls}
					/>
				)}
				{!(review || catalog) && (
					<div className="grid gap-2">
						<Label htmlFor="skill-github-url">GitHub URL</Label>
						<Input
							autoCapitalize="none"
							autoCorrect="off"
							id="skill-github-url"
							onChange={(event) => changeUrl(event.target.value)}
							placeholder="https://github.com/team/repo/tree/main/skill"
							type="url"
							value={url}
						/>
						<p className="text-muted-foreground text-xs">
							Choose a repository to browse its skills, or link to one skill
							folder.
						</p>
					</div>
				)}
				{error && (
					<p className="text-destructive text-sm" role="alert">
						{error}
					</p>
				)}
			</div>
		</OrganizationSkillFlowDialog>
	);
}

function countPendingSelection(
	catalog: BoundCatalog | null,
	selectedUrls: Set<string>,
	results: Map<string, RepositoryBatchResult>,
	existingPaths: Set<string>
): number {
	return (
		catalog?.preview.skills.filter(
			(skill) =>
				selectedUrls.has(skill.url) &&
				!skill.blocker &&
				!existingPaths.has(skill.path) &&
				results.get(skill.url)?.status !== "installed"
		).length ?? 0
	);
}

function getExistingGitHubPaths(
	catalog: BoundCatalog | null,
	installedSkills: OrganizationSkillSummary[]
): Set<string> {
	if (!catalog) {
		return new Set();
	}
	return new Set(
		installedSkills.flatMap((skill) =>
			skill.source.kind === "github" &&
			skill.source.repository === catalog.preview.repository
				? [skill.source.path]
				: []
		)
	);
}

function getBatchButtonLabel(
	installing: boolean,
	resultCount: number,
	pendingCount: number
): string {
	if (installing) {
		return "Installing…";
	}
	const count = `${pendingCount} ${pendingCount === 1 ? "Skill" : "Skills"}`;
	if (resultCount > 0) {
		return `Retry ${count}`;
	}
	return `Install ${count}`;
}

function getDialogDescription(hasCatalog: boolean, hasReview: boolean): string {
	if (hasReview) {
		return "Review the source and warnings before adding this skill.";
	}
	if (hasCatalog) {
		return "Choose Skills to install, or review one Skill first.";
	}
	return "Paste a public GitHub repository, skill folder, or SKILL.md URL.";
}
