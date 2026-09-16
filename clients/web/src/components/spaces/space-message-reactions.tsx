import type {
	SpaceMessageReactions,
	SpaceReactionGroup,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowLeftIcon, PlusIcon, SmileyIcon } from "@phosphor-icons/react";
import {
	useInfiniteQuery,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	createContext,
	lazy,
	type ReactNode,
	Suspense,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { writeSpaceHistoryReactionsToCache } from "#/query/spaces/history";
import { MessageActionTooltip } from "./space-message-actions";
import { SpaceMessageProfileAvatar } from "./space-message-profile-avatar";

const FullEmojiPicker = lazy(() => import("./space-emoji-picker"));
const EMPTY: SpaceMessageReactions = { version: 0, groups: [] };
const QUICK = [
	{ emoji: "👍️", label: "thumbs up" },
	{ emoji: "❤️", label: "red heart" },
	{ emoji: "😂", label: "face with tears of joy" },
	{ emoji: "🎉", label: "party popper" },
	{ emoji: "👀", label: "eyes" },
	{ emoji: "✅️", label: "check mark button" },
];
export type MessageReactionInput = {
	spaceId: string;
	signalId: string;
	profileId: string;
	snapshot?: SpaceMessageReactions;
	readOnly?: boolean;
};
export function resolveMessageReactionInput(
	item: SpaceTimelineItem,
	profileId: string,
	readOnly?: boolean
): MessageReactionInput | undefined {
	if (
		item.signalType !== "signal.text" ||
		item.deliveryState !== "sent" ||
		item.actorProfileKind === "system" ||
		item.agentStreamState
	) {
		return undefined;
	}
	return {
		spaceId: item.spaceId,
		signalId: item.id,
		profileId,
		snapshot: item.reactions,
		readOnly,
	};
}
const MessageReactionsContext = createContext<{
	input?: MessageReactionInput;
	state: ReturnType<typeof useMessageReactions>;
} | null>(null);

export function MessageReactionsProvider({
	input,
	children,
}: {
	input?: MessageReactionInput;
	children: ReactNode;
}) {
	const state = useMessageReactions(input);
	return (
		<MessageReactionsContext value={{ input, state }}>
			{children}
		</MessageReactionsContext>
	);
}

export function useMessageReactionsContext() {
	const context = useContext(MessageReactionsContext);
	if (!context) {
		throw new Error("Message reactions require a message provider");
	}
	return context;
}

export function MessageBubbleReactions() {
	const { input, state } = useMessageReactionsContext();
	return input ? (
		<MessageReactionRow
			profileId={input.profileId}
			readOnly={input.readOnly}
			state={state}
		/>
	) : null;
}

export function messageReactionsKey(spaceId: string, signalId?: string) {
	return signalId
		? (["space-message-reactions", spaceId, signalId] as const)
		: (["space-message-reactions", spaceId] as const);
}
export function useMessageReactions(input?: MessageReactionInput) {
	const queryClient = useQueryClient();
	const api = useMemo(
		() => createUnscopedWebSpaceApi({ openMeldProfileId: input?.profileId }),
		[input?.profileId]
	);
	const key = useMemo(
		() => [
			...messageReactionsKey(input?.spaceId ?? "", input?.signalId ?? ""),
			input?.profileId,
		],
		[input?.spaceId, input?.signalId, input?.profileId]
	);
	function saveHistoryReactions(reactions: SpaceMessageReactions) {
		if (input) {
			writeSpaceHistoryReactionsToCache({
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
				signalId: input.signalId,
				reactions,
			});
		}
		return reactions;
	}
	const query = useQuery({
		queryKey: key,
		enabled: Boolean(input),
		staleTime: Number.POSITIVE_INFINITY,
		initialData: input?.snapshot,
		queryFn: async () => {
			if (!input) {
				return EMPTY;
			}
			return saveHistoryReactions(
				(
					await api.getMessageReactions({
						spaceId: input.spaceId,
						signalId: input.signalId,
					})
				).reactions
			);
		},
		structuralSharing: (oldData, newData) => {
			const old = oldData as SpaceMessageReactions | undefined,
				next = newData as SpaceMessageReactions;
			return old && old.version > next.version ? old : next;
		},
	});
	// Restoring history may happen after this query mounted. Use its newer
	// snapshot immediately, rather than rendering an empty row until an effect.
	const reactions =
		input?.snapshot && input.snapshot.version > (query.data?.version ?? -1)
			? input.snapshot
			: (query.data ?? EMPTY);
	useEffect(() => {
		const snapshot = input?.snapshot;
		if (snapshot) {
			queryClient.setQueryData<SpaceMessageReactions>(key, (previous) =>
				!previous || previous.version < snapshot.version ? snapshot : previous
			);
		}
	}, [input?.snapshot, key, queryClient]);
	const [pending, setPending] = useState<
		Record<string, { active: boolean; label: string }>
	>({});
	const inFlight = useRef(new Set<string>());
	const [error, setError] = useState<string | null>(null);
	const [viewerOpen, setViewerOpen] = useState(false);
	const groups = reactions.groups
		.map((group) => {
			const change = pending[group.emoji];
			if (!change || change.active === group.reactedByMe) {
				return group;
			}
			return {
				...group,
				reactedByMe: change.active,
				count: group.count + (change.active ? 1 : -1),
			};
		})
		.filter((group) => group.count > 0);
	for (const [emoji, change] of Object.entries(pending)) {
		if (change.active && !groups.some((group) => group.emoji === emoji)) {
			groups.push({
				emoji,
				label: change.label,
				count: 1,
				reactedByMe: true,
				actors: [],
				actorsHasMore: false,
			});
		}
	}
	async function toggle(emoji: { emoji: string; label: string }) {
		if (!input || input.readOnly || inFlight.current.has(emoji.emoji)) {
			return;
		}
		inFlight.current.add(emoji.emoji);
		const active = !reactions.groups.find(
			(group) => group.emoji === emoji.emoji
		)?.reactedByMe;
		setPending((previous) => ({
			...previous,
			[emoji.emoji]: { active, label: emoji.label },
		}));
		setError(null);
		try {
			const response = await api.setMessageReaction({
				spaceId: input.spaceId,
				signalId: input.signalId,
				emoji: emoji.emoji,
				active,
			});
			// The user may have navigated away while this request was in flight.
			saveHistoryReactions(response.reactions);
			queryClient.setQueryData<SpaceMessageReactions>(key, (old) =>
				!old || old.version <= response.reactions.version
					? response.reactions
					: old
			);
		} catch {
			// A failed response does not prove the write failed. Keep the user's
			// optimistic intent visible until a fresh read confirms the outcome.
			const refreshed = await query.refetch({ throwOnError: false });
			const confirmed =
				refreshed.isSuccess &&
				Boolean(
					refreshed.data.groups.find((group) => group.emoji === emoji.emoji)
						?.reactedByMe
				) === active;
			setError(confirmed ? null : "Couldn’t update your reaction. Try again.");
		} finally {
			inFlight.current.delete(emoji.emoji);
			setPending((previous) => {
				const next = { ...previous };
				delete next[emoji.emoji];
				return next;
			});
		}
	}
	return {
		groups,
		toggle,
		pending,
		error: error ?? (query.isError ? "Couldn’t refresh reactions." : null),
		retry: () => {
			setError(null);
			query.refetch();
		},
		viewerOpen,
		setViewerOpen,
		snapshot: reactions,
	};
}
export type MessageReactionsState = ReturnType<typeof useMessageReactions>;
export function MessageReactionIcon() {
	return (
		<span className="relative">
			<SmileyIcon aria-hidden="true" />
			<PlusIcon
				aria-hidden="true"
				className="absolute -top-1 -right-1 size-2.5"
			/>
		</span>
	);
}

export function MessageReactionPicker({
	state,
	buttonClassName,
}: {
	state: MessageReactionsState;
	buttonClassName: string;
}) {
	const [open, setOpen] = useState(false),
		[expanded, setExpanded] = useState(false);
	const triggerRef = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		if (!open) {
			return;
		}
		function closeOnMessageScroll(event: Event) {
			// Ignore scrolling inside the emoji picker or another panel.
			if (
				event.target instanceof Node &&
				event.target.contains(triggerRef.current)
			) {
				setOpen(false);
				setExpanded(false);
			}
		}
		document.addEventListener("scroll", closeOnMessageScroll, true);
		return () =>
			document.removeEventListener("scroll", closeOnMessageScroll, true);
	}, [open]);
	return (
		<Popover
			onOpenChange={(value) => {
				setOpen(value);
				if (!value) {
					setExpanded(false);
				}
			}}
			open={open}
		>
			<MessageActionTooltip label="Add reaction">
				<PopoverTrigger
					aria-label="Add reaction"
					className={buttonClassName}
					ref={triggerRef}
					render={<Button size="icon-sm" variant="ghost" />}
				>
					<MessageReactionIcon />
				</PopoverTrigger>
			</MessageActionTooltip>
			<PopoverContent
				align="start"
				className={cn(
					"max-w-[calc(100vw-2rem)] rounded-md border-0 p-1 ring-0 motion-reduce:animate-none",
					surfaceClasses(3),
					expanded ? "w-[18rem]" : "w-auto"
				)}
				sideOffset={6}
			>
				<PopoverTitle className="sr-only">Add reaction</PopoverTitle>
				{expanded ? (
					<>
						<Button
							onClick={() => setExpanded(false)}
							size="sm"
							variant="ghost"
						>
							<ArrowLeftIcon aria-hidden="true" />
							Quick reactions
						</Button>
						<Suspense fallback={<p className="p-3 text-xs">Loading emoji…</p>}>
							<FullEmojiPicker
								onSelect={(emoji) => {
									state.toggle(emoji);
									setOpen(false);
									setExpanded(false);
								}}
							/>
						</Suspense>
					</>
				) : (
					<div className="flex items-center gap-0.5">
						{QUICK.map((emoji) => (
							<Button
								aria-label={`React with ${emoji.label}`}
								aria-pressed={state.groups.some(
									(group) => group.emoji === emoji.emoji && group.reactedByMe
								)}
								className="size-8 text-xl"
								disabled={Boolean(state.pending[emoji.emoji])}
								key={emoji.emoji}
								onClick={() => {
									state.toggle(emoji);
									setOpen(false);
								}}
								size="icon-sm"
								variant="ghost"
							>
								{emoji.emoji}
							</Button>
						))}
						<Button
							aria-label="More emoji"
							onClick={() => setExpanded(true)}
							size="icon-sm"
							variant="ghost"
						>
							<PlusIcon aria-hidden="true" />
						</Button>
					</div>
				)}
			</PopoverContent>
		</Popover>
	);
}
function reactionLabel(
	group: SpaceReactionGroup,
	profileId: string,
	readOnly?: boolean
) {
	const others = group.actors.filter((actor) => actor.profileId !== profileId);
	const names = [
		...(group.reactedByMe ? ["You"] : []),
		...others.slice(0, 3).map((actor) => actor.displayName),
	];
	const remaining = Math.max(0, group.count - names.length);
	return `${names.join(", ")}${remaining ? ` and ${remaining} others` : ""}${group.reactedByMe && !readOnly ? " (click to remove)" : ""}`;
}
type MessageReactionRowProps = {
	state: MessageReactionsState;
	readOnly?: boolean;
	profileId: string;
};

