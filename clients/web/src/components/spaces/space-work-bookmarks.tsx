import type {
	SpaceInputQueueResponse,
	WakeProgressItem,
} from "@openmeld/schemas/types";
import { isActiveWakeProgressItem } from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import {
	FluidActionList,
	FluidActionListItem,
} from "@openmeld/ui/fluid/action-list";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { CaretUpIcon, ClockIcon } from "@phosphor-icons/react";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "motion/react";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import {
	resolveWakeProgressStatus,
	WAKE_PROGRESS_STATUS_PRIORITY,
} from "#/lib/spaces/wake-progress-status";
import { SpaceAgentOrb } from "./space-agent-orb";
import { WAKE_STATUS_ORB_STATE } from "./space-agent-orb-state";

export function wakeBookmarkKey(item: WakeProgressItem): string {
	return `${item.clientMessageId ?? item.sourceSignalId ?? item.dispatchId}:${item.targetProfileId}`;
}

type QueueItem = SpaceInputQueueResponse["items"][number];
type WorkBookmark = {
	key: string;
	threadId: string | null;
	wake?: WakeProgressItem;
	queuedItems: readonly QueueItem[];
};
type BookmarkContext = {
	items: readonly WorkBookmark[];
	activeItems: readonly WorkBookmark[];
	hasMore: boolean;
	activeThreadId: string | null;
	jump: (item: WorkBookmark) => void;
	register: (key: string, element: HTMLElement) => () => void;
};
const Context = createContext<BookmarkContext | null>(null);

