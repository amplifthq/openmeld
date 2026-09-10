import { Button } from "@openmeld/ui/components/button";
import {
	Popover,
	PopoverContent,
	PopoverTitle,
} from "@openmeld/ui/components/popover";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import {
	type ReactNode,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import {
	getSpaceConversationVisibleTop,
	resolveSpaceConversationPosition,
} from "./use-space-conversation-position";
import type { SpaceHistoryNavigationController } from "./use-space-history-navigation";

export type SpaceHistoryActions = {
	onBack?: () => void;
	onLatest: () => void;
	isHistorical: boolean;
	pending: boolean;
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
	onJumpToMessage: (id: string) => void;
	onFollowLatest: () => void;
	onNavigateStart: () => void;
}) {
	const navRef = useRef<HTMLDivElement>(null);
	const buttons = useRef(new Map<number, HTMLButtonElement>());
	const [activeIndex, setActiveIndex] = useState<number | null>(null);
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
	const entries = input.controller.directory?.entries ?? [];
	const selected = entries[activeIndex ?? 0];
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
		setActiveIndex(index);
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
				setActiveIndex(index);
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
		input.onJumpToMessage(target.signalId);
		const viewport = input.scrollElement;
		const element = viewport?.querySelector<HTMLElement>(
			`[data-signal-id="${CSS.escape(target.signalId)}"]`
		);
		if (viewport && element && Number.isFinite(target.offset)) {
			viewport.scrollTop +=
				element.getBoundingClientRect().top -
				getSpaceConversationVisibleTop(viewport) -
				target.offset;
		}
		setTarget(null);
	}, [target, input.items, input.scrollElement, input.onJumpToMessage]);
	const jump = async (signalId: string, restore?: Position) => {
		const sequence = ++jumpSequence.current;
		const prior = readPosition(input.scrollElement);
		input.onNavigateStart();
		closePreview();
		const loaded = await input.controller.open(signalId);
		if (!loaded || sequence !== jumpSequence.current) {
			return;
		}
		setPrevious(restore ? null : prior);
		setTarget(restore ?? { signalId, offset: 24 });
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
			setActiveIndex(null);
		}, 180);
	};
	const latest = () => {
		jumpSequence.current += 1;
		setPrevious(readPosition(input.scrollElement));
		closePreview();
		input.controller.latest();
		input.onFollowLatest();
		requestAnimationFrame(() =>
			requestAnimationFrame(() =>
				input.scrollElement?.scrollTo({
					top: input.scrollElement.scrollHeight,
					behavior: "instant",
				})
			)
		);
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
					<button
						aria-label="Browse history"
						className="space-history-touch-trigger"
						onClick={() => {
							selectPreview(activeIndex ?? 0);
							setOpen(true);
						}}
						type="button"
					>
						<ClockCounterClockwiseIcon size={18} />
					</button>
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
							<button
								aria-label={`${date(entry.startAt)}: ${entry.preview}`}
								key={entry.signalId}
								onClick={(event) => {
									if (
										window.matchMedia("(pointer: coarse)").matches &&
										event.detail !== 0
									) {
										selectPreview(index);
										setOpen(true);
									} else {
										jump(entry.signalId);
									}
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
								ref={(node) => {
									if (node) {
										buttons.current.set(index, node);
									} else {
										buttons.current.delete(index);
									}
								}}
								tabIndex={index === (activeIndex ?? 0) ? 0 : -1}
								type="button"
							>
								<span className="space-history-dash" />
							</button>
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
							<div className="space-history-preview-stepper flex gap-1">
								<Button
									disabled={(activeIndex ?? 0) === 0}
									onClick={() =>
										selectPreview(Math.max(0, (activeIndex ?? 0) - 1))
									}
									size="sm"
									variant="ghost"
								>
									Earlier
								</Button>
								<Button
									disabled={(activeIndex ?? 0) === entries.length - 1}
									onClick={() =>
										selectPreview(
											Math.min(entries.length - 1, (activeIndex ?? 0) + 1)
										)
									}
									size="sm"
									variant="ghost"
								>
									Later
								</Button>
							</div>
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
				onLatest: latest,
				isHistorical: !!input.controller.activeWindow,
				pending: input.controller.pending,
			})}
			<div aria-live="polite" className="sr-only">
				{input.controller.pending ? "Loading messages…" : ""}
			</div>
			{input.controller.error && (
				<div
					className="absolute inset-x-4 bottom-16 z-30 mx-auto w-fit rounded-lg bg-background px-3 py-2 text-destructive text-xs"
					role="alert"
				>
					Couldn’t load these messages. Select a position to try again.
				</div>
			)}
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
