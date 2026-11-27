import { Button } from "@openmeld/ui/components/button";
import { Input } from "@openmeld/ui/components/input";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@openmeld/ui/components/table";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { listCurrentGitHubInboxIssues } from "#/lib/organizations/inbox-github-issues";

type IssueFilters = {
	state: "open" | "closed" | "all";
	assignee?: string;
};

const ASSIGNEE_PATTERN = "^[A-Za-z0-9\\-]+$";

function readFilters(form: HTMLFormElement): IssueFilters {
	const fields = new FormData(form);
	const assignee = String(fields.get("assignee") ?? "").trim();
	const state = fields.get("state");
	return {
		state: state === "closed" || state === "all" ? state : "open",
		...(assignee ? { assignee } : {}),
	};
}

type IssueResult = Awaited<
	ReturnType<typeof listCurrentGitHubInboxIssues>
>["result"];
type ReadyResult = Extract<IssueResult, { status: "ready" }>;

function IssueTable({ issues }: { issues: ReadyResult["issues"] }) {
	return (
		<div className="rounded-md border">
			<Table aria-label="GitHub issues">
				<TableHeader>
					<TableRow>
						<TableHead>Issue</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Assignees</TableHead>
						<TableHead>Updated</TableHead>
						<TableHead>
							<span className="sr-only">GitHub link</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{issues.map((issue) => (
						<TableRow key={issue.id}>
							<TableCell className="min-w-48 whitespace-normal">
								<span className="font-medium">{issue.title}</span>
								<span className="block text-muted-foreground text-xs">
									{issue.repository} #{issue.number}
								</span>
							</TableCell>
							<TableCell>
								{issue.state === "open" ? "Open" : "Closed"}
							</TableCell>
							<TableCell>
								{issue.assignees.map((login) => `@${login}`).join(", ") ||
									"Unassigned"}
							</TableCell>
							<TableCell>
								<time dateTime={issue.updatedAt}>
									{issue.updatedAt.slice(0, 10)}
								</time>
							</TableCell>
							<TableCell>
								<a
									className="inline-flex items-center gap-1 underline underline-offset-4"
									href={issue.url}
									rel="noopener noreferrer"
									target="_blank"
								>
									Open in GitHub <ArrowSquareOutIcon aria-hidden="true" />
								</a>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

export function GitHubIssuesDashboard({
	accountId,
	organizationId,
	orgSlug,
	repository,
}: {
	accountId: string;
	organizationId: string;
	orgSlug: string;
	repository: string;
}) {
	const [filters, setFilters] = useState<IssueFilters>({ state: "open" });
	const assigneeId = useId();
	const query = useQuery({
		queryKey: [
			"dashboard-github-issues",
			accountId,
			organizationId,
			repository,
			filters,
		],
		queryFn: ({ signal }) =>
			listCurrentGitHubInboxIssues({
				...filters,
				repository,
				organizationId,
				signal,
			}),
		gcTime: 0,
		retry: false,
	});
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const next = readFilters(event.currentTarget);
		if (next.state === filters.state && next.assignee === filters.assignee) {
			query.refetch();
		} else {
			setFilters(next);
		}
	};
	const result = query.data?.result;
	const unavailable = query.isError || result?.status === "unavailable";
	return (
		<section className="flex w-full min-w-0 flex-col gap-6 py-[var(--app-page-block-padding)]">
			<AppPageHeader
				description="Read issues with your GitHub connection. Reassign or close an issue in GitHub, then refresh here."
				title={repository}
			/>
			<form className="flex flex-wrap items-end gap-3" onSubmit={submit}>
				<label className="grid gap-1.5 text-sm">
					Status
					<select
						className="h-9 rounded-md border bg-background px-3"
						defaultValue="open"
						name="state"
					>
						<option value="open">Open</option>
						<option value="closed">Closed</option>
						<option value="all">All statuses</option>
					</select>
				</label>
				<label className="grid gap-1.5 text-sm" htmlFor={assigneeId}>
					Assignee
					<Input
						autoComplete="off"
						id={assigneeId}
						maxLength={39}
						name="assignee"
						pattern={ASSIGNEE_PATTERN}
						placeholder="Any GitHub username"
					/>
				</label>
				<Button type="submit">Apply filters</Button>
				<Button
					disabled={query.isFetching}
					onClick={() => query.refetch()}
					type="button"
					variant="secondary"
				>
					Refresh from GitHub
				</Button>
			</form>
			{query.isFetching && (
				<output className="text-muted-foreground text-sm">
					Reading GitHub issues…
				</output>
			)}
			{unavailable && !query.isFetching && (
				<p role="alert">
					Issues couldn’t be loaded. Check repository access and refresh.
				</p>
			)}
			{result?.status === "not_connected" &&
				!query.isFetching &&
				!unavailable && (
					<p className="text-sm">
						Connect your personal GitHub account in{" "}
						<Link
							className="underline underline-offset-4"
							params={{ orgSlug, service: "github" }}
							search={{ scope: "personal" }}
							to="/o/$orgSlug/plugins/$service"
						>
							GitHub settings
						</Link>{" "}
						to load issues.
					</p>
				)}
			{result?.status === "ready" && !query.isFetching && !unavailable && (
				<>
					{result.partial && (
						<p className="text-muted-foreground text-sm">
							Showing a limited set of GitHub results. Narrow the filters to see
							more relevant issues.
						</p>
					)}
					{result.issues.length > 0 ? (
						<IssueTable issues={result.issues} />
					) : (
						<p className="text-muted-foreground text-sm">
							No issues found for these filters.
						</p>
					)}
				</>
			)}
		</section>
	);
}
