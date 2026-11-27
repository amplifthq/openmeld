import type {
	InboxFeedRow,
	InboxGitHubIssue,
	InboxItem,
} from "@openmeld/schemas/types";
import { SharedLayoutGroup } from "@openmeld/ui/fluid/shared-layout-group";
import {
	InboxGitHubTodoRow,
	type useInboxGitHubIssues,
} from "./inbox-github-issues";
import { InboxItemRow } from "./inbox-list";
import { InboxTodoActions } from "./inbox-todo-actions";

type TodoRow =
	| { kind: "inbox"; key: string; at: number; row: InboxFeedRow }
	| { kind: "github"; key: string; at: number; issue: InboxGitHubIssue };

export function mergeInboxTodos(
	rows: readonly InboxFeedRow[],
	issues: readonly InboxGitHubIssue[]
): TodoRow[] {
	const items: TodoRow[] = [
		...rows.map((row) => ({
			kind: "inbox" as const,
			key: `inbox:${row.item.id}`,
			row,
			at: Date.parse(row.latestOccurredAt),
		})),
		...issues.map((issue) => ({
			kind: "github" as const,
			key: `github:${issue.id}`,
			issue,
			at: Date.parse(issue.updatedAt),
		})),
	];
	return items.sort((a, b) => b.at - a.at || a.key.localeCompare(b.key));
}

export function InboxTodoList(input: {
	rows: readonly InboxFeedRow[];
	github: ReturnType<typeof useInboxGitHubIssues>;
	organizationSlug: string;
	onOpen: (item: InboxItem) => void;
	onSetRead: (item: InboxItem, read: boolean) => void;
	onDone: (item: InboxItem) => void;
	onIgnore: (item: InboxItem) => void;
}) {
	const todos = mergeInboxTodos(input.rows, input.github.visibleIssues);
	if (!todos.length) {
		return null;
	}
	return (
		<SharedLayoutGroup>
			<ul
				aria-label="TODO"
				className="divide-y divide-border/60 overflow-hidden rounded-md border border-border/70 bg-card"
			>
				{todos.map((todo) =>
					todo.kind === "github" ? (
						<InboxGitHubTodoRow
							issue={todo.issue}
							key={todo.key}
							query={input.github}
						/>
					) : (
						<InboxItemRow
							density="compact"
							feedRow={todo.row}
							focused={false}
							item={todo.row.item}
							key={todo.key}
							onDismiss={input.onIgnore}
							onOpenItem={input.onOpen}
							onSetRead={input.onSetRead}
							organizationSlug={input.organizationSlug}
							showItemActions={false}
							todo
							trailingActions={(onOpen) => (
								<InboxTodoActions
									onDone={() => input.onDone(todo.row.item)}
									onIgnore={() => input.onIgnore(todo.row.item)}
									open={{ onOpen }}
									title={todo.row.item.title}
								/>
							)}
						/>
					)
				)}
			</ul>
		</SharedLayoutGroup>
	);
}
