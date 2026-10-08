"use client";

import {
	OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION,
	OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
} from "@openmeld/gateway-contract";
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
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import {
	FluidActionList,
	FluidActionListItem,
} from "@openmeld/ui/fluid/action-list";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { cn } from "@openmeld/ui/lib/utils";
import { MagnifyingGlassIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppEmptyState } from "#/components/app/app-empty-state";
import {
	presentInboxItem,
	useConversationNames,
} from "#/components/spaces/conversation-names";
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
	enabled?: boolean;
	spaceId?: string;
	profileId?: string;
	scope?: "inbox" | "messages";
}) {
	const [open, setOpen] = useState(false);
	const organization = useOptionalAppOrganization();
	if (!organization || input.enabled === false) {
		return null;
	}
	const label = input.scope === "inbox" ? "Search Inbox" : "Search messages";
	return (
		<>
			{input.spaceId ? (
				<TooltipHint content={label}>
					<Button
						aria-label={label}
						onClick={() => setOpen(true)}
						size="icon-sm"
						variant="ghost"
					>
						<MagnifyingGlassIcon />
					</Button>
				</TooltipHint>
			) : (
				<Button onClick={() => setOpen(true)} size="sm" variant="secondary">
					<MagnifyingGlassIcon />
					{label}
				</Button>
			)}
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
		"Messages across Spaces and direct messages in this workspace.";
	if (input.spaceId) {
		description = "Messages and replies in this conversation.";
	}
	if (input.scope === "inbox") {
		description = "Messages and activity in this Inbox.";
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

export function useMessageSearch(input: {
	draft: string;
	isComposing: boolean;
	spaceId?: string;
	profileId?: string;
	scope?: "inbox" | "messages";
}) {
	const { currentOrganization, currentUserId } = useAppOrganization();
	const { defaultHumanProfile } = useDefaultHumanProfile();
	const profileId = input.profileId ?? defaultHumanProfile?.openMeldProfileId;
	const { isComposing } = input;
	const searchText = input.draft.trim();
	const minimumQueryLength = input.spaceId ? 1 : 3;
	const [settledQuery, setSettledQuery] = useState("");
	const query = !isComposing && settledQuery === searchText ? settledQuery : "";
	useEffect(() => {
		setSettledQuery("");
		if (isComposing || [...searchText].length < minimumQueryLength) {
			return;
		}
		const timer = setTimeout(() => setSettledQuery(searchText), 300);
		return () => clearTimeout(timer);
	}, [searchText, isComposing, minimumQueryLength]);
	const results = useInfiniteQuery({
		queryKey: [
			"message-search",
			currentUserId,
			currentOrganization.id,
			profileId,
			input.spaceId,
			input.scope,
			query,
		],
		enabled: Boolean([...query].length >= minimumQueryLength && profileId),
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
				headers: {
					[OPENMELD_HEADER_SPACE_IMAGE_GEOMETRY_VERSION]:
						OPENMELD_SPACE_IMAGE_GEOMETRY_VERSION,
				},
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
	const names = useConversationNames();
	const matches = [
		...new Map(
			results.data?.pages
				.flatMap((page) => page.matches)
				.map((match) => [
					`${match.signal.spaceId}:${match.signal.id}`,
					match,
				]) ?? []
		).values(),
	].map((match) => ({
		...match,
		spaceName:
			names?.organizationId === currentOrganization.id &&
			names.userId === currentUserId
				? (names.names.get(match.signal.spaceId)?.name ?? match.spaceName)
				: match.spaceName,
	}));
	const indexing = results.data?.pages.at(-1)?.indexing;
	const activities = [
		...new Map(
			results.data?.pages
				.flatMap((page) => page.activities)
				.map((item) => [item.id, item]) ?? []
		).values(),
	].map((item) => presentInboxItem(item, names));
	const { hasNextPage, isFetching, isError, fetchNextPage } = results;
	const resultCount = matches.length + activities.length;
	const continueAutomatically = Boolean(
		hasNextPage && (indexing || resultCount < 30)
	);
	// One search spans several requests; gaps between pages are not completion.
	const searching = Boolean(
		!isComposing &&
			[...searchText].length >= minimumQueryLength &&
			!isError &&
			(!query || results.isPending || isFetching || continueAutomatically)
	);
	useEffect(() => {
		if (continueAutomatically && !isFetching && !isError) {
			fetchNextPage();
		}
	}, [continueAutomatically, isFetching, isError, fetchNextPage]);
	return {
		results,
		matches,
		activities,
		searching,
		continueAutomatically,
		query,
		searchText,
		resultCount,
		minimumQueryLength,
		profileId,
		currentOrganization,
	};
}

function MessageSearchContents(input: {
	initialQuery?: string;
	onOpenChange: (value: boolean) => void;
	spaceId?: string;
	profileId?: string;
	scope?: "inbox" | "messages";
}) {
	const [draft, setDraft] = useState(input.initialQuery ?? "");
	const [isComposing, setIsComposing] = useState(false);
	const {
		results,
		matches,
		activities,
		searching,
		continueAutomatically,
		query,
		searchText,
		resultCount,
		minimumQueryLength,
		profileId,
		currentOrganization,
	} = useMessageSearch({ ...input, draft, isComposing });
	const showInitialState = Boolean(input.spaceId && !searchText);
	const showNoResults = Boolean(
		query &&
			!searching &&
			!results.isError &&
			!results.hasNextPage &&
			resultCount === 0
	);
	const showFullErrorState = results.isError && resultCount === 0;
	const showCenteredState =
		showInitialState || showNoResults || showFullErrorState;
	return (
		<>
			<Input
				aria-label="Search message text"
				maxLength={200}
				onChange={(event) => {
					setDraft(event.target.value);
				}}
				onCompositionEnd={(event) => {
					setDraft(event.currentTarget.value);
					setIsComposing(false);
				}}
				onCompositionStart={() => {
					setIsComposing(true);
				}}
				placeholder="Search text…"
				value={draft}
			/>
			<ScrollArea
				className={cn(
					"min-h-32 flex-1 rounded-md",
					showCenteredState &&
						"border border-border/70 border-dashed bg-card/25"
				)}
				contentClassName={showCenteredState ? "h-full" : undefined}
				scrollFade
				viewportProps={{ "aria-label": "Message search results" }}
			>
				<div
					className={cn(
						"space-y-2 p-2",
						showCenteredState && "flex h-full flex-col justify-center space-y-0"
					)}
				>
					{showInitialState && (
						<AppEmptyState
							className="h-full min-h-0 border-0 bg-transparent"
							description="Results will appear here."
							icon={<MagnifyingGlassIcon />}
							title="Start typing to search"
						/>
					)}
					{resultCount > 0 && (
						<FluidActionList
							aria-label="Search results"
							className="gap-1"
							hoverIndicatorClassName="rounded-md bg-interaction-hover"
						>
							{activities.map((item, index) => (
								<FluidActionListItem
									className="block w-full rounded-md p-3 text-left"
									index={index}
									key={item.id}
									onClick={() => input.onOpenChange(false)}
									render={
										<Link
											to={inboxSearchHref(currentOrganization.slug, item.id)}
										/>
									}
								>
									<p className="font-medium text-sm">{item.title}</p>
									<p className="line-clamp-3 text-muted-foreground text-sm">
										{item.preview}
									</p>
								</FluidActionListItem>
							))}
							{matches.map((match, index) => (
								<FluidActionListItem
									className="block w-full rounded-md p-3 text-left"
									index={activities.length + index}
									key={`${match.signal.spaceId}:${match.signal.id}`}
									onClick={() => input.onOpenChange(false)}
									render={
										<Link
											to={messageSearchHref(
												match,
												currentOrganization.slug,
												profileId
											)}
										/>
									}
								>
									<p className="truncate font-medium text-sm">
										{match.spaceName ?? "Conversation"}
									</p>
									<p className="line-clamp-3 text-sm">
										{sanitizeSignalTextPreview(match.signal.data.text) ??
											"Message"}
									</p>
									<p className="mt-1 text-muted-foreground text-xs">
										{match.signal.profile.profileName} ·{" "}
										{new Date(match.signal.ts).toLocaleString()}
									</p>
								</FluidActionListItem>
							))}
						</FluidActionList>
					)}
					<div
						aria-live="polite"
						className={cn(
							"text-muted-foreground text-sm",
							showCenteredState ? "sr-only" : "min-h-5"
						)}
					>
						{!(input.spaceId || isComposing) &&
							[...searchText].length < minimumQueryLength &&
							"Use at least 3 characters."}
						{searching && "Searching…"}
					</div>
					{showNoResults && (
						<AppEmptyState
							className="h-full min-h-0 border-0 bg-transparent"
							description="Try another search."
							icon={<MagnifyingGlassIcon />}
							title={`No messages found for “${query}”`}
						/>
					)}
					{results.isError && (
						<div
							className={showFullErrorState ? "h-full" : undefined}
							role="alert"
						>
							<AppEmptyState
								actions={
									<Button
										onClick={() => results.refetch()}
										size="sm"
										variant="secondary"
									>
										Try again
									</Button>
								}
								className={cn(
									"border-0 bg-transparent",
									showFullErrorState ? "h-full min-h-0" : "min-h-48"
								)}
								description={
									resultCount > 0
										? "Some results may be missing."
										: "Try again to search this conversation."
								}
								icon={<WarningCircleIcon />}
								title="Unable to finish searching"
							/>
						</div>
					)}
				</div>
			</ScrollArea>
			{results.hasNextPage && !continueAutomatically && (
				<Button
					disabled={results.isFetching}
					onClick={() => results.fetchNextPage()}
					variant="secondary"
				>
					Show more results
				</Button>
			)}
		</>
	);
}

function inboxSearchHref(orgSlug: string, itemId: string): string {
	return `${buildOrganizationInboxPath(orgSlug)}?item=${encodeURIComponent(itemId)}`;
}

export function messageSearchHref(
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
