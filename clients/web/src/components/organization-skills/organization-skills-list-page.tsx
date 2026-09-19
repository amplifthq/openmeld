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
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
import { Label } from "@openmeld/ui/components/label";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import {
	ArrowClockwiseIcon,
	FileTextIcon,
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
import { useEffect, useMemo, useRef, useState } from "react";
import { AppEmptyState } from "#/components/app/app-empty-state";
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
import { useSkillCatalogView } from "./use-skill-catalog-view";

const NEW_SKILL_INSTRUCTIONS_MAX_CHARS = 100_000;
const PORTABLE_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function OrganizationSkillsListPage() {
	const { currentOrganization, storageScope } = useAppOrganization();
	return (
		<OrganizationSkillsCatalog
			key={JSON.stringify([storageScope, currentOrganization.id])}
		/>
	);
}

function OrganizationSkillsCatalog() {
	const { currentOrganization } = useAppOrganization();
	const isPersonalWorkspace = currentOrganization.isPersonal === true;
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const active = useRef(true);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const skillsQuery = useQuery(
		organizationSkillsQueryOptions({
			organizationId: currentOrganization.id,
		})
	);
	const { root, search, status, update } = useSkillCatalogView(
		Boolean(skillsQuery.data)
	);
	const [createOpen, setCreateOpen] = useState(false);
	const [installOpen, setInstallOpen] = useState(false);
	const normalizedSearch = search.trim().toLowerCase();
	const actions = skillsQuery.data?.canManage ? (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button />}>
				<PlusIcon aria-hidden="true" /> Add skill
			</DropdownMenuTrigger>
			<FluidDropdownMenuContent align="end" className="w-52">
				<FluidDropdownMenuItem index={0} onClick={() => setCreateOpen(true)}>
					<PlusIcon /> Create skill
				</FluidDropdownMenuItem>
				<FluidDropdownMenuItem index={1} onClick={() => setInstallOpen(true)}>
					<GithubLogoIcon /> Install from GitHub
				</FluidDropdownMenuItem>
			</FluidDropdownMenuContent>
		</DropdownMenu>
	) : undefined;
	const filteredSkills = useMemo(
		() =>
			(skillsQuery.data?.skills ?? [])
				.filter((skill) => {
					if (status !== "all" && skill.enabled !== (status === "enabled")) {
						return false;
					}
					if (!normalizedSearch) {
						return true;
					}
					return `${skill.name} ${skill.description}`
						.toLowerCase()
						.includes(normalizedSearch);
				})
				.sort(
					(a, b) =>
						b.updatedAt.localeCompare(a.updatedAt) ||
						a.name.localeCompare(b.name) ||
						a.id.localeCompare(b.id)
				),
		[normalizedSearch, skillsQuery.data?.skills, status]
	);
	const openSkill = async (skillId: string) => {
		await queryClient.invalidateQueries({
			queryKey: organizationSkillQueryKeys.list(currentOrganization.id),
		});
		// A create/install finishing after an Organization switch belongs to
		// its original cache, not to the newly displayed workspace or route.
		if (!active.current) {
			return;
		}
		await navigate({
			to: buildOrganizationSkillPath({
				orgSlug: currentOrganization.slug,
				skillId,
			}),
		});
	};

	return (
		<>
			<div
				className="@container/skills mx-auto grid w-full max-w-6xl gap-6"
				ref={root}
			>
				<AppPageHeader
					action={actions}
					description="Reusable instructions for agents in this workspace."
					title="Skills"
				/>
				<search className="flex flex-wrap items-center gap-3">
					<div className="relative min-w-0 flex-1 basis-48">
						<MagnifyingGlassIcon
							aria-hidden="true"
							className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
						/>
						<Input
							aria-label="Search skills"
							className="pl-9"
							onChange={(event) =>
								update({ search: event.target.value, scrollTop: 0 })
							}
							placeholder="Search skills"
							value={search}
						/>
					</div>
					<Select
						onValueChange={(value) => {
							if (
								value === "all" ||
								value === "enabled" ||
								value === "disabled"
							) {
								update({ status: value, scrollTop: 0 });
							}
						}}
						value={status}
					>
						<SelectTrigger
							aria-label="Filter skills by status"
							className="w-40"
							displayValue={`Status: ${{ all: "All", enabled: "Enabled", disabled: "Disabled" }[status]}`}
						/>
						<SelectContent>
							<SelectItem index={0} value="all">
								All
							</SelectItem>
							<SelectItem index={1} value="enabled">
								Enabled
							</SelectItem>
							<SelectItem index={2} value="disabled">
								Disabled
							</SelectItem>
						</SelectContent>
					</Select>
				</search>
				{skillsQuery.isError && skillsQuery.data ? (
					<div
						className="flex flex-wrap items-center gap-2 text-sm"
						role="alert"
					>
						<span>Could not refresh skills.</span>
						<Button
							onClick={() => skillsQuery.refetch()}
							size="sm"
							variant="outline"
						>
							Retry
						</Button>
					</div>
				) : null}

				<SkillsListContent
					emptyActions={
						normalizedSearch || status !== "all" ? (
							<Button
								onClick={() =>
									update({ search: "", status: "all", scrollTop: 0 })
								}
								variant="outline"
							>
								Clear filters
							</Button>
						) : undefined
					}
					filteredSkills={filteredSkills}
					isPersonalWorkspace={isPersonalWorkspace}
					orgSlug={currentOrganization.slug}
					query={skillsQuery}
					searching={normalizedSearch.length > 0 || status !== "all"}
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
	emptyActions?: React.ReactNode;
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
					<Skeleton className="h-16 w-full" key={item} />
				))}
			</div>
		);
	}
	if (input.query.isError && !input.query.data) {
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
		const guidance = input.query.data?.canManage
			? "Add a skill to give your agents a reusable way to work."
			: "Workspace admins can add skills here.";
		return (
			<AppEmptyState
				actions={input.emptyActions}
				description={
					input.searching ? "Try another name or clear your filters." : guidance
				}
				icon={<SparkleIcon aria-hidden="true" className="size-5" />}
				title={input.searching ? "No matching Skills" : "No Skills yet"}
			/>
		);
	}
	return (
		<ul aria-label="Skills" className="divide-y border-y">
			{input.filteredSkills.map((skill) => (
				<li key={skill.id}>
					<Link
						className="group grid min-h-18 @min-[760px]/skills:grid-cols-[minmax(0,1fr)_7rem_7rem_5rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-2 py-3 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
						to={buildOrganizationSkillPath({
							orgSlug: input.orgSlug,
							skillId: skill.id,
						})}
					>
						<div className="flex min-w-0 items-center gap-3">
							<FileTextIcon
								aria-hidden="true"
								className="size-5 shrink-0 text-muted-foreground"
							/>
							<div className="min-w-0">
								<h2 className="truncate font-medium text-sm">{skill.name}</h2>
								<p className="mt-1 line-clamp-2 text-muted-foreground text-sm">
									{skill.description}
								</p>
							</div>
						</div>
						<span className="@min-[760px]/skills:col-auto col-start-1 @min-[760px]/skills:pl-0 pl-8 text-muted-foreground text-xs">
							{skill.source.kind === "github" ? "GitHub" : "OpenMeld"}
							<span className="@min-[760px]/skills:hidden">
								{" "}
								·{" "}
								{new Intl.DateTimeFormat("en-US", {
									dateStyle: "medium",
								}).format(new Date(skill.updatedAt))}
							</span>
						</span>
						<time
							className="@min-[760px]/skills:block hidden text-muted-foreground text-xs"
							dateTime={skill.updatedAt}
						>
							{new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
								new Date(skill.updatedAt)
							)}
						</time>
						<Badge
							className="@min-[760px]/skills:col-auto col-start-2 @min-[760px]/skills:row-auto row-start-1"
							variant={skill.enabled ? "secondary" : "outline"}
						>
							{skill.enabled ? "Enabled" : "Disabled"}
						</Badge>
					</Link>
				</li>
			))}
		</ul>
	);
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
