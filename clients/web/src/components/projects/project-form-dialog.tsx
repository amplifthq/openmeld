"use client";

import {
	buildCanonicalRepositoryUrl,
	buildRepositoryFingerprint,
	generateProjectSlug,
	normalizeRepositoryRemote,
} from "@openmeld/projects";
import {
	PROJECT_NAME_MAX_CHARS,
	PROJECT_SLUG_MAX_CHARS,
} from "@openmeld/schemas/schemas";
import type { Project } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
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
import { resolveStatusToneTextClassName } from "@openmeld/ui/lib/status-tone";
import { type FormEvent, useState } from "react";

const PROJECT_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const FILE_URL_PATTERN = /^file:/iu;
const LOCAL_PATH_PATTERN = /^(?:\.{0,2}\/|~\/|\/)/u;
const WINDOWS_PATH_PATTERN = /^[a-z]:[\\/]/iu;

export type ProjectFormSubmission = {
	name?: string;
	repositoryFingerprint?: string | null;
	repositoryUrl?: string | null;
	slug?: string;
};

export function ProjectFormDialog(input: {
	errorMessage: string | null;
	onOpenChange: (open: boolean) => void;
	onSubmit: (values: ProjectFormSubmission) => Promise<void> | void;
	open: boolean;
	project: Project | null;
	submitting: boolean;
}) {
	const [name, setName] = useState(input.project?.name ?? "");
	const [repositoryUrl, setRepositoryUrl] = useState(
		input.project?.repositoryUrl ?? ""
	);
	const [slug, setSlug] = useState(
		input.project?.slug ?? generateProjectSlug("")
	);
	const [slugEdited, setSlugEdited] = useState(false);
	const [preparing, setPreparing] = useState(false);

	const normalizedName = name.trim();
	const normalizedRepository = normalizeRepositoryRemote(repositoryUrl);
	const canonicalRepositoryUrl = buildCanonicalRepositoryUrl(repositoryUrl);
	const normalizedSlug = slug.trim();
	const repositoryUrlIsInvalid =
		repositoryUrl.trim().length > 0 && normalizedRepository === null;
	const slugIsValid = PROJECT_SLUG_PATTERN.test(normalizedSlug);
	const nameChanged =
		input.project === null || normalizedName !== input.project.name;
	const slugChanged =
		slugEdited &&
		(input.project === null || normalizedSlug !== input.project.slug);
	const repositoryChanged =
		input.project === null
			? canonicalRepositoryUrl !== null
			: canonicalRepositoryUrl !== (input.project.repositoryUrl ?? null);
	const changed = nameChanged || slugChanged || repositoryChanged;
	const pending = input.submitting || preparing;
	const canSubmit =
		!pending && normalizedName.length > 0 && slugIsValid && changed;
	const submitLabel = resolveSubmitLabel({
		editing: input.project !== null,
		pending,
	});

	const updateName = (value: string) => {
		setName(value);
		if (!(input.project || slugEdited)) {
			setSlug(generateProjectSlug(value));
		}
	};

	const submit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!canSubmit) {
			return;
		}
		setPreparing(true);
		await prepareProjectFormSubmission({
			canonicalRepositoryUrl,
			name: normalizedName,
			nameChanged,
			repositoryUrl,
			repositoryUrlIsValid: normalizedRepository !== null,
			repositoryChanged,
			slug: normalizedSlug,
			slugChanged,
		})
			.then(input.onSubmit)
			.finally(() => setPreparing(false));
	};

	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{input.project ? `Edit ${input.project.name}` : "Add a Project"}
					</DialogTitle>
					<DialogDescription>
						Projects connect shared repository identity with folders on each
						computer. Local paths stay on that computer.
					</DialogDescription>
				</DialogHeader>
				<form className="grid gap-4" noValidate onSubmit={submit}>
					<div className="grid gap-1.5">
						<Label htmlFor="project-name">Project name</Label>
						<Input
							autoFocus
							id="project-name"
							maxLength={PROJECT_NAME_MAX_CHARS}
							onChange={(event) => updateName(event.target.value)}
							placeholder="OpenMeld Web"
							required
							value={name}
						/>
					</div>
					<div className="grid gap-1.5">
						<Label htmlFor="project-repository-url">
							Repository URL (optional)
						</Label>
						<Input
							aria-describedby="project-repository-help"
							aria-invalid={repositoryUrlIsInvalid}
							id="project-repository-url"
							onChange={(event) => setRepositoryUrl(event.target.value)}
							placeholder="https://github.com/acme/openmeld"
							value={repositoryUrl}
						/>
						<p
							className={resolveStatusToneTextClassName(
								repositoryUrlIsInvalid ? "warning" : "muted"
							)}
							id="project-repository-help"
						>
							{resolveRepositoryHelp({
								hasSavedFingerprint: Boolean(
									input.project?.repositoryFingerprint
								),
								normalizedRepository,
								repositoryUrl,
								repositoryUrlIsInvalid,
								savedRepositoryUrl: input.project?.repositoryUrl ?? null,
							})}
						</p>
					</div>
					<details className="border-y py-2">
						<summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
							<span>Advanced</span>
							<code className="font-mono text-muted-foreground text-xs">
								{normalizedSlug}
							</code>
						</summary>
						<div className="mt-3 grid gap-1.5">
							<Label htmlFor="project-cli-slug">CLI slug</Label>
							<Input
								aria-describedby="project-cli-slug-help"
								aria-invalid={!slugIsValid}
								id="project-cli-slug"
								maxLength={PROJECT_SLUG_MAX_CHARS}
								onChange={(event) => {
									setSlugEdited(true);
									setSlug(event.target.value);
								}}
								pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
								required
								value={slug}
							/>
							<p
								className="text-muted-foreground text-xs"
								id="project-cli-slug-help"
							>
								Use lowercase letters, numbers, and single hyphens. Renaming a
								Project does not change its CLI slug.
							</p>
						</div>
					</details>
					{input.errorMessage ? (
						<p
							className={resolveStatusToneTextClassName("danger")}
							role="alert"
						>
							{input.errorMessage}
						</p>
					) : null}
					<DialogFooter>
						<Button
							disabled={pending}
							onClick={() => input.onOpenChange(false)}
							type="button"
							variant="outline"
						>
							Cancel
						</Button>
						<Button disabled={!canSubmit} type="submit">
							{submitLabel}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}

