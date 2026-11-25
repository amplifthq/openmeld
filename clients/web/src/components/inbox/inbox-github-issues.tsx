import { Button } from "@openmeld/ui/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listCurrentGitHubInboxIssues } from "#/lib/organizations/inbox-github-issues";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { InboxTimestamp } from "./inbox-list";
import { useInboxLater } from "./use-inbox-later";

function readIgnoredIssueRevisions(key: string): string[] {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
		return Array.isArray(value)
			? value.filter((entry): entry is string => typeof entry === "string")
			: [];
	} catch {
		return [];
	}
}

const MAX_IGNORED_ISSUE_REVISIONS = 200;

function useIgnoredIssueRevisions(key: string) {
	const [state, setState] = useState(() => ({
		key,
		revisions: readIgnoredIssueRevisions(key),
	}));
	useEffect(() => {
		const sync = () =>
			setState({ key, revisions: readIgnoredIssueRevisions(key) });
		sync();
		const onStorage = (event: StorageEvent) => {
			if (event.key === key || event.key === null) {
				sync();
			}
		};
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, [key]);
	const revisions = state.key === key ? state.revisions : [];
	return {
		ignored: new Set(revisions),
		ignore: (revision: string) => {
			const next = [
				...new Set([revision, ...revisions, ...readIgnoredIssueRevisions(key)]),
			].slice(0, MAX_IGNORED_ISSUE_REVISIONS);
			try {
				localStorage.setItem(key, JSON.stringify(next));
			} catch {
				// Keep the presentation preference for the mounted Inbox.
			}
			setState({ key, revisions: next });
		},
	};
}

function issueRevision(issue: { id: number; updatedAt: string }) {
	return `${issue.id}:${issue.updatedAt}`;
}

export function useInboxGitHubIssues(input: { enabled: boolean }) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const scope = `github:${currentUserId}:${currentOrganization.id}`;
	const { defer, later } = useInboxLater(scope);
	const { ignore, ignored } = useIgnoredIssueRevisions(
		`openmeld.inbox.ignored:${scope}`
	);
	const query = useQuery({
		queryKey: ["inbox-github-issues", currentUserId, currentOrganization.id],
		queryFn: ({ signal }) =>
			listCurrentGitHubInboxIssues({
				organizationId: currentOrganization.id,
				signal,
			}),
		gcTime: 0,
		refetchInterval: 60_000,
		retry: false,
		enabled: input.enabled,
	});
	const result = query.data?.result;
	const issues =
		result?.status === "ready" && !query.isError ? result.issues : [];
	const visibleIssues = issues.filter(
		(issue) =>
			!(ignored.has(issueRevision(issue)) || later[issueRevision(issue)])
	);
	return { ...query, visibleIssues, defer, ignore };
}

export function InboxGitHubIssues({
	query,
}: {
	query: ReturnType<typeof useInboxGitHubIssues>;
}) {
	const { currentOrganization } = useAppOrganization();
	const result = query.data?.result;
	if (result?.status === "not_connected") {
		return (
			<p className="text-muted-foreground text-sm">
				<Link
					className="underline underline-offset-4"
					params={{ orgSlug: currentOrganization.slug, service: "github" }}
					search={{ scope: "personal" }}
					to="/o/$orgSlug/plugins/$service"
				>
					Connect Your GitHub
				</Link>{" "}
				to see open issues assigned to you.
			</p>
		);
	}
	if (query.isError || result?.status === "unavailable") {
		return (
			<div className="flex items-center gap-2 text-muted-foreground text-sm">
				GitHub assignments couldn’t be checked.
				<Button onClick={() => query.refetch()} size="sm" variant="secondary">
					Retry
				</Button>
			</div>
		);
	}
	if (
		result?.status !== "ready" ||
		!(query.visibleIssues.length || result.partial)
	) {
		return null;
	}
	return (
		<section aria-label="Assigned GitHub issues" className="space-y-2">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<h2 className="font-medium text-sm">Assigned GitHub issues</h2>
				<Button
					disabled={query.isFetching}
					onClick={() => query.refetch()}
					size="sm"
					variant="secondary"
				>
					Refresh GitHub
				</Button>
			</div>
			{result.partial ? (
				<p className="text-muted-foreground text-sm">
					Showing a partial list. Open GitHub for all assignments.
				</p>
			) : null}
			<ul className="divide-y divide-border/70 rounded-md border border-border/70 bg-card">
				{query.visibleIssues.map((issue) => (
					<li
						className="flex flex-wrap items-center justify-between gap-2 p-3"
						key={issue.id}
					>
						<div className="min-w-0">
							<a
								className="font-medium text-sm hover:underline"
								href={issue.url}
								rel="noopener noreferrer"
								target="_blank"
							>
								{issue.title}
							</a>
							<p className="text-muted-foreground text-xs">
								{issue.repository} #{issue.number} · Opened{" "}
								<InboxTimestamp occurredAt={issue.createdAt} />
							</p>
						</div>
						<div className="flex flex-wrap items-center gap-2">
							<a
								className="text-sm underline underline-offset-4"
								href={issue.url}
								rel="noopener noreferrer"
								target="_blank"
							>
								Reassign or close in GitHub
							</a>
							<Button
								onClick={() => query.defer(issueRevision(issue))}
								size="sm"
								variant="ghost"
							>
								Later
							</Button>
							<Button
								onClick={() => query.ignore(issueRevision(issue))}
								size="sm"
								title="Hide this version in this browser without changing GitHub"
								variant="ghost"
							>
								Ignore
							</Button>
						</div>
					</li>
				))}
			</ul>
		</section>
	);
}