/** Navigation only: Wake progress owns execution, and the authorized Queue owns pending input. */
export function SpaceWorkBookmarksProvider(input: {
	children: ReactNode;
	profileId: string;
	items: readonly WakeProgressItem[];
	queuedItems: readonly QueueItem[];
	hasMore: boolean;
	activeThreadId: string | null;
	onShowConversation: () => void;
	onOpenThread: (threadId: string) => void;
	threadHasAttachments: boolean;
}) {
	const elements = useRef(new Map<string, Set<HTMLElement>>());
	const visibleElements = useRef(new Set<HTMLElement>());
	const unmeasuredElements = useRef(new Set<HTMLElement>());
	const [visibleKeys, setVisibleKeys] = useState<ReadonlySet<string>>(
		new Set()
	);
	const pendingJump = useRef<string | null>(null);
	const jumpToElement = useCallback((element: HTMLElement) => {
		element.scrollIntoView({ block: "center", behavior: "instant" });
		element.focus({ preventScroll: true });
	}, []);
	const register = useCallback(
		(key: string, element: HTMLElement) => {
			const group = elements.current.get(key) ?? new Set<HTMLElement>();
			group.add(element);
			unmeasuredElements.current.add(element);
			elements.current.set(key, group);
			if (pendingJump.current === key) {
				pendingJump.current = null;
				jumpToElement(element);
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const publishVisibility = () => {
				const visible = [...group].some(
					(node) =>
						visibleElements.current.has(node) ||
						unmeasuredElements.current.has(node)
				);
				setVisibleKeys((current) => {
					if (current.has(key) === visible) {
						return current;
					}
					const next = new Set(current);
					if (visible) {
						next.add(key);
					} else {
						next.delete(key);
					}
					return next;
				});
			};
			// Do not label a newly mounted row offscreen before scroll restoration
			// and the observer's first measurement have settled its placement.
			publishVisibility();
			const observer = new IntersectionObserver(
				([entry]) => {
					if (!entry) {
						return;
					}
					clearTimeout(timer);
					const firstMeasurement = unmeasuredElements.current.delete(element);
					// Require a readable status line, not a one-pixel glimpse at the edge.
					const visible =
						entry.isIntersecting &&
						entry.intersectionRatio >=
							(visibleElements.current.has(element) ? 0.3 : 0.6);
					const updateVisibility = () => {
						if (visible) {
							visibleElements.current.add(element);
						} else {
							visibleElements.current.delete(element);
						}
						publishVisibility();
					};
					if (firstMeasurement) {
						updateVisibility();
					} else {
						timer = setTimeout(updateVisibility, 120);
					}
				},
				{
					root: element.closest('[data-slot="message-scroller-viewport"]'),
					threshold: [0, 0.3, 0.6, 1],
				}
			);
			observer.observe(element);
			return () => {
				clearTimeout(timer);
				observer.disconnect();
				group.delete(element);
				visibleElements.current.delete(element);
				unmeasuredElements.current.delete(element);
				publishVisibility();
				if (group.size === 0) {
					elements.current.delete(key);
				}
			};
		},
		[jumpToElement]
	);
	const activeWakes = useMemo(
		() =>
			input.items
				.filter((item) => item.sourceContext?.profileId === input.profileId)
				.filter(isActiveWakeProgressItem)
				.sort(
					(left, right) => (left.startedAtMs ?? 0) - (right.startedAtMs ?? 0)
				),
		[input.items, input.profileId]
	);
	const activeItems = useMemo(() => {
		const bookmarks: WorkBookmark[] = activeWakes.map((wake) => ({
			key: wakeBookmarkKey(wake),
			threadId: wake.sourceContext?.threadId ?? null,
			wake,
			queuedItems: [],
		}));
		const threads = new Map<string, QueueItem[]>();
		for (const item of input.queuedItems) {
			if (
				item.authorProfileId !== input.profileId ||
				!item.threadId ||
				item.threadId === input.activeThreadId
			) {
				continue;
			}
			const group = threads.get(item.threadId) ?? [];
			group.push(item);
			threads.set(item.threadId, group);
		}
		for (const [threadId, queuedItems] of threads) {
			const key = `queue:${threadId}`;
			const originalWork = bookmarks.find(
				(bookmark) =>
					bookmark.threadId === threadId &&
					queuedItems.some(
						(item) =>
							item.target.dispatchId === bookmark.wake?.dispatchId &&
							item.target.targetProfileId === bookmark.wake?.targetProfileId
					)
			);
			if (originalWork) {
				originalWork.key = key;
				originalWork.queuedItems = queuedItems;
			} else {
				bookmarks.push({ key, threadId, queuedItems });
			}
		}
		return bookmarks;
	}, [activeWakes, input.queuedItems, input.profileId, input.activeThreadId]);
	const items = activeItems.filter(
		(item) => item.queuedItems.length > 0 || !visibleKeys.has(item.key)
	);
	const jump = (item: WorkBookmark) => {
		const key = item.key;
		const element = elements.current.get(key)?.values().next().value;
		input.onShowConversation();
		const threadId = item.threadId;
		if (threadId && threadId !== input.activeThreadId) {
			if (input.threadHasAttachments) {
				toast.info(
					"Send or remove your thread attachments before opening another thread."
				);
				return;
			}
			// Opening restores the Thread's composer and its Queue tray. Only
			// ordinary work bookmarks need to seek a message status anchor.
			pendingJump.current = item.queuedItems.length ? null : key;
			input.onOpenThread(threadId);
			return;
		}
		if (element) {
			jumpToElement(element);
		} else {
			pendingJump.current = key;
		}
	};
	return (
		<Context.Provider
			value={{
				items,
				activeItems,
				hasMore: input.hasMore,
				activeThreadId: input.activeThreadId,
				register,
				jump,
			}}
		>
			{input.children}
		</Context.Provider>
	);
}

export function SpaceWakeBookmarkAnchor(input: {
	item: WakeProgressItem;
	children: ReactNode;
}) {
	const context = useContext(Context);
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const key = wakeBookmarkKey(input.item);
	const register = context?.register;
	useLayoutEffect(
		() => (element && register ? register(key, element) : undefined),
		[element, key, register]
	);
	return (
		<div
			className="min-w-0 rounded-md focus:bg-muted/50 focus:outline-none"
			data-wake-bookmark-anchor={key}
			ref={setElement}
			tabIndex={-1}
		>
			{input.children}
		</div>
	);
}

export function SpaceComposerWorkBookmarks(input: {
	placement: "conversation" | "thread";
}) {
	const context = useContext(Context);
	if (!context || (input.placement === "thread" && !context.activeThreadId)) {
		return null;
	}
	const threadId = input.placement === "thread" ? context.activeThreadId : null;
	const belongsHere = (item: WorkBookmark) => {
		const sourceThreadId = item.threadId;
		return input.placement === "thread"
			? sourceThreadId === threadId
			: !sourceThreadId || sourceThreadId !== context.activeThreadId;
	};
	return (
		<SpaceComposerWorkBookmarkControl
			context={{
				...context,
				items: context.items.filter(belongsHere),
				activeItems: context.activeItems.filter(belongsHere),
			}}
			key={`${input.placement}:${context.activeThreadId ?? "closed"}`}
		/>
	);
}

function SpaceComposerWorkBookmarkControl({
	context,
}: {
	context: BookmarkContext;
}) {
	const [open, setOpen] = useState(false);
	const [openedItems, setOpenedItems] = useState<readonly WorkBookmark[]>([]);
	const items = open
		? openedItems.map(
				(item) =>
					context.activeItems.find((current) => current.key === item.key) ??
					item
			)
		: context.items;
	const selected = items
		.filter((item) =>
			context.activeItems.some((current) => current.key === item.key)
		)
		.sort((left, right) => {
			const a = left.wake ? resolveWakeProgressStatus(left.wake) : null;
			const b = right.wake ? resolveWakeProgressStatus(right.wake) : null;
			return (
				(a ? WAKE_PROGRESS_STATUS_PRIORITY[a.kind] : 99) -
				(b ? WAKE_PROGRESS_STATUS_PRIORITY[b.kind] : 99)
			);
		})[0];
	const status = selected ? resolveBookmarkStatus(selected) : null;
	const visible = open || Boolean(selected && status);
	const multiple = items.length > 1 || context.hasMore || open;
	const button = renderBookmarkTrigger({
		status,
		threadId: selected?.threadId ?? null,
		multiple,
		count: items.length,
		hasMore: context.hasMore,
		onJump: () => selected && context.jump(selected),
	});
	if (!visible) {
		return null;
	}
	return (
		<div className="min-w-0" data-slot="composer-work-bookmarks">
			<Popover
				onOpenChange={(next) => {
					if (next && !multiple) {
						return;
					}
					if (next) {
						setOpenedItems(context.items);
					}
					setOpen(next);
				}}
				open={open}
			>
				<PopoverTrigger render={button} />
				<PopoverContent
					align="end"
					className="w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md motion-reduce:animate-none"
					side="top"
				>
					<ScrollArea className="max-h-72">
						<PopoverTitle>Work outside your view</PopoverTitle>
						<FluidActionList className="gap-1" gapClick={false}>
							{items.map((item, index) => (
								<WorkBookmarkRow
									current={context.activeItems.find(
										(candidate) => candidate.key === item.key
									)}
									index={index}
									item={item}
									key={item.key}
									onClick={() => {
										context.jump(item);
										setOpen(false);
									}}
								/>
							))}
						</FluidActionList>
						{context.hasMore ? (
							<p className="text-muted-foreground">
								This list may be incomplete. More work is active in this Space.
							</p>
						) : null}
					</ScrollArea>
				</PopoverContent>
			</Popover>
		</div>
	);
}

function renderBookmarkTrigger({
	status,
	threadId,
	multiple,
	count,
	hasMore,
	onJump,
}: {
	status: ReturnType<typeof resolveBookmarkStatus> | null;
	threadId: string | null;
	multiple: boolean;
	count: number;
	hasMore: boolean;
	onJump: () => void;
}) {
	const destination = threadId ? "View Thread" : "View working agent";
	const action = multiple ? "Show work and queued messages" : destination;
	return (
		<Button
			aria-label={
				status ? `${status.label}. ${action}` : "Work and queued messages"
			}
			className="w-full min-w-0 max-w-56 gap-2 text-muted-foreground transition-colors"
			onClick={multiple ? undefined : onJump}
			size="sm"
			type="button"
			variant="ghost"
		>
			{status?.wake ? (
				<SpaceAgentOrb state={WAKE_STATUS_ORB_STATE[status.wake.kind]} />
			) : (
				<ClockIcon className="size-4" />
			)}
			<WorkBookmarkText
				textKey={`${status?.label}:${multiple}:${count}:${hasMore}`}
			>
				<span className="min-w-0 truncate text-xs">
					{status?.wake?.label ?? status?.label ?? "Work and queued messages"}
				</span>
				{status?.wake && status.queueLabel ? (
					<span className="shrink-0 text-xs tabular-nums">
						{status.queueLabel}
					</span>
				) : null}
				{multiple ? (
					<>
						<span className="text-xs tabular-nums">
							{count}
							{hasMore ? "+" : ""}
						</span>
						<CaretUpIcon className="size-3" />
					</>
				) : null}
			</WorkBookmarkText>
		</Button>
	);
}

function WorkBookmarkText({
	textKey,
	children,
}: {
	textKey: string;
	children: ReactNode;
}) {
	return (
		<span aria-hidden className="relative block min-w-0 overflow-hidden">
			<AnimatePresence initial={false}>
				<WorkBookmarkTextFrame key={textKey}>{children}</WorkBookmarkTextFrame>
			</AnimatePresence>
		</span>
	);
}

function WorkBookmarkTextFrame({ children }: { children: ReactNode }) {
	const present = useIsPresent();
	const reducedMotion = useReducedMotion();
	return (
		<motion.span
			animate={{
				opacity: 1,
				filter: "blur(0px)",
				transform: "translateY(0px)",
			}}
			className="flex min-w-0 items-center gap-2"
			exit={{
				opacity: 0,
				filter: reducedMotion ? "none" : "blur(3px)",
				transform: reducedMotion ? "none" : "translateY(4px)",
			}}
			initial={{
				opacity: 0,
				filter: reducedMotion ? "none" : "blur(3px)",
				transform: reducedMotion ? "none" : "translateY(4px)",
			}}
			style={
				present ? { position: "relative" } : { position: "absolute", inset: 0 }
			}
			transition={{
				duration: reducedMotion ? 0 : 0.18,
				ease: [0.23, 1, 0.32, 1],
			}}
		>
			{children}
		</motion.span>
	);
}

function resolveBookmarkStatus(item: WorkBookmark) {
	const wake = item.wake ? resolveWakeProgressStatus(item.wake) : null;
	const count = item.queuedItems.length;
	if (!(wake || count)) {
		return null;
	}
	let queueLabel =
		count === 1 ? "1 queued message" : `${count} queued messages`;
	if (item.queuedItems.some((queued) => queued.state === "unconfirmed")) {
		queueLabel = "Queue needs attention";
	} else if (
		count &&
		item.queuedItems.every((queued) => queued.state === "claimed")
	) {
		queueLabel = "Confirming delivery…";
	}
	return {
		wake,
		queueLabel: count ? queueLabel : null,
		label: wake
			? `${wake.label}${count ? ` · ${queueLabel}` : ""}`
			: queueLabel,
	};
}

function WorkBookmarkRow(input: {
	item: WorkBookmark;
	current: WorkBookmark | undefined;
	index: number;
	onClick: () => void;
}) {
	const step = input.current ? resolveBookmarkStatus(input.current) : null;
	return (
		<FluidActionListItem
			className="flex items-start gap-2 rounded-md p-2 text-left disabled:text-muted-foreground"
			disabled={!input.current}
			index={input.index}
			onClick={input.onClick}
			type="button"
		>
			{step?.wake ? (
				<SpaceAgentOrb state={WAKE_STATUS_ORB_STATE[step.wake.kind]} />
			) : (
				<ClockIcon className="size-4 shrink-0" />
			)}
			<span className="min-w-0">
				<span className="block text-xs">
					{step?.label ?? "No longer active"}
				</span>
				<span className="mt-1 block truncate text-muted-foreground text-xs">
					{input.item.queuedItems[0]?.text ??
						input.item.wake?.sourceContext?.messagePreview ??
						"View request"}
				</span>
				{input.item.threadId ? (
					<span className="text-muted-foreground text-xs">Thread</span>
				) : null}
			</span>
		</FluidActionListItem>
	);
}