async function prepareProjectFormSubmission(input: {
	canonicalRepositoryUrl: string | null;
	name: string;
	nameChanged: boolean;
	repositoryChanged: boolean;
	repositoryUrl: string;
	repositoryUrlIsValid: boolean;
	slug: string;
	slugChanged: boolean;
}): Promise<ProjectFormSubmission> {
	const repositoryFingerprint = input.repositoryUrlIsValid
		? await buildRepositoryFingerprint(input.canonicalRepositoryUrl ?? "")
		: null;
	return {
		...(input.nameChanged ? { name: input.name } : {}),
		...(input.repositoryChanged
			? {
					repositoryFingerprint,
					repositoryUrl: input.canonicalRepositoryUrl,
				}
			: {}),
		...(input.slugChanged ? { slug: input.slug } : {}),
	};
}

function resolveRepositoryHelp(input: {
	hasSavedFingerprint: boolean;
	normalizedRepository: string | null;
	repositoryUrl: string;
	repositoryUrlIsInvalid: boolean;
	savedRepositoryUrl: string | null;
}): string {
	if (
		input.savedRepositoryUrl &&
		input.savedRepositoryUrl ===
			buildCanonicalRepositoryUrl(input.repositoryUrl)
	) {
		return `Saved as ${input.savedRepositoryUrl}.`;
	}
	if (input.normalizedRepository) {
		return `This will be recognized as ${input.normalizedRepository}.`;
	}
	if (input.repositoryUrlIsInvalid) {
		return isLocalRepositoryReference(input.repositoryUrl)
			? "OpenMeld can’t use a local path or file URL as a repository identity. You can still create this Project without one."
			: "OpenMeld can’t use that Repository URL. Use a Git, HTTP, HTTPS, or SSH remote. You can still create this Project without one.";
	}
	return input.hasSavedFingerprint
		? "A repository identity is saved, but its URL is unavailable. Enter it once to show it here."
		: "OpenMeld saves a safe HTTPS version so you can see which repository this Project uses.";
}

function isLocalRepositoryReference(value: string): boolean {
	const normalized = value.trim();
	return (
		FILE_URL_PATTERN.test(normalized) ||
		LOCAL_PATH_PATTERN.test(normalized) ||
		WINDOWS_PATH_PATTERN.test(normalized) ||
		normalized.startsWith("\\\\")
	);
}

function resolveSubmitLabel(input: {
	editing: boolean;
	pending: boolean;
}): string {
	if (input.pending) {
		return "Saving…";
	}
	return input.editing ? "Save changes" : "Create Project";
}
