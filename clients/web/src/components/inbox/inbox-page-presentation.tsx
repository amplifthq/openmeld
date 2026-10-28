import type { InboxItem, InboxView } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { TabsSubtle, TabsSubtleItem } from "@openmeld/ui/fluid/tabs-subtle";
import { resolveStatusToneSurfaceClassName } from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import { TrayIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { AppPageHeader } from "#/components/app/app-page-header";
import { isInboxReview } from "#/lib/inbox/review";
import { InboxItemsList } from "./inbox-list";
import { INBOX_TABS } from "./inbox-page-tabs";

const INBOX_SKELETON_IDS = [
	"inbox-skeleton-1",
	"inbox-skeleton-2",
	"inbox-skeleton-3",
	"inbox-skeleton-4",
	"inbox-skeleton-5",
] as const;

type InboxLoadMoreState = "error" | "idle" | "loading";

export function InboxPagePending() {
	return (
		<div className="flex min-w-0 flex-col gap-6">
			<AppPageHeader
				description="Updates, actions, and reviews in one place."
				eyebrow="Workspace"
				id="inbox-heading"
				title="Inbox"
			/>
			<div className="flex min-w-0 flex-col gap-4">
				<TabsSubtle
					className="w-fit max-w-full"
					idPrefix="inbox-view-pending"
					onSelect={() => undefined}
					selectedIndex={0}
				>
					{INBOX_TABS.map((tab, index) => (
						<TabsSubtleItem
							disabled
							index={index}
							key={tab.view}
							label={tab.label}
						/>
					))}
				</TabsSubtle>
				<InboxListSkeleton />
			</div>
		</div>
	);
}

export function InboxViewContent(input: {
	focusedItemId?: string;
	isError: boolean;
	isLoading: boolean;
	items: readonly InboxItem[];
	loadMoreState?: InboxLoadMoreState;
	onDismiss: (item: InboxItem) => void;
	onLoadMore: () => Promise<unknown>;
	onOpenItem: (item: InboxItem) => void;
	onRetry: () => Promise<unknown>;
	onSetRead: (item: InboxItem, read: boolean) => void;
	organizationSlug: string;
	registerItemElement: (itemId: string, element: HTMLElement | null) => void;
	view: InboxView;
	unreadOnly?: boolean;
}) {
	if (input.isLoading) {
		return <InboxListSkeleton />;
	}
	if (input.isError) {
		return <InboxInitialError onRetry={input.onRetry} />;
	}
	if (input.items.length === 0) {
		if (input.loadMoreState) {
			return (
				<InboxInfiniteScrollTrigger
					onLoadMore={input.onLoadMore}
					state={input.loadMoreState}
				/>
			);
		}
		return <InboxEmptyState unreadOnly={input.unreadOnly} view={input.view} />;
	}

	const sections = buildInboxSections(input.items, input.view);
	return (
		<div className="flex min-w-0 flex-col gap-6">
			{sections.map((section) => (
				<section aria-labelledby={section.id} key={section.id}>
					{section.showHeading ? (
						<h2
							className="mb-2 font-medium text-muted-foreground text-xs"
							id={section.id}
						>
							{section.label}
						</h2>
					) : (
						<h2 className="sr-only" id={section.id}>
							{section.label}
						</h2>
					)}
					<InboxItemsList
						focusedItemId={input.focusedItemId}
						items={section.items}
						onDismiss={input.onDismiss}
						onOpenItem={input.onOpenItem}
						onSetRead={input.onSetRead}
						organizationSlug={input.organizationSlug}
						registerItemElement={input.registerItemElement}
					/>
				</section>
			))}
			{input.loadMoreState ? (
				<InboxInfiniteScrollTrigger
					onLoadMore={input.onLoadMore}
					state={input.loadMoreState}
				/>
			) : null}
		</div>
	);
}

export function InboxInfiniteScrollTrigger(input: {
	onLoadMore: () => Promise<unknown>;
	state: InboxLoadMoreState;
}) {
	const sentinelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const sentinel = sentinelRef.current;
		if (!(sentinel && input.state === "idle")) {
			return;
		}
		const observer = new IntersectionObserver((entries) => {
			if (entries.some((entry) => entry.isIntersecting)) {
				observer.disconnect();
				input.onLoadMore();
			}
		});
		observer.observe(sentinel);
		return () => observer.disconnect();
	}, [input.onLoadMore, input.state]);

	if (input.state === "error") {
		return (
			<output className="flex flex-wrap items-center justify-center gap-3 text-muted-foreground text-sm">
				<span>Couldn’t load older Inbox items.</span>
				<Button onClick={() => input.onLoadMore()} size="sm" variant="outline">
					Try again
				</Button>
			</output>
		);
	}

	return (
		<div
			className="flex min-h-10 items-center justify-center text-muted-foreground text-sm"
			ref={sentinelRef}
		>
			{input.state === "loading" ? (
				<span aria-live="polite">Loading more Inbox items…</span>
			) : null}
		</div>
	);
}

export function InboxRefreshWarning(input: {
	onRetry: () => Promise<unknown>;
}) {
	return (
		<output
			className={cn(
				"flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm",
				resolveStatusToneSurfaceClassName("warning", "subtle")
			)}
		>
			<p>Couldn’t refresh. Showing the latest Inbox view available.</p>
			<Button onClick={() => input.onRetry()} size="sm" variant="outline">
				Retry
			</Button>
		</output>
	);
}

export function InboxGroupLoadWarning(input: {
	onRetry: () => Promise<unknown>;
}) {
	return (
		<output
			className={cn(
				"flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm",
				resolveStatusToneSurfaceClassName("warning", "subtle")
			)}
		>
			<p>Couldn’t load the updates in this group.</p>
			<Button onClick={() => input.onRetry()} size="sm" variant="outline">
				Try again
			</Button>
		</output>
	);
}

