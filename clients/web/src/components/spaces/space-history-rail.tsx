import {
	Popover,
	PopoverContent,
	PopoverTitle,
} from "@openmeld/ui/components/popover";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { resolveSpaceConversationPosition } from "./use-space-conversation-position";
import type { SpaceHistoryNavigationController } from "./use-space-history-navigation";

export type SpaceHistoryActions = {
	onBack?: () => void;
	reserveLatest: () => SpaceHistoryLatestReservation;
	latestHref?: string;
	isHistorical: boolean;
	pending: boolean;
};

export type SpaceHistoryLatestReservation = {
	isCurrent: () => boolean;
	navigate: () => Promise<boolean>;
};

type Position = { signalId: string; offset: number };
const historyDate = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	year: "numeric",
});
const date = (ts: number) => historyDate.format(ts);

export function SpaceHistoryRail(input: {
	controller: SpaceHistoryNavigationController;
	visible: boolean;
	renderNavigation: (actions: SpaceHistoryActions) => ReactNode;
	scrollElement: HTMLDivElement | null;
	items: readonly SpaceTimelineItem[];
	onJumpToMessage: (
		id: string,
		options?: { offsetFromVisibleTop?: number }
	) => void;
	onFollowLatest: () => void;
	onNavigateStart: () => void;
}) {
	const navRef = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const rail = navRef.current;
		const frame = rail?.parentElement;
		if (!(rail && frame && input.visible)) {
			return;
		}
		const position = () => {
			const bounds = frame.getBoundingClientRect();
			const windowBounds = rail
				.closest('[data-slot="app-main-content"]')
				?.getBoundingClientRect();
			const windowCenter = windowBounds
				? windowBounds.top + windowBounds.height / 2
				: window.innerHeight / 2;
			const halfHeight = rail.offsetHeight / 2;
			// The Space window stays put when its reading header changes height.
			rail.style.top = `${Math.max(halfHeight, Math.min(bounds.height - halfHeight, windowCenter - bounds.top))}px`;
		};
		const observer = new ResizeObserver(position);
		observer.observe(frame);
		observer.observe(rail);
		window.addEventListener("resize", position);
		position();
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", position);
		};
	}, [input.visible]);
	const buttons = useRef(new Map<number, HTMLElement>());
	const [activeSignalId, setActiveSignalId] = useState<string | null>(null);
	const previewRef = useRef<HTMLDivElement | null>(null);
	const pointerIndex = useRef<number | null>(null);
	const railBounds = useRef<DOMRect | null>(null);
	const hoverFrame = useRef(0);
	const previewHeight = useRef(200);
	const [open, setOpen] = useState(false);
	const [previous, setPrevious] = useState<Position | null>(null);
	const [target, setTarget] = useState<Position | null>(null);
	const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const jumpSequence = useRef(0);
	const latestState = useRef({
		controller: input.controller,
		scrollElement: input.scrollElement,
	});
	latestState.current = {
		controller: input.controller,
		scrollElement: input.scrollElement,
	};
	const entries = input.controller.directory?.entries ?? [];
	const selectedIndex = activeSignalId
		? entries.findIndex((entry) => entry.signalId === activeSignalId)
		: -1;
	const activeIndex = selectedIndex < 0 ? null : selectedIndex;
	const HistoryTarget = input.controller.hrefForSignalId ? "a" : "button";
	const selected =
		activeSignalId && selectedIndex < 0 ? undefined : entries[activeIndex ?? 0];
	const closePreview = () => {
		if (openTimer.current) {
			clearTimeout(openTimer.current);
		}
		if (closeTimer.current) {
			clearTimeout(closeTimer.current);
		}
		openTimer.current = null;
		closeTimer.current = null;
		cancelAnimationFrame(hoverFrame.current);
		pointerIndex.current = null;
		paint(null);
		setOpen(false);
	};
	// Coalesce pointer motion into one frame and update text only when the
	// selected entry changes. Excerpts are already available in the directory.
	const paint = (position: number | null) => {
		for (const [index, button] of buttons.current) {
			const dash = button.firstElementChild as HTMLElement | null;
			if (!dash) {
				continue;
			}
			const scale =
				position === null
					? 0.25
					: Math.max(0.25, 1 - Math.abs(index - position) * 0.18);
			const transform = `scaleX(${scale})`;
			if (dash.style.transform !== transform) {
				dash.style.transform = transform;
			}
			const hovered = position !== null && index === Math.round(position);
			if (button.hasAttribute("data-hovered") !== hovered) {
				button.toggleAttribute("data-hovered", hovered);
			}
		}
		const bounds = railBounds.current;
		if (previewRef.current && bounds && position !== null) {
			const center = bounds.top + bounds.height / 2;
			const half = previewHeight.current / 2;
			const desired =
				bounds.top + ((position + 0.5) / entries.length) * bounds.height;
			const y = Math.max(
				half + 12,
				Math.min(window.innerHeight - half - 12, desired)
			);
			previewRef.current.style.translate = `0 ${y - center}px`;
		}
	};
	const selectPreview = (index: number | null) => {
		pointerIndex.current = index;
		setActiveSignalId(
			index === null ? null : (entries[index]?.signalId ?? null)
		);
		paint(index);
	};
	const movePointer = (clientY: number) => {
		const bounds = railBounds.current;
		if (!(bounds && entries.length)) {
			return;
		}
		const position = Math.max(
			0,
			Math.min(
				entries.length - 1,
				((clientY - bounds.top) / bounds.height) * entries.length - 0.5
			)
		);
		cancelAnimationFrame(hoverFrame.current);
		hoverFrame.current = requestAnimationFrame(() => {
			const index = Math.round(position);
			if (pointerIndex.current !== index) {
				pointerIndex.current = index;
				setActiveSignalId(entries[index]?.signalId ?? null);
			}
			paint(position);
		});
	};
	useEffect(
		() => () => {
			cancelAnimationFrame(hoverFrame.current);
			if (openTimer.current) {
				clearTimeout(openTimer.current);
			}
			if (closeTimer.current) {
				clearTimeout(closeTimer.current);
			}
			jumpSequence.current += 1;
		},
		[]
	);
	useLayoutEffect(() => {
		if (!(target && input.items.some((item) => item.id === target.signalId))) {
			return;
		}
		// The conversation owns placement, so a target it still has to mount
		// keeps the requested offset too.
		input.onJumpToMessage(target.signalId, {
			offsetFromVisibleTop: target.offset,
		});
		setTarget(null);
	}, [target, input.items, input.onJumpToMessage]);
	const jump = async (signalId: string, restore?: Position) => {
		const sequence = ++jumpSequence.current;
		const prior = readPosition(input.scrollElement);
		input.onNavigateStart();
		closePreview();
		// Retain the reading target while Query retries, including after a visible error.
		setPrevious(restore ? null : prior);
		setTarget(restore ?? { signalId, offset: 24 });
		await input.controller.open(signalId, undefined, (loaded) => {
			if (sequence === jumpSequence.current && loaded === "latest") {
				setTarget(null);
				input.onFollowLatest();
			}
		});
	};
	const keepOpen = () => {
		if (closeTimer.current) {
			clearTimeout(closeTimer.current);
		}
	};
	const scheduleOpen = () => {
		keepOpen();
		if (open || openTimer.current) {
			return;
		}
		openTimer.current = setTimeout(() => {
			setOpen(true);
			openTimer.current = null;
		}, 120);
	};
	const scheduleClose = () => {
		cancelAnimationFrame(hoverFrame.current);
		paint(null);
		pointerIndex.current = null;
		if (openTimer.current) {
			clearTimeout(openTimer.current);
			openTimer.current = null;
		}
		closeTimer.current = setTimeout(() => {
			closePreview();
			setActiveSignalId(null);
		}, 180);
	};
	const reserveLatest = (): SpaceHistoryLatestReservation => {
		const sequence = ++jumpSequence.current;
		setTarget(null);
		const isCurrent = () => sequence === jumpSequence.current;
		const previousPosition = readPosition(input.scrollElement);
		return {
			isCurrent,
			navigate: async () => {
				if (!isCurrent()) {
					return false;
				}
				setPrevious(previousPosition);
				closePreview();
				input.controller.latest();
				input.onFollowLatest();
				await new Promise<void>((resolve) => {
					requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
				});
				const current = latestState.current;
				if (
					!isCurrent() ||
					current.controller.activeWindow ||
					current.controller.pending ||
					!current.scrollElement
				) {
					return false;
				}
				return isCurrent();
			},
		};
	};

	return (
		<>
			<Popover
				onOpenChange={(value) => (value ? setOpen(true) : closePreview())}
				open={input.visible && open && !!selected}
			>
				{/* biome-ignore lint/a11y/noNoninteractiveElementInteractions: Toolbar tracks proximity; its buttons provide keyboard and click interaction. */}
				<div
					aria-label="Browse Space history"
					aria-orientation="vertical"
					className="space-history-navigation"
					hidden={!input.visible}
					onMouseEnter={(event) => {
						railBounds.current = event.currentTarget.getBoundingClientRect();
						movePointer(event.clientY);
						scheduleOpen();
					}}
					onMouseLeave={scheduleClose}
					onMouseMove={(event) => {
						movePointer(event.clientY);
						scheduleOpen();
					}}
					ref={navRef}
					role="toolbar"
					style={{ height: Math.min(entries.length * 10, 288) }}
				>
					{input.controller.directoryPending && (
						<span className="text-muted-foreground text-xs">…</span>
					)}
					{input.controller.directoryError && (
						<button
							className="text-muted-foreground text-xs"
							onClick={() => input.controller.retryDirectory()}
							type="button"
						>
							Retry history
						</button>
					)}
					<div className="space-history-ticks">
						{entries.map((entry, index) => (
							<HistoryTarget
								aria-label={`${date(entry.startAt)}: ${entry.preview}`}
								className="space-history-tick"
								href={input.controller.hrefForSignalId?.(entry.signalId)}
								key={entry.signalId}
								onClick={(event) => {
									event.preventDefault();
									jump(entry.signalId);
								}}
								onFocus={() => {
									railBounds.current =
										navRef.current?.getBoundingClientRect() ?? null;
									selectPreview(index);
									setOpen(true);
								}}
								onKeyDown={(event) => {
									if (event.key === "ArrowDown" || event.key === "ArrowUp") {
										event.preventDefault();
										buttons.current
											.get(
												Math.max(
													0,
													Math.min(
														entries.length - 1,
														index + (event.key === "ArrowDown" ? 1 : -1)
													)
												)
											)
											?.focus();
									}
									if (event.key === "Escape") {
										closePreview();
									}
								}}
								ref={(node: HTMLElement | null) => {
									if (node) {
										buttons.current.set(index, node);
									} else {
										buttons.current.delete(index);
									}
								}}
								tabIndex={index === (activeIndex ?? 0) ? 0 : -1}
								type={HistoryTarget === "button" ? "button" : undefined}
							>
								<span className="space-history-dash" />
							</HistoryTarget>
						))}
					</div>
				</div>
				<PopoverContent
					align="center"
					anchor={navRef}
					className="space-history-preview w-80 gap-2 rounded-xl p-4 text-sm leading-relaxed motion-reduce:animate-none"
					finalFocus={false}
					initialFocus={false}
					onMouseEnter={keepOpen}
					onMouseLeave={scheduleClose}
					ref={(node) => {
						previewRef.current = node;
						if (node) {
							previewHeight.current = node.offsetHeight;
							paint(pointerIndex.current);
						}
					}}
					side="right"
					sideOffset={8}
				>
					{selected && (
						<div className="space-history-preview-content flex flex-col gap-2">
							<button
								className="flex cursor-pointer flex-col gap-2 text-left outline-offset-4"
								onClick={() => jump(selected.signalId)}
								type="button"
							>
								<span className="text-muted-foreground text-xs">
									{date(selected.startAt)}
									{selected.count > 1
										? ` – ${date(selected.endAt)} · ${selected.count} messages`
										: ` · ${selected.author}`}
								</span>
								<PopoverTitle
									className="line-clamp-3 font-medium text-sm"
									render={<span />}
								>
									{selected.preview}
								</PopoverTitle>
								{selected.count > 1 && (
									<span className="text-muted-foreground text-xs">
										Excerpt from {selected.author}
									</span>
								)}
							</button>
						</div>
					)}
				</PopoverContent>
			</Popover>
			{input.renderNavigation({
				onBack: previous
					? () => {
							jump(previous.signalId, previous);
						}
					: undefined,
				reserveLatest,
				latestHref: input.controller.latestHref,
				isHistorical: !!input.controller.activeWindow,
				pending: input.controller.pending,
			})}
			<div aria-live="polite" className="sr-only">
				{input.controller.pending ? "Loading messages…" : ""}
			</div>
		</>
	);
}

function readPosition(viewport: HTMLDivElement | null): Position | null {
	const position = viewport && resolveSpaceConversationPosition(viewport);
	return position
		? {
				signalId: position.anchorSignalId,
				offset: position.offsetFromVisibleTop,
			}
		: null;
}
