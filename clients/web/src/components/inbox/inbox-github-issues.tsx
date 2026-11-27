import type { InboxGitHubIssue } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { GithubLogoIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listCurrentGitHubInboxIssues } from "#/lib/organizations/inbox-github-issues";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import { InboxTimestamp } from "./inbox-list";
import { InboxTodoActions } from "./inbox-todo-actions";

function readIssueRevisions(key: string): string[] {
	try {
		const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
		return Array.isArray(value)
			? value.filter((entry): entry is string => typeof entry === "string")
			: [];
	} catch {
		return [];
	}
}

function useIssueRevisions(key: string) {
	const [state, setState] = useState(() => ({
		key,
		revisions: readIssueRevisions(key),
	}));
	useEffect(() => {
		const sync = () => setState({ key, revisions: readIssueRevisions(key) });
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
		items: new Set(revisions),
		hide: (revision: string) => {
			// Keep one revision per issue. Dismissing a different assignment must
			// not bring an unchanged issue back into the To do list.
			const revisionByIssue = new Map<string, string>();
			for (const entry of [
				revision,
				...readIssueRevisions(key),
				...revisions,
			]) {
				const issueId = entry.split(":", 1)[0];
				if (issueId && !revisionByIssue.has(issueId)) {
					revisionByIssue.set(issueId, entry);
				}
			}
			const next = [...revisionByIssue.values()];
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
	const ignored = useIssueRevisions(`openmeld.inbox.ignored:${scope}`);
	const completed = useIssueRevisions(`openmeld.inbox.completed:${scope}`);
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
			!(
				ignored.items.has(issueRevision(issue)) ||
				completed.items.has(issueRevision(issue))
			)
	);
	return {
		...query,
		visibleIssues,
		done: completed.hide,
		ignore: ignored.hide,
	};
}

export function InboxGitHubNotice({
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
	if (result?.status === "ready" && result.partial) {
		return (
			<p className="text-muted-foreground text-sm">
				Some GitHub items couldn’t be loaded.{" "}
				<Button onClick={() => query.refetch()} size="sm" variant="ghost">
					Retry
				</Button>
			</p>
		);
	}
	return null;
}

export function InboxGitHubTodoRow({
	issue,
	query,
}: {
	issue: InboxGitHubIssue;
	query: ReturnType<typeof useInboxGitHubIssues>;
}) {
	return (
		<li className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
			<div className="flex min-w-0 items-start gap-3 px-3 py-3">
				<span aria-hidden="true" className="w-2 shrink-0" />
				<span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/60 bg-background">
					<GithubLogoIcon
						aria-hidden="true"
						className="size-4 text-muted-foreground"
					/>
				</span>
				<div className="min-w-0">
					<a
						className="block break-words font-medium text-sm hover:underline"
						href={issue.url}
						rel="noopener noreferrer"
						target="_blank"
					>
						{issue.title}
					</a>
					<p className="mt-1 text-muted-foreground text-xs">
						{issue.repository} #{issue.number} ·{" "}
						<InboxTimestamp occurredAt={issue.updatedAt} />
					</p>
				</div>
			</div>
			<div className="flex flex-wrap items-center justify-end gap-1 pe-4 pb-2 sm:pb-0">
				<InboxTodoActions
					onDone={() => query.done(issueRevision(issue))}
					onIgnore={() => query.ignore(issueRevision(issue))}
					open={{ href: issue.url }}
					title={issue.title}
				/>
			</div>
		</li>
	);
}