export function InboxItemLookupWarning(input: {
	onRetry: () => Promise<unknown>;
}) {
	return (
		<output
			className={cn(
				"flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm",
				resolveStatusToneSurfaceClassName("warning", "subtle")
			)}
		>
			<p>
				Couldn’t open this Inbox item. Your current Inbox is still available.
			</p>
			<Button onClick={() => input.onRetry()} size="sm" variant="outline">
				Try again
			</Button>
		</output>
	);
}

function buildInboxSections(items: readonly InboxItem[], view: InboxView) {
	if (view !== "all") {
		return [
			{
				id: `inbox-${view.replace("_", "-")}-items`,
				items,
				label: INBOX_TABS.find((tab) => tab.view === view)?.label ?? "Updates",
				showHeading: false,
			},
		];
	}
	const needsAttention = items
		.filter(
			(item) =>
				item.attention === "action_required" && item.resolutionStatus === "open"
		)
		.toSorted(compareInboxAttention);
	const needsAttentionItemIds = new Set(needsAttention.map((item) => item.id));
	const reviews = needsAttention.filter(isInboxReview);
	const actions = needsAttention.filter((item) => !isInboxReview(item));
	const updates = items.filter((item) => !needsAttentionItemIds.has(item.id));
	return [
		...(actions.length > 0
			? [
					{
						id: "inbox-needs-attention",
						items: actions,
						label: "Needs action",
						showHeading: true,
					},
				]
			: []),
		...(reviews.length > 0
			? [
					{
						id: "inbox-needs-review",
						items: reviews,
						label: "Needs review",
						showHeading: true,
					},
				]
			: []),
		...(updates.length > 0
			? [
					{
						id: "inbox-updates",
						items: updates,
						label: "Updates",
						showHeading: needsAttention.length > 0,
					},
				]
			: []),
	];
}

function compareInboxAttention(left: InboxItem, right: InboxItem): number {
	if (left.importance !== right.importance) {
		return left.importance === "urgent" ? -1 : 1;
	}
	return right.occurredAt.localeCompare(left.occurredAt);
}

export function InboxListSkeleton() {
	return (
		<div
			aria-busy="true"
			className="overflow-hidden rounded-md border border-border/70 bg-card"
		>
			<span className="sr-only">Loading Inbox</span>
			{INBOX_SKELETON_IDS.map((skeletonId) => (
				<div
					className="flex min-h-20 items-start gap-4 border-border/70 border-b px-4 py-4 last:border-b-0"
					key={skeletonId}
				>
					<Skeleton className="size-9 shrink-0 motion-reduce:animate-none" />
					<div className="flex min-w-0 flex-1 flex-col gap-2">
						<Skeleton className="h-4 w-2/5 motion-reduce:animate-none" />
						<Skeleton className="h-3 w-4/5 motion-reduce:animate-none" />
						<Skeleton className="h-3 w-1/4 motion-reduce:animate-none" />
					</div>
				</div>
			))}
		</div>
	);
}

export function InboxEmptyState(input: {
	view: InboxView;
	unreadOnly?: boolean;
	filtered?: boolean;
}) {
	const copy = input.filtered
		? {
				title: "No matching items",
				description: "Try different filters to see more activity.",
			}
		: resolveInboxEmptyStateCopy(input.view, input.unreadOnly);
	return (
		<div className="flex min-h-60 flex-col items-center justify-center rounded-md border border-border/70 bg-card px-6 py-12 text-center">
			<span className="grid size-10 place-items-center rounded-md border border-border/70 bg-background text-muted-foreground">
				<TrayIcon aria-hidden="true" className="size-4" />
			</span>
			<h2 className="mt-4 font-medium text-foreground text-sm">{copy.title}</h2>
			<p className="mt-1 max-w-lg text-muted-foreground text-sm leading-6">
				{copy.description}
			</p>
		</div>
	);
}

function resolveInboxEmptyStateCopy(
	view: InboxView,
	unreadOnly = false
): {
	description: string;
	title: string;
} {
	if (unreadOnly || view === "unread") {
		const titles = {
			all: "No unread items",
			needs_review: "No unread reviews",
			needs_action: "No unread actions",
		};
		return {
			description: "Turn off Unread only to include items you’ve already read.",
			title: titles[view as keyof typeof titles] ?? "No unread items",
		};
	}
	if (view === "mentions") {
		return {
			title: "No mentions",
			description:
				"Messages that explicitly mention you or your personal Agents appear here.",
		};
	}
	if (view === "needs_review") {
		return {
			title: "No pending reviews",
			description: "Requests to approve or decline appear here.",
		};
	}
	if (view === "needs_action") {
		return {
			description: "Requests and recovery steps appear here.",
			title: "No pending actions",
		};
	}
	return {
		description: "New updates and requests will appear here.",
		title: "You're all caught up",
	};
}

export function InboxInitialError(input: { onRetry: () => Promise<unknown> }) {
	return (
		<div
			className="flex min-h-60 flex-col items-center justify-center rounded-md border border-border/70 bg-card px-6 py-12 text-center"
			role="alert"
		>
			<WarningCircleIcon
				aria-hidden="true"
				className="size-5 text-destructive"
			/>
			<h2 className="mt-3 font-medium text-foreground text-sm">
				Couldn’t load your Inbox
			</h2>
			<p className="mt-1 max-w-sm text-muted-foreground text-sm leading-6">
				Check your connection and try again.
			</p>
			<Button
				className="mt-4"
				onClick={() => input.onRetry()}
				variant="outline"
			>
				Try again
			</Button>
		</div>
	);
}
