"use client";

import type {
	ListOrganizationSkillsResponse,
	OrganizationSkillGitHubPreview,
	OrganizationSkillSummary,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
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
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import {
	ArrowClockwiseIcon,
	GithubLogoIcon,
	MagnifyingGlassIcon,
	PlusIcon,
	SparkleIcon,
} from "@phosphor-icons/react";
import {
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { MarkdownEditor } from "#/components/editor/markdown-editor";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationSkillPath } from "#/lib/organizations/organization-routes";
import {
	createCurrentOrganizationSkill,
	importCurrentOrganizationSkillFromGitHub,
	type OrganizationSkillFailure,
	previewCurrentOrganizationSkillFromGitHub,
	resolveOrganizationSkillErrorMessage,
} from "#/lib/organizations/organization-skills";
import {
	organizationSkillQueryKeys,
	organizationSkillsQueryOptions,
} from "#/query/organizations/organization-skills";

const NEW_SKILL_INSTRUCTIONS_MAX_CHARS = 100_000;
const PORTABLE_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function OrganizationSkillsListPage() {
	const { currentOrganization } = useAppOrganization();
	const isPersonalWorkspace = currentOrganization.isPersonal === true;
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const skillsQuery = useQuery(
		organizationSkillsQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const [search, setSearch] = useState("");
	const [createOpen, setCreateOpen] = useState(false);
	const [installOpen, setInstallOpen] = useState(false);
	const normalizedSearch = search.trim().toLowerCase();
	const filteredSkills = useMemo(
		() =>
			(skillsQuery.data?.skills ?? []).filter((skill) => {
				if (!normalizedSearch) {
					return true;
				}
				return `${skill.name} ${skill.description}`
					.toLowerCase()
					.includes(normalizedSearch);
			}),
		[normalizedSearch, skillsQuery.data?.skills]
	);
	const openSkill = async (skillId: string) => {
		await queryClient.invalidateQueries({
			queryKey: organizationSkillQueryKeys.list(currentOrganization.id),
		});
		await navigate({
			to: buildOrganizationSkillPath({
				orgSlug: currentOrganization.slug,
				skillId,
			}),
		});
	};

	return (
		<>
			<div className="grid gap-6">
				<AppPageHeader
					action={
						skillsQuery.data?.canManage ? (
							<>
								<Button onClick={() => setInstallOpen(true)} variant="outline">
									<GithubLogoIcon aria-hidden="true" /> Install from GitHub
								</Button>
								<Button onClick={() => setCreateOpen(true)}>
									<PlusIcon aria-hidden="true" /> Create skill
								</Button>
							</>
						) : undefined
					}
					description={
						isPersonalWorkspace
							? "Manage the optional working methods your Center Agent and local agents use in this personal workspace."
							: "Manage the optional working methods your Organization shares with Center Agent and local agents."
					}
					eyebrow={isPersonalWorkspace ? "Personal workspace" : "Organization"}
					title="Skills"
				/>

				<div className="relative max-w-xl">
					<MagnifyingGlassIcon
						aria-hidden="true"
						className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						aria-label="Search Skills"
						className="pl-9"
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Search skills"
						value={search}
					/>
				</div>

				<SkillsListContent
					filteredSkills={filteredSkills}
					isPersonalWorkspace={isPersonalWorkspace}
					orgSlug={currentOrganization.slug}
					query={skillsQuery}
					searching={normalizedSearch.length > 0}
				/>
			</div>

			<CreateSkillDialog
				isPersonalWorkspace={isPersonalWorkspace}
				onCreated={openSkill}
				onOpenChange={setCreateOpen}
				open={createOpen}
				organizationId={currentOrganization.id}
			/>
			<InstallSkillDialog
				onInstalled={openSkill}
				onOpenChange={setInstallOpen}
				open={installOpen}
				organizationId={currentOrganization.id}
			/>
		</>
	);
}

function SkillsListContent(input: {
	filteredSkills: OrganizationSkillSummary[];
	isPersonalWorkspace: boolean;
	orgSlug: string;
	query: UseQueryResult<
		ListOrganizationSkillsResponse,
		OrganizationSkillFailure
	>;
	searching: boolean;
}) {
	if (input.query.isPending) {
		return (
			<div className="grid gap-3">
				{[0, 1, 2].map((item) => (
					<Skeleton className="h-28 w-full" key={item} />
				))}
			</div>
		);
	}
	if (input.query.isError) {
		return (
			<div className="grid justify-items-start gap-3 rounded-md border border-destructive/50 bg-destructive/5 p-6">
				<h2 className="font-medium text-lg">Could not load Skills</h2>
				<p className="text-muted-foreground text-sm">
					{input.isPersonalWorkspace
						? "OpenMeld could not load this personal workspace's Skills. Try again."
						: "OpenMeld could not load this Organization's Skills. Try again."}
				</p>
				<Button onClick={() => input.query.refetch()} variant="outline">
					<ArrowClockwiseIcon aria-hidden="true" /> Retry
				</Button>
			</div>
		);
	}
	if (input.filteredSkills.length === 0) {
		return (
			<div className="grid justify-items-center gap-3 rounded-md border px-6 py-14 text-center">
				<SparkleIcon
					aria-hidden="true"
					className="size-7 text-muted-foreground"
				/>
				<h2 className="font-medium text-lg">
					{input.searching ? "No matching Skills" : "No Skills yet"}
				</h2>
				<p className="max-w-md text-muted-foreground text-sm">
					{resolveEmptySkillsDescription({
						isPersonalWorkspace: input.isPersonalWorkspace,
						searching: input.searching,
					})}
				</p>
			</div>
		);
	}
	return (
		<FluidCardGroup className="grid gap-3" role="list">
			{input.filteredSkills.map((skill) => (
				<FluidCardItem itemId={skill.id} key={skill.id} role="listitem">
					<Link
						className="relative z-10 grid h-full gap-2 rounded-md border border-border/70 bg-transparent p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
						to={buildOrganizationSkillPath({
							orgSlug: input.orgSlug,
							skillId: skill.id,
						})}
					>
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div className="min-w-0">
								<h2 className="truncate font-medium text-base">{skill.name}</h2>
								<p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
									{skill.description}
								</p>
							</div>
							<Badge variant={skill.enabled ? "secondary" : "outline"}>
								{skill.enabled ? "Enabled" : "Disabled"}
							</Badge>
						</div>
						<p className="text-muted-foreground text-xs">
							{formatSkillSource(skill)} · Updated{" "}
							{new Intl.DateTimeFormat("en-US", {
								dateStyle: "medium",
							}).format(new Date(skill.updatedAt))}
						</p>
					</Link>
				</FluidCardItem>
			))}
		</FluidCardGroup>
	);
}

function resolveEmptySkillsDescription(input: {
	isPersonalWorkspace: boolean;
	searching: boolean;
}): string {
	if (input.searching) {
		return "Try a different name or description.";
	}
	if (input.isPersonalWorkspace) {
		return "This is valid. Skills are optional and only appear after you create or install one.";
	}
	return "This is valid. Organization Skills are optional and only appear after your team creates or installs one.";
}

function CreateSkillDialog(input: {
	onCreated: (skillId: string) => Promise<void>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	organizationId: string;
	isPersonalWorkspace: boolean;
}) {
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [instructions, setInstructions] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const createMutation = useMutation({
		mutationFn: async () =>
			await createCurrentOrganizationSkill({
				description,
				expectedOrganizationId: input.organizationId,
				instructions,
				name,
			}),
		onError: (error) =>
			setErrorMessage(resolveOrganizationSkillErrorMessage(error)),
		onSuccess: async (response) => {
			input.onOpenChange(false);
			setName("");
			setDescription("");
			setInstructions("");
			await input.onCreated(response.skill.id);
		},
	});
	const valid =
		PORTABLE_SKILL_NAME_PATTERN.test(name.trim()) &&
		description.trim().length > 0 &&
		instructions.length <= NEW_SKILL_INSTRUCTIONS_MAX_CHARS;

	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Create skill</DialogTitle>
					<DialogDescription>
						{input.isPersonalWorkspace
							? "Add an optional working method for this personal workspace."
							: "Add an optional working method for this Organization."}
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label htmlFor="new-skill-name">Name</Label>
						<Input
							disabled={createMutation.isPending}
							id="new-skill-name"
							maxLength={64}
							onChange={(event) => setName(event.target.value)}
							placeholder="weekly-customer-risk-review"
							value={name}
						/>
						<p className="text-muted-foreground text-xs">
							Use lowercase letters, numbers, and single hyphens.
						</p>
					</div>
					<div className="grid gap-2">
						<Label htmlFor="new-skill-description">Description</Label>
						<Input
							disabled={createMutation.isPending}
							id="new-skill-description"
							maxLength={1024}
							onChange={(event) => setDescription(event.target.value)}
							placeholder="Review customer signals and summarize weekly risks."
							value={description}
						/>
					</div>
					<div className="grid gap-2">
						<Label>Instructions</Label>
						<MarkdownEditor
							disabled={createMutation.isPending}
							maxChars={NEW_SKILL_INSTRUCTIONS_MAX_CHARS}
							onChange={setInstructions}
							value={instructions}
						/>
					</div>
					{errorMessage ? (
						<p className="text-destructive text-sm" role="alert">
							{errorMessage}
						</p>
					) : null}
				</div>
				<DialogFooter>
					<Button
						disabled={createMutation.isPending}
						onClick={() => input.onOpenChange(false)}
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={!valid || createMutation.isPending}
						onClick={() => {
							setErrorMessage(null);
							createMutation.mutate();
						}}
					>
						{createMutation.isPending ? "Creating…" : "Create skill"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function InstallSkillDialog(input: {
	onInstalled: (skillId: string) => Promise<void>;
	onOpenChange: (open: boolean) => void;
	open: boolean;
	organizationId: string;
}) {
	const [url, setUrl] = useState("");
	const [preview, setPreview] = useState<OrganizationSkillGitHubPreview | null>(
		null
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const previewMutation = useMutation({
		mutationFn: async () =>
			await previewCurrentOrganizationSkillFromGitHub({
				expectedOrganizationId: input.organizationId,
				url,
			}),
		onError: (error) =>
			setErrorMessage(resolveOrganizationSkillErrorMessage(error)),
		onSuccess: (response) => setPreview(response.preview),
	});
	const installMutation = useMutation({
		mutationFn: async () => {
			if (!preview) {
				throw new Error("The GitHub Skill preview is missing its commit.");
			}
			return await importCurrentOrganizationSkillFromGitHub({
				expectedCommitSha: preview.source.commitSha,
				expectedOrganizationId: input.organizationId,
				url,
			});
		},
		onError: (error) =>
			setErrorMessage(resolveOrganizationSkillErrorMessage(error)),
		onSuccess: async (response) => {
			input.onOpenChange(false);
			setUrl("");
			setPreview(null);
			await input.onInstalled(response.skill.id);
		},
	});
	const busy = previewMutation.isPending || installMutation.isPending;
	const handleOpenChange = (open: boolean) => {
		if (!(open || busy)) {
			setErrorMessage(null);
			setPreview(null);
			setUrl("");
		}
		input.onOpenChange(open);
	};

	return (
		<Dialog onOpenChange={handleOpenChange} open={input.open}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Install from GitHub</DialogTitle>
					<DialogDescription>
						Paste a public GitHub repository, Skill folder, or SKILL.md URL,
						then review the exact commit before installing.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-4">
					{preview ? (
						<GitHubSkillPreview preview={preview} />
					) : (
						<div className="grid gap-2">
							<Label htmlFor="skill-github-url">GitHub URL</Label>
							<Input
								autoCapitalize="none"
								autoCorrect="off"
								disabled={busy}
								id="skill-github-url"
								onChange={(event) => {
									setErrorMessage(null);
									setUrl(event.target.value);
								}}
								placeholder="https://github.com/org/repo/tree/main/my-skill"
								type="url"
								value={url}
							/>
						</div>
					)}
					{errorMessage ? (
						<p className="text-destructive text-sm" role="alert">
							{errorMessage}
						</p>
					) : null}
				</div>
				<DialogFooter>
					<Button
						disabled={busy}
						onClick={() => handleOpenChange(false)}
						variant="outline"
					>
						Cancel
					</Button>
					{preview ? (
						<>
							<Button
								disabled={busy}
								onClick={() => {
									setErrorMessage(null);
									setPreview(null);
								}}
								variant="outline"
							>
								Back
							</Button>
							<Button
								disabled={busy}
								onClick={() => {
									setErrorMessage(null);
									installMutation.mutate();
								}}
							>
								{installMutation.isPending ? "Installing…" : "Install skill"}
							</Button>
						</>
					) : (
						<Button
							disabled={busy || !url.trim().startsWith("https://github.com/")}
							onClick={() => {
								setErrorMessage(null);
								previewMutation.mutate();
							}}
						>
							{previewMutation.isPending ? "Reviewing…" : "Review skill"}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function GitHubSkillPreview(input: {
	preview: OrganizationSkillGitHubPreview;
}) {
	const { preview } = input;
	return (
		<div className="grid gap-4 rounded-md border p-4">
			<div>
				<h3 className="font-medium text-base">{preview.portable.name}</h3>
				<p className="mt-1 text-muted-foreground text-sm">
					{preview.portable.description}
				</p>
			</div>
			<dl className="grid gap-2 text-sm sm:grid-cols-2">
				<div>
					<dt className="text-muted-foreground text-xs">Commit</dt>
					<dd className="mt-1 font-mono text-xs">
						{preview.source.commitSha.slice(0, 12)}
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground text-xs">Files</dt>
					<dd className="mt-1">{preview.files.length}</dd>
				</div>
				<div>
					<dt className="text-muted-foreground text-xs">Instructions</dt>
					<dd className="mt-1">
						{preview.instructionsCharacters.toLocaleString("en-US")} characters
					</dd>
				</div>
				<div>
					<dt className="text-muted-foreground text-xs">License</dt>
					<dd className="mt-1">
						{preview.portable.license ?? "Not specified"}
					</dd>
				</div>
			</dl>
			{preview.warnings.length > 0 ? (
				<div className="grid gap-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
					{preview.warnings.map((warning) => (
						<p className="text-sm" key={warning}>
							{warning}
						</p>
					))}
				</div>
			) : null}
		</div>
	);
}

function formatSkillSource(skill: OrganizationSkillSummary): string {
	if (skill.source.kind === "created") {
		return "Created in OpenMeld";
	}
	return `GitHub ${skill.source.commitSha.slice(0, 7)}`;
}
