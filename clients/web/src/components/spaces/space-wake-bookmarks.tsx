import type { WakeProgressItem } from "@openmeld/schemas/types";
import { isActiveWakeProgressItem } from "@openmeld/space";
import { Button } from "@openmeld/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
	PopoverTrigger,
} from "@openmeld/ui/components/popover";
import { CaretUpIcon } from "@phosphor-icons/react";
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
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { isSpaceWakeProgressWaitingForFinalStatus } from "#/lib/spaces/message-state";
import { useNowMs } from "#/lib/spaces/use-now-ms";
import { resolveWakeProgressThinkingEntry } from "#/lib/spaces/wake-progress-presentation";
import {
	resolveWakeProgressStatus,
	WAKE_PROGRESS_STATUS_PRIORITY,
} from "#/lib/spaces/wake-progress-status";
import { SpaceAgentOrb } from "./space-agent-orb";
import { WAKE_STATUS_ORB_STATE } from "./space-agent-orb-state";

export function wakeBookmarkKey(item: WakeProgressItem): string {
	return `${item.clientMessageId ?? item.sourceSignalId ?? item.dispatchId}:${item.targetProfileId}`;
}

type BookmarkContext = {
	items: readonly WakeProgressItem[];
	activeItems: readonly WakeProgressItem[];
	hasMore: boolean;
	activeThreadId: string | null;
	jump: (item: WakeProgressItem) => void;
	register: (key: string, element: HTMLElement) => () => void;
};
const Context = createContext<BookmarkContext | null>(null);