export function MessageReactionRow(props: MessageReactionRowProps) {
	if (props.state.groups.length === 0) {
		return null;
	}
	return <PopulatedMessageReactionRow {...props} />;
}

function PopulatedMessageReactionRow({
	state,
	readOnly,
	profileId,
}: MessageReactionRowProps) {
	const measureRef = useRef<HTMLDivElement>(null);
	const rowRef = useRef<HTMLDivElement>(null);
	const [visibleCount, setVisibleCount] = useState(0);
	const [naturalWidth, setNaturalWidth] = useState(0);
	useLayoutEffect(() => {
		const row = rowRef.current;
		const measure = measureRef.current;
		if (!(row && measure)) {
			return;
		}
		const update = () => {
			const widths = Array.from(measure.children).map(
				(el) => el.getBoundingClientRect().width
			);
			const available = row.getBoundingClientRect().width;
			const total = Math.max(
				0,
				widths.reduce((sum, width) => sum + width + 4, -4)
			);
			setNaturalWidth(total);
			let count = widths.length;
			if (total > available) {
				let used = 0;
				count = 0;
				for (const width of widths) {
					if (used + width + 4 + 40 > available) {
						break;
					}
					used += width + 4;
					count++;
				}
			}
			setVisibleCount(count);
		};
		update();
		const observer = new ResizeObserver(update);
		observer.observe(row);
		observer.observe(measure);
		return () => observer.disconnect();
	}, []);
	const renderPill = (group: SpaceReactionGroup) => (
		<MessageActionTooltip
			key={group.emoji}
			label={reactionLabel(group, profileId, readOnly)}
		>
			<button
				aria-label={`${group.label}, ${group.count} ${group.count === 1 ? "reaction" : "reactions"}${group.reactedByMe ? ", including you" : ""}`}
				aria-pressed={group.reactedByMe}
				className={cn(
					"inline-flex h-6 min-w-9 shrink-0 items-center justify-center gap-0.5 rounded-full border-0 px-1.5 text-[11px] tabular-nums outline-none hover:bg-surface-3 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
					surfaceClasses(group.reactedByMe ? 2 : 1),
					group.reactedByMe ? "text-foreground" : "text-muted-foreground"
				)}
				disabled={readOnly || Boolean(state.pending[group.emoji])}
				onClick={() => state.toggle(group)}
				type="button"
			>
				<span aria-hidden="true" className="text-sm leading-none">
					{group.emoji}
				</span>
				{group.count}
			</button>
		</MessageActionTooltip>
	);
	const hidden = state.groups.slice(visibleCount);
	return (
		<div
			className="relative flex min-w-0 max-w-full shrink items-center gap-1"
			data-slot="message-reactions"
			ref={rowRef}
			style={{ width: naturalWidth, minWidth: 36 }}
		>
			<div
				aria-hidden="true"
				className="pointer-events-none invisible absolute size-0 overflow-hidden"
				inert
			>
				<div className="flex w-max gap-1" ref={measureRef}>
					{state.groups.map(renderPill)}
				</div>
			</div>
			{state.groups.slice(0, visibleCount).map(renderPill)}
			{hidden.length > 0 ? (
				<Popover>
					<PopoverTrigger
						aria-label={`${hidden.length} more reactions`}
						className={cn(
							"inline-flex h-6 min-w-9 shrink-0 items-center justify-center rounded-full px-1.5 text-[11px] tabular-nums",
							surfaceClasses(1)
						)}
						closeDelay={200}
						delay={150}
						openOnHover
						render={<button type="button" />}
					>
						+{hidden.length}
					</PopoverTrigger>
					<PopoverContent
						align="start"
						className={cn(
							"w-auto max-w-72 rounded-md border-0 p-2 ring-0 motion-reduce:animate-none",
							surfaceClasses(3)
						)}
					>
						<PopoverTitle className="sr-only">More reactions</PopoverTitle>
						<div className="flex flex-wrap gap-1">{hidden.map(renderPill)}</div>
						<Button
							onClick={() => state.setViewerOpen(true)}
							size="sm"
							variant="ghost"
						>
							View reactions
						</Button>
					</PopoverContent>
				</Popover>
			) : null}
		</div>
	);
}

