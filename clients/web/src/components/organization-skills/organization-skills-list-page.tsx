"use client";

import type {
	ListOrganizationSkillsResponse,
	OrganizationSkill,
	OrganizationSkillSummary,
} from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Input } from "@openmeld/ui/components/input";
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
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { AppEmptyState } from "#/components/app/app-empty-state";
import { AppPageHeader } from "#/components/app/app-page-header";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { buildOrganizationSkillPath } from "#/lib/organizations/organization-routes";
import type { OrganizationSkillFailure } from "#/lib/organizations/organization-skills";
import {
	organizationSkillQueryKeys,
	organizationSkillsQueryOptions,
} from "#/query/organizations/organization-skills";
import { CreateSkillDialog } from "./organization-skill-create-dialog";
import { InstallSkillDialog } from "./organization-skill-install-dialog";
import { useSkillCatalogView } from "./use-skill-catalog-view";

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
	const addRef = useRef<HTMLButtonElement>(null);
	const [completedSkill, setCompletedSkill] =
		useState<OrganizationSkill | null>(null);
	const [completionError, setCompletionError] = useState<string | null>(null);
	const normalizedSearch = search.trim().toLowerCase();
	const actions = skillsQuery.data?.canManage ? (
		<DropdownMenu>
			<DropdownMenuTrigger ref={addRef} render={<Button />}>
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
	const openSkill = (skill: OrganizationSkill) => {
		if (!active.current || skill.organizationId !== currentOrganization.id) {
			return;
		}
		setCreateOpen(false);
		setInstallOpen(false);
		setCompletedSkill(skill);
	};
	useEffect(() => {
		if (!completedSkill) {
			return;
		}
		// The completed form and its guard have unmounted before navigation.
		// A list refresh must not hold a confirmed creation/installation hostage.
		queryClient.setQueryData(
			organizationSkillQueryKeys.detail(
				currentOrganization.id,
				completedSkill.id
			),
			{ skill: completedSkill }
		);
		queryClient
			.invalidateQueries({
				queryKey: organizationSkillQueryKeys.list(currentOrganization.id),
			})
			.catch(console.error);
		setCompletedSkill(null);
		navigate({
			to: buildOrganizationSkillPath({
				orgSlug: currentOrganization.slug,
				skillId: completedSkill.id,
			}),
		}).catch(() => {
			if (active.current) {
				setCompletionError("The skill was added. Open it from the catalog.");
			}
		});
	}, [
		completedSkill,
		currentOrganization.id,
		currentOrganization.slug,
		navigate,
		queryClient,
	]);

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
				{completionError && (
					<output className="text-sm">{completionError}</output>
				)}
				<search
					aria-label="Find skills"
					className="flex flex-wrap items-center gap-3"
				>
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

			{createOpen && (
				<CreateSkillDialog
					finalFocus={addRef}
					isPersonalWorkspace={isPersonalWorkspace}
					onClose={() => setCreateOpen(false)}
					onCreated={openSkill}
					organizationId={currentOrganization.id}
				/>
			)}
			{installOpen && (
				<InstallSkillDialog
					finalFocus={addRef}
					onClose={() => setInstallOpen(false)}
					onInstalled={openSkill}
					organizationId={currentOrganization.id}
				/>
			)}
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
