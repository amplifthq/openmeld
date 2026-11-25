import type { OrganizationDashboard } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import {
	type DashboardChange,
	listCurrentDashboards,
	mutateCurrentDashboards,
} from "#/lib/organizations/dashboards";
import { buildDashboardArtifactLink } from "./dashboard-artifact";
import { DashboardEditor, type DashboardPrefill } from "./dashboard-editor";
import { GitHubIssuesDashboard } from "./github-issues-dashboard";

const KIND_LABELS = {
	github_issues: "GitHub Issues",
	ugc: "UGC",
	traffic: "Traffic",
} as const;

type DashboardScope = {
	accountId: string;
	organizationId: string;
	orgSlug: string;
};

export function DashboardsPage({
	id,
	prefill,
	...scope
}: DashboardScope & { id?: string; prefill?: DashboardPrefill }) {
	const [editing, setEditing] = useState(Boolean(prefill));
	const [confirmArchive, setConfirmArchive] = useState(false);
	const queryClient = useQueryClient();
	const queryKey = [
		"organization-dashboards",
		scope.accountId,
		scope.organizationId,
	] as const;
	const query = useQuery({
		queryKey: [...queryKey, id ?? null],
		queryFn: ({ signal }) =>
			listCurrentDashboards({
				id,
				organizationId: scope.organizationId,
				signal,
			}),
		gcTime: 0,
		retry: false,
	});
	const mutation = useMutation({
		mutationFn: (change: DashboardChange) =>
			mutateCurrentDashboards({
				mutation: change,
				organizationId: scope.organizationId,
			}),
		onSuccess: async () => {
			setEditing(false);
			setConfirmArchive(false);
			await queryClient.invalidateQueries({ queryKey });
		},
	});
	const dashboards = query.data?.dashboards ?? [];
	const selected = id
		? dashboards.find((dashboard) => dashboard.id === id)
		: undefined;
	return (
		<section className="flex w-full min-w-0 flex-col gap-5 py-[var(--app-page-block-padding)]">
			{id && (
				<Link
					className="w-fit text-sm underline underline-offset-4"
					params={{ orgSlug: scope.orgSlug }}
					search={{}}
					to="/o/$orgSlug/dashboard"
				>
					All dashboards
				</Link>
			)}
			<AppPageHeader
				description="Create and share dashboards in this workspace. GitHub issue access is checked separately for each viewer."
				title={selected?.name ?? "Dashboards"}
			/>
			{query.isPending && <output>Loading dashboards…</output>}
			{query.isError && (
				<div role="alert">
					<p>Dashboards couldn’t be loaded.</p>
					<Button onClick={() => query.refetch()} size="sm" variant="secondary">
						Try again
					</Button>
				</div>
			)}
			{query.isSuccess && id && !selected && (
				<p className="text-muted-foreground text-sm">
					This dashboard is no longer available.
				</p>
			)}
			{query.isSuccess && selected && (
				<>
					{selected.canManage && !editing && (
						<div className="flex flex-wrap gap-2">
							<Button
								disabled={selected.hasArtifact && !selected.artifact}
								onClick={() => {
									mutation.reset();
									setEditing(true);
								}}
								variant="secondary"
							>
								Edit dashboard
							</Button>
							<Button
								onClick={() => {
									mutation.reset();
									setConfirmArchive(true);
								}}
								variant="ghost"
							>
								Archive dashboard
							</Button>
						</div>
					)}
					{confirmArchive && (
						<div className="flex flex-wrap items-center gap-2 rounded-md border p-3">
							<p className="text-sm">
								Archive this dashboard for everyone? The source data won’t
								change.
							</p>
							<Button
								disabled={mutation.isPending}
								onClick={() =>
									mutation.mutate({ operation: "archive", id: selected.id })
								}
								variant="destructive"
							>
								Confirm archive
							</Button>
							<Button
								disabled={mutation.isPending}
								onClick={() => setConfirmArchive(false)}
								variant="secondary"
							>
								Cancel
							</Button>
						</div>
					)}
					{editing ? (
						<DashboardEditor
							busy={mutation.isPending}
							dashboard={selected}
							onCancel={() => setEditing(false)}
							onSave={mutation.mutate}
							orgSlug={scope.orgSlug}
						/>
					) : (
						<DashboardContents dashboard={selected} {...scope} />
					)}
				</>
			)}
			{query.isSuccess && !id && (
				<>
					{editing ? (
						<DashboardEditor
							busy={mutation.isPending}
							onCancel={() => setEditing(false)}
							onSave={mutation.mutate}
							orgSlug={scope.orgSlug}
							prefill={prefill}
						/>
					) : (
						<Button
							className="w-fit"
							onClick={() => {
								mutation.reset();
								setEditing(true);
							}}
						>
							New dashboard
						</Button>
					)}
					{dashboards.length > 0 ? (
						<DashboardList dashboards={dashboards} orgSlug={scope.orgSlug} />
					) : (
						<p className="text-muted-foreground text-sm">No dashboards yet.</p>
					)}
				</>
			)}
			{mutation.isError && (
				<p role="alert">
					The dashboard couldn’t be saved. Check your access and try again.
				</p>
			)}
		</section>
	);
}

function DashboardList({
	dashboards,
	orgSlug,
}: {
	dashboards: OrganizationDashboard[];
	orgSlug: string;
}) {
	return (
		<ul className="grid gap-2 sm:grid-cols-2">
			{dashboards.map((dashboard) => (
				<li key={dashboard.id}>
					<Link
						className="block rounded-md border p-4 hover:bg-muted/50"
						params={{ orgSlug }}
						search={{ id: dashboard.id }}
						to="/o/$orgSlug/dashboard"
					>
						<span className="block font-medium">{dashboard.name}</span>
						<span className="text-muted-foreground text-sm">
							{KIND_LABELS[dashboard.kind]}
						</span>
					</Link>
				</li>
			))}
		</ul>
	);
}

function DashboardContents({
	dashboard,
	...scope
}: DashboardScope & { dashboard: OrganizationDashboard }) {
	if (dashboard.kind === "github_issues" && dashboard.repository) {
		return (
			<GitHubIssuesDashboard
				key={dashboard.repository}
				repository={dashboard.repository}
				{...scope}
			/>
		);
	}
	if (dashboard.artifact) {
		return (
			<section className="flex flex-col gap-2 rounded-md border p-4">
				<h2 className="font-medium">Linked dashboard</h2>
				<p className="text-muted-foreground text-sm">
					Opens the original preview. Its access rules still apply.
				</p>
				<a
					className="w-fit text-sm underline underline-offset-4"
					href={buildDashboardArtifactLink(dashboard.artifact, scope.orgSlug)}
					rel="noopener noreferrer"
					target="_blank"
				>
					Open original dashboard
				</a>
			</section>
		);
	}
	if (dashboard.hasArtifact) {
		return (
			<p className="text-muted-foreground text-sm">
				The original dashboard isn’t available to you.
			</p>
		);
	}
	return (
		<p className="text-muted-foreground text-sm">
			No source linked. Edit this dashboard to link an existing OpenMeld
			dashboard.
		</p>
	);
}