export function MessageReactionViewer({
	input,
	state,
}: {
	input: MessageReactionInput;
	state: MessageReactionsState;
}) {
	const [selected, setSelected] = useState<string | null>(null);
	const emoji = state.groups.some((group) => group.emoji === selected)
		? (selected ?? undefined)
		: state.groups[0]?.emoji;
	const api = useMemo(
		() => createUnscopedWebSpaceApi({ openMeldProfileId: input.profileId }),
		[input.profileId]
	);
	const query = useInfiniteQuery({
		queryKey: [
			...messageReactionsKey(input.spaceId, input.signalId),
			input.profileId,
			"actors",
			emoji,
			state.snapshot.version,
		],
		enabled: state.viewerOpen && Boolean(emoji),
		initialPageParam: undefined as string | undefined,
		queryFn: ({ pageParam }) =>
			api.getMessageReactions({
				spaceId: input.spaceId,
				signalId: input.signalId,
				emoji,
				afterProfileId: pageParam,
			}),
		getNextPageParam: (last) => last.nextCursor ?? undefined,
	});
	return (
		<Dialog onOpenChange={state.setViewerOpen} open={state.viewerOpen}>
			<DialogContent className="motion-reduce:animate-none">
				<DialogTitle>Reactions</DialogTitle>
				<DialogDescription>
					People who reacted to this message.
				</DialogDescription>
				<div className="flex flex-wrap gap-1">
					{state.groups.map((group) => (
						<Button
							aria-label={`${group.label}, ${group.count}`}
							aria-pressed={emoji === group.emoji}
							key={group.emoji}
							onClick={() => setSelected(group.emoji)}
							size="sm"
							variant={emoji === group.emoji ? "secondary" : "ghost"}
						>
							{group.emoji} {group.count}
						</Button>
					))}
				</div>
				<div className="max-h-64 space-y-3 overflow-y-auto">
					{query.data?.pages
						.flatMap((page) => page.actors ?? [])
						.map((actor) => (
							<div className="flex items-center gap-2" key={actor.profileId}>
								<SpaceMessageProfileAvatar
									agentControllerRef={null}
									avatarImageUrl={null}
									displayName={actor.displayName}
									isCenterAgent={false}
									profileId={actor.profileId}
									profileKind={actor.profileKind}
								/>
								<span className="text-sm">
									{actor.displayName}
									{actor.profileId === input.profileId ? " (you)" : ""}
								</span>
							</div>
						))}
					{query.isPending && emoji ? <p>Loading reactions…</p> : null}
					{emoji ? null : (
						<p className="text-muted-foreground">No reactions yet.</p>
					)}
					{query.isError ? (
						<output className="block">
							Couldn’t load reactions.{" "}
							<button
								className="underline"
								onClick={() => query.refetch()}
								type="button"
							>
								Try again
							</button>
						</output>
					) : null}
					{query.hasNextPage ? (
						<Button
							disabled={query.isFetchingNextPage}
							onClick={() => query.fetchNextPage()}
							size="sm"
							variant="ghost"
						>
							Show more
						</Button>
					) : null}
				</div>
			</DialogContent>
		</Dialog>
	);
}
