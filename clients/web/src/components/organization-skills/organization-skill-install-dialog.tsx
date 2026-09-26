import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	OrganizationSkill,
	OrganizationSkillGitHubPreview,
	OrganizationSkillGitHubRepositoryPreview,
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

type BoundPreview = {
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
	onClose: () => void;
	onInstalled: (skill: OrganizationSkill) => void;
}) {
	const [url, setUrl] = useState("");
	const [review, setReview] = useState<BoundPreview | null>(null);
	const [catalog, setCatalog] = useState<BoundCatalog | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [reviewing, setReviewing] = useState(false);
	const request = useRef(0);
	const mounted = useRef(false);
	const submitting = useRef(false);
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
				setCatalog({ rootUrl: requestedUrl, preview: response.preview });
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
				setReview({ rootUrl, url: skillUrl, preview: response.preview });
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
	let description =
		"Paste a public GitHub repository, skill folder, or SKILL.md URL.";
	if (catalog) {
		description = "Choose a skill to review before installing it.";
	}
	if (review) {
		description = "Review the source and warnings before adding this skill.";
	}
	return (
		<OrganizationSkillFlowDialog
			committing={install.isPending}
			description={description}
			dirty={Boolean(url.trim())}
			discardDescription="This skill hasn't been installed. Discarding will clear the URL and preview."
			discardTitle="Discard this import?"
			finalFocus={input.finalFocus}
			footer={
				<DialogFooter>
					<DialogClose
						disabled={install.isPending}
						render={<Button variant="outline" />}
					>
						Cancel
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
						<Button
							disabled={reviewing}
							onClick={() => {
								setCatalog(null);
								setError(null);
								request.current += 1;
							}}
							variant="outline"
						>
							Back
						</Button>
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
					<div className="grid max-h-96 gap-2 overflow-y-auto">
						<p className="text-muted-foreground text-sm">
							{catalog.preview.skills.length} skills found at commit{" "}
							{catalog.preview.commitSha.slice(0, 12)}.
						</p>
						{catalog.preview.skills.map((skill) => (
							<Button
								className="h-auto justify-start text-left"
								disabled={reviewing || Boolean(skill.blocker)}
								key={skill.url}
								onClick={() => previewSkill(skill.url, catalog.rootUrl)}
								variant="outline"
							>
								<span className="grid min-w-0 gap-1 py-1">
									<span className="truncate">
										{skill.path || "Repository root"}
									</span>
									<span className="text-muted-foreground text-xs">
										{skill.blocker?.message ??
											`${skill.fileCount} ${skill.fileCount === 1 ? "file" : "files"} · ${skill.totalBytes.toLocaleString()} bytes`}
									</span>
								</span>
							</Button>
						))}
					</div>
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
