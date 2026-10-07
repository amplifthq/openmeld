import {
	closestCenter,
	DndContext,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
	SpaceInputQueueMutation,
	SpaceInputQueueResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuGroup,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { springs } from "@openmeld/ui/lib/springs";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowBendUpRightIcon,
	ArrowDownIcon,
	ArrowUpIcon,
	DotsSixVerticalIcon,
	DotsThreeIcon,
	PencilSimpleIcon,
	TrashIcon,
} from "@phosphor-icons/react";
import {
	AnimatePresence,
	motion,
	useIsPresent,
	useReducedMotion,
} from "motion/react";
import { type Ref, useLayoutEffect, useRef, useState } from "react";
import { SpaceComposerTray } from "./space-composer-tray";
import { useSpaceInputQueue } from "./use-space-input-queue";

type Item = SpaceInputQueueResponse["items"][number];
const MotionTray = motion.create(SpaceComposerTray);
const rowTransition = { ...springs.slow, bounce: 0 };

export function SpaceInputQueue(input: {
	spaceId: string;
	profileId: string;
	onEdit: (text: string) => void;
}) {
	const queue = useSpaceInputQueue({ ...input, enabled: true });
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [editRecovery, setEditRecovery] = useState<Item | null>(null);
	const [announcement, setAnnouncement] = useState("");
	const [keyboardReorder, setKeyboardReorder] = useState(false);
	const reduceMotion = useReducedMotion();
	const onEdit = useRef(input.onEdit);
	useLayoutEffect(() => {
		onEdit.current = input.onEdit;
	}, [input.onEdit]);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);
	const pendingIds = queue.items
		.filter((item) => item.state === "queued")
		.map((item) => item.inputId);
	async function mutate(mutation: SpaceInputQueueMutation, editing?: Item) {
		setSaving(true);
		setError(null);
		try {
			await queue.mutate(mutation);
			if (editing) {
				onEdit.current(editing.text);
				setEditRecovery(null);
				setAnnouncement("Message moved to the composer for editing.");
			} else if (mutation.action === "delete") {
				setAnnouncement("Queued message deleted.");
			}
		} catch (cause) {
			// Retain the text after a lost response. Retrying confirms the
			// idempotent deletion before the draft can be submitted again.
			if (editing) {
				setEditRecovery(editing);
			}
			setError(
				cause instanceof Error
					? cause.message
					: "Couldn't update queued messages. Try again."
			);
		} finally {
			setSaving(false);
		}
	}
	function move(inputId: string, to: number) {
		const from = pendingIds.indexOf(inputId);
		if (
			from < 0 ||
			to < 0 ||
			to >= pendingIds.length ||
			from === to ||
			saving
		) {
			return;
		}
		return mutate({
			action: "reorder",
			expectedIds: pendingIds,
			orderedIds: arrayMove(pendingIds, from, to),
		});
	}
	return (
		<>
			<span aria-live="polite" className="sr-only">
				{announcement}
			</span>
			<AnimatePresence initial={false}>
				{queue.items.length || queue.error || error ? (
					<MotionTray
						animate={{ opacity: 1 }}
						aria-label="Queued messages"
						className="pt-1"
						data-slot="space-input-queue"
						exit={{ opacity: 0, transition: { duration: 0.12 } }}
						initial={{ opacity: 0 }}
						key="queue"
						layout={reduceMotion || keyboardReorder ? false : "position"}
						transition={rowTransition}
					>
						<p className="sr-only">
							Queued messages are sent in this order after the current response.
						</p>
						<DndContext
							collisionDetection={closestCenter}
							onDragCancel={() => setKeyboardReorder(false)}
							onDragEnd={async ({ active, over }) => {
								if (over) {
									await move(
										String(active.id),
										pendingIds.indexOf(String(over.id))
									);
								}
								setKeyboardReorder(false);
							}}
							onDragStart={({ activatorEvent }) =>
								setKeyboardReorder(activatorEvent instanceof KeyboardEvent)
							}
							sensors={sensors}
						>
							<SortableContext
								items={pendingIds}
								strategy={verticalListSortingStrategy}
							>
								<div className="relative max-h-60 overflow-y-auto overscroll-contain px-1.5 pb-1">
									<AnimatePresence initial={false} mode="popLayout" propagate>
										{queue.items.map((item) => (
											<QueuedMessage
												index={pendingIds.indexOf(item.inputId)}
												item={item}
												key={item.inputId}
												keyboardReorder={keyboardReorder}
												move={move}
												mutate={mutate}
												pendingCount={pendingIds.length}
												saving={saving}
											/>
										))}
									</AnimatePresence>
								</div>
							</SortableContext>
						</DndContext>
						{error || queue.error ? (
							<div className="px-3 py-2 text-xs">
								<p className="text-destructive" role="alert">
									{error ?? "Couldn't load queued messages. Try refreshing."}
								</p>
								{editRecovery ? (
									<Button
										disabled={saving}
										onClick={() =>
											mutate(
												{ action: "delete", inputId: editRecovery.inputId },
												editRecovery
											)
										}
										size="sm"
										variant="ghost"
									>
										Retry edit
									</Button>
								) : null}
							</div>
						) : null}
					</MotionTray>
				) : null}
			</AnimatePresence>
		</>
	);
}

function queuedMessageStatus(item: Item): string | null {
	if (item.state === "claimed") {
		return "Confirming delivery…";
	}
	if (item.state === "unconfirmed") {
		return "Delivery isn't confirmed. This message and later messages are paused.";
	}
	return item.blocked
		? "Still queued. Edit and send it to start a new response."
		: null;
}