/** Viewport state controls placement only; execution remains owned by Wake progress. */
export function SpaceWakeBookmarksProvider(input: {
	children: ReactNode;
	profileId: string;
	items: readonly WakeProgressItem[];
	hasMore: boolean;
	activeThreadId: string | null;
	onShowConversation: () => void;
	onOpenThread: (threadId: string) => void;
	threadHasAttachments: boolean;
}) {
	const elements = useRef(new Map<string, Set<HTMLElement>>());
	const visibleElements = useRef(new Set<HTMLElement>());
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
			elements.current.set(key, group);
			if (pendingJump.current === key) {
				pendingJump.current = null;
				jumpToElement(element);
			}
			let timer: ReturnType<typeof setTimeout> | undefined;
			const publishVisibility = () => {
				const visible = [...group].some((node) =>
					visibleElements.current.has(node)
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
			const observer = new IntersectionObserver(
				([entry]) => {
					if (!entry) {
						return;
					}
					clearTimeout(timer);
					// Require a readable status line, not a one-pixel glimpse at the edge.
					const visible =
						entry.isIntersecting &&
						entry.intersectionRatio >=
							(visibleElements.current.has(element) ? 0.3 : 0.6);
					timer = setTimeout(() => {
						if (visible) {
							visibleElements.current.add(element);
						} else {
							visibleElements.current.delete(element);
						}
						publishVisibility();
					}, 120);
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
				publishVisibility();
				if (group.size === 0) {
					elements.current.delete(key);
				}
			};
		},
		[jumpToElement]
	);
	const activeItems = useMemo(
		() =>
			input.items
				.filter((item) => item.sourceContext?.profileId === input.profileId)
				.filter(isActiveWakeProgressItem)
				.sort(
					(left, right) => (left.startedAtMs ?? 0) - (right.startedAtMs ?? 0)
				),
		[input.items, input.profileId]
	);
	const items = activeItems.filter(
		(item) => !visibleKeys.has(wakeBookmarkKey(item))
	);
	const jump = (item: WakeProgressItem) => {
		const key = wakeBookmarkKey(item);
		const element = elements.current.get(key)?.values().next().value;
		input.onShowConversation();
		const threadId = item.sourceContext?.threadId;
		if (threadId && threadId !== input.activeThreadId) {
			if (input.threadHasAttachments) {
				toast.info(
					"Send or remove your thread attachments before opening another thread."
				);
				return;
			}
			pendingJump.current = key;
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
	useEffect(
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

export function SpaceComposerActiveWakes(input: {
	placement: "conversation" | "thread";
}) {
	const context = useContext(Context);
	if (!context || (input.placement === "thread" && !context.activeThreadId)) {
		return null;
	}
	const threadId = input.placement === "thread" ? context.activeThreadId : null;
	const belongsHere = (item: WakeProgressItem) => {
		const sourceThreadId = item.sourceContext?.threadId ?? null;
		return input.placement === "thread"
			? sourceThreadId === threadId
			: !sourceThreadId || sourceThreadId !== context.activeThreadId;
	};
	return (
		<SpaceComposerWakeBookmarks
			context={{
				...context,
				items: context.items.filter(belongsHere),
				activeItems: context.activeItems.filter(belongsHere),
			}}
			key={`${input.placement}:${context.activeThreadId ?? "closed"}`}
		/>
	);
}

function SpaceComposerWakeBookmarks({ context }: { context: BookmarkContext }) {
	const nowMs = useNowMs(context.activeItems.length ? 1000 : null);
	const [open, setOpen] = useState(false);
	const [openedItems, setOpenedItems] = useState<readonly WakeProgressItem[]>(
		[]
	);
	const items = open
		? openedItems.map(
				(item) =>
					context.activeItems.find(
						(current) => wakeBookmarkKey(current) === wakeBookmarkKey(item)
					) ?? item
			)
		: context.items;
	const selected = items
		.filter((item) =>
			context.activeItems.some(
				(current) => wakeBookmarkKey(current) === wakeBookmarkKey(item)
			)
		)
		.sort((left, right) => {
			const a = resolveWakeProgressStatus(left);
			const b = resolveWakeProgressStatus(right);
			return (
				(a ? WAKE_PROGRESS_STATUS_PRIORITY[a.kind] : 99) -
				(b ? WAKE_PROGRESS_STATUS_PRIORITY[b.kind] : 99)
			);
		})[0];
	const status = selected ? resolveBookmarkStatus(selected, nowMs) : null;
	const visible = open || Boolean(selected && status);
	const multiple = items.length > 1 || context.hasMore || open;
	const button = renderBookmarkTrigger({
		status,
		multiple,
		count: items.length,
		hasMore: context.hasMore,
		onJump: () => selected && context.jump(selected),
	});
	return (
		<AnimatePresence initial={false}>
			{visible ? (
				<WakeBookmarkPresence>
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
							className="max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-md motion-reduce:animate-none"
							side="top"
						>
							<PopoverTitle>Work outside your view</PopoverTitle>
							<div className="flex flex-col gap-1">
								{items.map((item) => (
									<WakeBookmarkRow
										current={context.activeItems.find(
											(candidate) =>
												wakeBookmarkKey(candidate) === wakeBookmarkKey(item)
										)}
										item={item}
										key={wakeBookmarkKey(item)}
										nowMs={nowMs}
										onClick={() => {
											context.jump(item);
											setOpen(false);
										}}
									/>
								))}
							</div>
							{context.hasMore ? (
								<p className="text-muted-foreground">
									This list may be incomplete. More work is active in this
									Space.
								</p>
							) : null}
						</PopoverContent>
					</Popover>
				</WakeBookmarkPresence>
			) : null}
		</AnimatePresence>
	);
}

function WakeBookmarkPresence({ children }: { children: ReactNode }) {
	const present = useIsPresent();
	const reducedMotion = useReducedMotion();
	return (
		<motion.div
			animate={{
				opacity: 1,
				transform: "translateY(0px)",
				filter: "blur(0px)",
			}}
			aria-hidden={!present}
			className="min-w-0"
			data-slot="composer-active-wakes"
			exit={{
				opacity: 0,
				transform: reducedMotion ? "none" : "translateY(6px)",
				filter: reducedMotion ? "none" : "blur(3px)",
			}}
			inert={!present}
			initial={{
				opacity: 0,
				transform: reducedMotion ? "none" : "translateY(6px)",
				filter: reducedMotion ? "none" : "blur(3px)",
			}}
			transition={{
				duration: reducedMotion ? 0 : 0.18,
				ease: [0.23, 1, 0.32, 1],
			}}
		>
			{children}
		</motion.div>
	);
}

function renderBookmarkTrigger({
	status,
	multiple,
	count,
	hasMore,
	onJump,
}: {
	status: ReturnType<typeof resolveWakeProgressStatus>;
	multiple: boolean;
	count: number;
	hasMore: boolean;
	onJump: () => void;
}) {
	return (
		<Button
			aria-label={
				status
					? `${status.label}. ${multiple ? "Show active Wakes" : "View working agent"}`
					: "Active Wakes"
			}
			className="w-full min-w-0 max-w-56 gap-2 text-muted-foreground transition-colors"
			onClick={multiple ? undefined : onJump}
			size="sm"
			type="button"
			variant="ghost"
		>
			{status ? (
				<SpaceAgentOrb state={WAKE_STATUS_ORB_STATE[status.kind]} />
			) : null}
			<WakeBookmarkText
				textKey={`${status?.label}:${multiple}:${count}:${hasMore}`}
			>
				<span className="min-w-0 truncate text-xs">
					{status?.label ?? "Active Wakes"}
				</span>
				{multiple ? (
					<>
						<span className="text-xs tabular-nums">
							{count}
							{hasMore ? "+" : ""}
						</span>
						<CaretUpIcon className="size-3" />
					</>
				) : null}
			</WakeBookmarkText>
		</Button>
	);
}

function WakeBookmarkText({
	textKey,
	children,
}: {
	textKey: string;
	children: ReactNode;
}) {
	return (
		<span aria-hidden className="relative block min-w-0 overflow-hidden">
			<AnimatePresence initial={false}>
				<WakeBookmarkTextFrame key={textKey}>{children}</WakeBookmarkTextFrame>
			</AnimatePresence>
		</span>
	);
}

function WakeBookmarkTextFrame({ children }: { children: ReactNode }) {
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

function WakeBookmarkRow(input: {
	item: WakeProgressItem;
	nowMs: number;
	current: WakeProgressItem | undefined;
	onClick: () => void;
}) {
	const step = input.current
		? resolveBookmarkStatus(input.current, input.nowMs)
		: null;
	return (
		<button
			className="flex items-start gap-2 rounded-md p-2 text-left hover:bg-accent focus-visible:bg-accent disabled:text-muted-foreground"
			disabled={!input.current}
			onClick={input.onClick}
			type="button"
		>
			{step ? <SpaceAgentOrb state={WAKE_STATUS_ORB_STATE[step.kind]} /> : null}
			<span className="min-w-0">
				<span className="block text-xs">
					{step?.label ?? `${input.item.targetLabel} · No longer active`}
				</span>
				<span className="mt-1 block truncate text-muted-foreground text-xs">
					{input.item.sourceContext?.messagePreview ?? "View request"}
				</span>
				{input.item.sourceContext?.threadId ? (
					<span className="text-muted-foreground text-xs">Thread</span>
				) : null}
			</span>
		</button>
	);
}

function resolveBookmarkStatus(item: WakeProgressItem, nowMs: number) {
	const step = resolveWakeProgressStatus(item);
	const [entry] = resolveWakeProgressThinkingEntry({
		item,
		showElapsedTime: true,
	});
	if (
		step &&
		entry?.kind === "progress" &&
		entry?.elapsedStartedAtMs != null &&
		isSpaceWakeProgressWaitingForFinalStatus({
			lastEvidenceAtMs: entry.lastEvidenceAtMs,
			nowMs,
		})
	) {
		return { ...step, label: `${item.targetLabel} · Waiting for final status` };
	}
	return step;
}
