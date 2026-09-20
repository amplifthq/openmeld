import type {
	OrganizationSkill,
	OrganizationSkillGitHubPreview,
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
	resolveOrganizationSkillErrorMessage,
} from "#/lib/organizations/organization-skills";
import { OrganizationSkillFlowDialog } from "./organization-skill-flow-dialog";
import { GitHubSkillPreview } from "./organization-skill-import-preview";

type BoundPreview = { url: string; preview: OrganizationSkillGitHubPreview };

export function InstallSkillDialog(input: {
	organizationId: string;
	finalFocus: RefObject<HTMLButtonElement | null>;
	onClose: () => void;
	onInstalled: (skill: OrganizationSkill) => void;
}) {
	const [url, setUrl] = useState("");
	const [review, setReview] = useState<BoundPreview | null>(null);
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
		setReviewing(false);
		setError(null);
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
			if (mounted.current && request.current === ticket) {
				setReview({ url: requestedUrl, preview: response.preview });
			}
		} catch (failure) {
			if (mounted.current && request.current === ticket) {
				setError(resolveOrganizationSkillErrorMessage(failure));
			}
		} finally {
			if (mounted.current && request.current === ticket) {
				setReviewing(false);
			}
		}
	};
	const submit = async () => {
		if (!review || review.url !== url.trim() || submitting.current) {
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
	return (
		<OrganizationSkillFlowDialog
			committing={install.isPending}
			description={
				review
					? "Review the source and warnings before adding this skill."
					: "Paste a public GitHub repository, skill folder, or SKILL.md URL."
			}
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
					{review ? (
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
					) : (
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
				{review ? (
					<GitHubSkillPreview preview={review.preview} />
				) : (
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
							For a repository with several skills, use the exact skill folder.
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