function QueuedMessage({
	item,
	saving,
	mutate,
	move,
	index,
	pendingCount,
	keyboardReorder,
	ref,
}: {
	item: Item;
	saving: boolean;
	mutate: (mutation: SpaceInputQueueMutation, editing?: Item) => Promise<void>;
	move: (inputId: string, to: number) => Promise<void> | undefined;
	index: number;
	pendingCount: number;
	keyboardReorder: boolean;
	ref?: Ref<HTMLDivElement>;
}) {
	const prefersReducedMotion = useReducedMotion();
	const reduceMotion = prefersReducedMotion || keyboardReorder;
	const isPresent = useIsPresent();
	const [expanded, setExpanded] = useState(false);
	const pending = item.state === "queued";
	const disabled = !pending || saving || !isPresent;
	const sortable = useSortable({
		id: item.inputId,
		disabled,
		transition: reduceMotion
			? null
			: { duration: 160, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
	});
	const status = queuedMessageStatus(item);
	return (
		<motion.div
			animate={{ opacity: 1, transform: "translateY(0px) scale(1)" }}
			className="relative"
			data-queue-input-id={item.inputId}
			exit={{
				opacity: 0,
				transform: reduceMotion ? "none" : "translateY(12px) scale(0.98)",
			}}
			initial={{
				opacity: 0,
				transform: reduceMotion ? "none" : "translateY(16px) scale(0.98)",
			}}
			layout={reduceMotion || sortable.isDragging ? false : "position"}
			ref={ref}
			style={{ zIndex: sortable.isDragging ? 2 : Number(isPresent) }}
			transition={rowTransition}
		>
			<div
				className={cn(
					"group/queued flex min-h-8 items-start gap-1 rounded-lg bg-card px-0.5 py-0.5",
					expanded && "max-sm:grid max-sm:grid-cols-[28px_minmax(0,1fr)]",
					sortable.isDragging && "shadow-surface-2"
				)}
				ref={sortable.setNodeRef}
				style={{
					transform: CSS.Transform.toString(sortable.transform),
					transition: sortable.transition,
				}}
			>
				<Button
					aria-label="Reorder queued message"
					className="cursor-grab touch-none text-muted-foreground transition-colors active:cursor-grabbing"
					disabled={disabled}
					ref={sortable.setActivatorNodeRef}
					size="icon-sm"
					variant="ghost"
					{...sortable.attributes}
					{...sortable.listeners}
				>
					<DotsSixVerticalIcon size={14} />
				</Button>
				<div
					className={cn(
						"min-w-0 flex-1 py-1",
						expanded && "max-sm:col-span-2 max-sm:row-start-2 max-sm:px-2"
					)}
				>
					<button
						aria-expanded={expanded}
						aria-label={
							expanded ? "Collapse queued message" : "Expand queued message"
						}
						className="block w-full rounded-sm text-left text-[13px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-ring"
						onClick={() => setExpanded(!expanded)}
						type="button"
					>
						<span
							className={cn(
								"block",
								expanded ? "whitespace-pre-wrap break-words" : "truncate"
							)}
						>
							{item.text}
						</span>
					</button>
					{status ? (
						<output className="block text-muted-foreground text-xs">
							{status}
						</output>
					) : null}
				</div>
				<div
					className={cn(
						"flex shrink-0 items-center text-muted-foreground",
						expanded && "max-sm:justify-self-end"
					)}
				>
					<TooltipHint content="Send this message while the agent is working">
						<Button
							className="gap-1 px-1.5 transition-colors"
							disabled={disabled || item.blocked}
							onClick={() =>
								mutate({
									action: "steer",
									inputId: item.inputId,
									target: item.target,
								})
							}
							size="sm"
							variant="ghost"
						>
							<ArrowBendUpRightIcon size={14} />
							Send now
						</Button>
					</TooltipHint>
					<Button
						aria-label="Delete queued message"
						className="transition-colors"
						disabled={disabled}
						onClick={() => mutate({ action: "delete", inputId: item.inputId })}
						size="icon-sm"
						variant="ghost"
					>
						<TrashIcon size={14} />
					</Button>
					<DropdownMenu>
						<DropdownMenuTrigger
							render={
								<Button
									aria-label="Queued message options"
									className="transition-colors"
									disabled={disabled}
									size="icon-sm"
									variant="ghost"
								>
									<DotsThreeIcon size={16} />
								</Button>
							}
						/>
						<FluidDropdownMenuContent align="end">
							<FluidDropdownMenuGroup>
								<FluidDropdownMenuItem
									disabled={disabled}
									index={0}
									onClick={() =>
										mutate({ action: "delete", inputId: item.inputId }, item)
									}
								>
									<PencilSimpleIcon />
									Edit message
								</FluidDropdownMenuItem>
							</FluidDropdownMenuGroup>
							<DropdownMenuSeparator />
							<FluidDropdownMenuGroup>
								<FluidDropdownMenuItem
									disabled={disabled || index <= 0}
									index={0}
									onClick={() => move(item.inputId, index - 1)}
								>
									<ArrowUpIcon />
									Move up
								</FluidDropdownMenuItem>
								<FluidDropdownMenuItem
									disabled={disabled || index >= pendingCount - 1}
									index={1}
									onClick={() => move(item.inputId, index + 1)}
								>
									<ArrowDownIcon />
									Move down
								</FluidDropdownMenuItem>
							</FluidDropdownMenuGroup>
						</FluidDropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>
		</motion.div>
	);
}
