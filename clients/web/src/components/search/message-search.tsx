"use client";

import {
	type MessageSearchResponse,
	messageSearchResponseSchema,
	sanitizeSignalTextPreview,
} from "@openmeld/schemas";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { Input } from "@openmeld/ui/components/input";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import {
	useAppOrganization,
	useOptionalAppOrganization,
} from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationDirectMessagePath,
	buildOrganizationInboxPath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import { useDefaultHumanProfile } from "#/lib/profiles/use-default-human-profile";

export function MessageSearchButton(input: {
	spaceId?: string;
	profileId?: string;
	scope?: "inbox" | "messages";
}) {
	const [open, setOpen] = useState(false);
	const organization = useOptionalAppOrganization();
	if (!organization) {
		return null;
	}
	return (
		<>
			<Button onClick={() => setOpen(true)} size="sm" variant="secondary">
				<MagnifyingGlassIcon />
				{input.scope === "inbox" ? "Search Inbox" : "Search messages"}
			</Button>
			<MessageSearchDialog {...input} onOpenChange={setOpen} open={open} />
		</>
	);
}

export function MessageSearchDialog(input: {
	open: boolean;
	onOpenChange: (value: boolean) => void;
	spaceId?: string;
	profileId?: string;
	scope?: "inbox" | "messages";
	initialQuery?: string;
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	let description =
		"Search messages across your Spaces and direct messages in this workspace.";
	if (input.spaceId) {
		description =
			"Search this conversation, including older messages and replies.";
	}
	if (input.scope === "inbox") {
		description = "Search messages and other activity in your Inbox.";
	}
	return (
		<Dialog onOpenChange={input.onOpenChange} open={input.open}>
			<DialogContent className="flex h-[70dvh] max-h-[85dvh] flex-col sm:max-w-2xl">
				<DialogTitle>
					{input.scope === "inbox" ? "Search Inbox" : "Search messages"}
				</DialogTitle>
				<DialogDescription>{description}</DialogDescription>
				{input.open && (
					<MessageSearchContents
						key={`${currentUserId}:${currentOrganization.id}:${input.spaceId ?? "all"}:${input.scope ?? "messages"}`}
						{...input}
					/>
				)}
			</DialogContent>
		</Dialog>
	);
}

function MessageSearchContents(input: {
	initialQuery?: string;
	onOpenChange: (value: boolean) => void;
	spaceId?: string;
	profileId?: string;
	scope?: "inbox" | "messages";
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = input.profileId ?? defaultHumanProfile?.openMeldProfileId;
	const [draft, setDraft] = useState(input.initialQuery ?? "");
	const initialQuery = input.initialQuery?.trim() ?? "";
	const [query, setQuery] = useState(
		[...initialQuery].length >= 3 ? initialQuery : ""
	);
	const [attempt, setAttempt] = useState(0);
	const results = useInfiniteQuery({
		queryKey: [
			"message-search",
			currentUserId,
			currentOrganization.id,
			profileId,
			input.spaceId,
			input.scope,
			query,
			attempt,
		],
		enabled: Boolean([...query].length >= 3 && profileId),
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam, signal }) => {
			const params = new URLSearchParams({
				q: query,
				scope: input.scope ?? "messages",
			});
			if (input.spaceId) {
				params.set("spaceId", input.spaceId);
			}
			if (pageParam) {
				params.set("cursor", pageParam);
			}
			return createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId: currentOrganization.id,
				openMeldProfileId: profileId,
			}).requestJson({
				url: `/v1/messages/search?${params}`,
				operation: "messages.search",
				signal,
				schema: messageSearchResponseSchema,
				invalidMessage: "Message search is unavailable. Refresh and try again.",
			});
		},
		getNextPageParam: (page) => page.nextCursor ?? undefined,
		gcTime: 0,
		staleTime: 0,
		retry: false,
	});
	const matches = [
		...new Map(
			results.data?.pages
				.flatMap((page) => page.matches)
				.map((match) => [
					`${match.signal.spaceId}:${match.signal.id}`,
					match,
				]) ?? []
		).values(),
	];
	const indexing = results.data?.pages.at(-1)?.indexing;
	const activities = [
		...new Map(
			results.data?.pages
				.flatMap((page) => page.activities)
				.map((item) => [item.id, item]) ?? []
		).values(),
	];
	const { hasNextPage, isFetching, isError, fetchNextPage } = results;
	useEffect(() => {
		if (
			hasNextPage &&
			!isFetching &&
			!isError &&
			(indexing || matches.length + activities.length < 30)
		) {
			fetchNextPage();
		}
	}, [
		hasNextPage,
		isFetching,
		isError,
		indexing,
		matches.length,
		activities.length,
		fetchNextPage,
	]);
	return (
		<>
			<form
				className="flex gap-2"
				onSubmit={(event) => {
					event.preventDefault();
					setQuery(draft.trim());
					setAttempt((value) => value + 1);
				}}
			>
				<Input
					aria-label="Search message text"
					maxLength={200}
					minLength={3}
					onChange={(event) => setDraft(event.target.value)}
					placeholder="Search text (at least 3 characters)…"
					value={draft}
				/>
				<Button
					disabled={[...draft.trim()].length < 3}
					type="submit"
					variant="secondary"
				>
					Search
				</Button>
			</form>
			<ScrollArea
				className="min-h-32 flex-1"
				viewportProps={{ "aria-label": "Message search results" }}
			>
				<div className="space-y-2 py-2">
					{activities.map((item) => (
						<Link
							className="block rounded-md border p-3 hover:bg-accent focus-visible:outline-2"
							key={item.id}
							onClick={() => input.onOpenChange(false)}
							to={inboxSearchHref(currentOrganization.slug, item.id)}
						>
							<p className="font-medium text-sm">{item.title}</p>
							<p className="line-clamp-3 text-muted-foreground text-sm">
								{item.preview}
							</p>
						</Link>
					))}
					{matches.map((match) => (
						<Link
							className="block rounded-md border p-3 hover:bg-accent focus-visible:outline-2"
							key={`${match.signal.spaceId}:${match.signal.id}`}
							onClick={() => input.onOpenChange(false)}
							to={messageSearchHref(match, currentOrganization.slug, profileId)}
						>
							<p className="truncate font-medium text-sm">
								{match.spaceName ?? "Conversation"}
							</p>
							<p className="line-clamp-3 text-sm">
								{sanitizeSignalTextPreview(match.signal.data.text) ?? "Message"}
							</p>
							<p className="mt-1 text-muted-foreground text-xs">
								{match.signal.profile.profileName} ·{" "}
								{new Date(match.signal.ts).toLocaleString()}
							</p>
						</Link>
					))}
					<div aria-live="polite" className="text-muted-foreground text-sm">
						{!query && "Enter at least 3 characters to search."}
						{query && results.isFetching && "Searching…"}
						{query &&
							!results.isFetching &&
							!results.isError &&
							!results.hasNextPage &&
							matches.length + activities.length === 0 &&
							"No results found. Try different words."}
						{!results.isFetching &&
							results.hasNextPage &&
							(indexing
								? "Preparing older messages for search…"
								: "More conversations or messages are available to search.")}
					</div>
					{results.isError && (
						<div role="alert">
							<p className="text-sm">
								Unable to finish searching. Your results may be incomplete.
							</p>
							<Button
								className="mt-2"
								onClick={() => results.refetch()}
								size="sm"
								variant="secondary"
							>
								Try again
							</Button>
						</div>
					)}
				</div>
			</ScrollArea>
			{results.hasNextPage && (
				<Button
					disabled={results.isFetching}
					onClick={() => results.fetchNextPage()}
					variant="secondary"
				>
					{indexing ? "Continue search" : "Search more"}
				</Button>
			)}
		</>
	);
}

function inboxSearchHref(orgSlug: string, itemId: string): string {
	return `${buildOrganizationInboxPath(orgSlug)}?item=${encodeURIComponent(itemId)}`;
}

function messageSearchHref(
	match: MessageSearchResponse["matches"][number],
	orgSlug: string,
	profileId?: string
) {
	if (match.inboxItemId) {
		return inboxSearchHref(orgSlug, match.inboxItemId);
	}
	const search = {
		profileId,
		focusSignalId: match.signal.id,
		focusThreadRootSignalId: match.threadRootSignalId ?? undefined,
	};
	if (match.centerAgent) {
		return buildOrganizationCenterAgentChatPath(orgSlug, {
			...search,
			session: match.signal.spaceId,
		});
	}
	return (
		match.directMessage
			? buildOrganizationDirectMessagePath
			: buildOrganizationSpacePath
	)({ orgSlug, spaceId: match.signal.spaceId, search });
}
