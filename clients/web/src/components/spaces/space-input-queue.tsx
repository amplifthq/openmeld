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
	WakeProgressItem,
} from "@openmeld/schemas/types";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@openmeld/ui/components/alert-dialog";
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
	ArrowClockwiseIcon,
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
import { useSpaceWorkRecovery } from "./use-space-work-recovery";

type Item = SpaceInputQueueResponse["items"][number];
type QueueProgress = Pick<
	WakeProgressItem,
	| "dispatchId"
	| "targetProfileId"
	| "targetLabel"
	| "terminal"
	| "phase"
	| "waitReasonCode"
	| "pendingInteraction"
>;
const MotionTray = motion.create(SpaceComposerTray);
const rowTransition = { ...springs.slow, bounce: 0 };

type QueueAgent = { profileId: string; profileName: string };

export function SpaceInputQueue(input: {
	/** Names the Agent once its response has ended and left the progress list. */
	agents?: readonly QueueAgent[];
	progressItems: readonly QueueProgress[];
	threadId?: string | null;
	spaceId: string;
	profileId: string;
	onEdit: (text: string) => void;
}) {
	const queue = useSpaceInputQueue({ ...input, enabled: true });
	const recovery = useSpaceWorkRecovery(
		input.spaceId,
		input.threadId ? [] : queue.recoveries
	);
	const items = queue.items.filter(
		(item) => (item.threadId ?? null) === (input.threadId ?? null)
	);
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
	const allPendingIds = queue.items
		.filter((item) => item.state === "queued")
		.map((item) => item.inputId);
	const pendingIds = items
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
			} else if (mutation.action === "retry") {
				setAnnouncement("Message is back in the queue.");
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
	async function sendNow(item: Item) {
		setSaving(true);
		setError(null);
		try {
			await queue.sendNow(item);
			setAnnouncement("Queued message sent.");
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Couldn't send this message now. It's still queued."
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
			expectedIds: allPendingIds,
			orderedIds: reorderVisibleSpaceQueue(allPendingIds, pendingIds, from, to),
		});
	}
	return (
		<>
			<span aria-live="polite" className="sr-only">
				{announcement}
			</span>
			<AnimatePresence initial={false}>
				{items.length || queue.error || error || recovery.visible ? (
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
						{recovery.content}
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
										{items.map((item, position) => (
											<QueuedMessage
												index={pendingIds.indexOf(item.inputId)}
												item={item}
												key={item.inputId}
												keyboardReorder={keyboardReorder}
												move={move}
												mutate={mutate}
												pendingCount={pendingIds.length}
												saving={saving}
												sendNow={sendNow}
												sendNowState={resolveSendNowState(
													item,
													input.progressItems,
													{
														agents: input.agents,
														paused: isPausedBehind(items, position),
													}
												)}
												status={queuedMessageStatus(item, input.progressItems, {
													agents: input.agents,
													paused: isPausedBehind(items, position),
												})}
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

/**
 * An input waits behind an earlier one for the same response whose delivery
 * is not settled; it moves once that one is delivered, retried or removed.
 */
export function isPausedBehind(
	items: readonly Pick<Item, "state" | "target">[],
	index: number
): boolean {
	const item = items[index];
	return Boolean(
		item &&
			item.state === "queued" &&
			items
				.slice(0, index)
				.some(
					(earlier) =>
						earlier.state !== "queued" &&
						earlier.target.dispatchId === item.target.dispatchId &&
						earlier.target.targetProfileId === item.target.targetProfileId
				)
	);
}

function queuedAgentName(
	item: Pick<Item, "target">,
	progressItems: readonly QueueProgress[],
	agents: readonly QueueAgent[] = []
): string {
	const progress = progressItems.find(
		(candidate) =>
			candidate.dispatchId === item.target.dispatchId &&
			candidate.targetProfileId === item.target.targetProfileId
	);
	return (
		progress?.targetLabel.replace(LEADING_MENTION, "") ||
		agents.find((agent) => agent.profileId === item.target.targetProfileId)
			?.profileName ||
		"the agent"
	);
}

/** The line under a queued message: its real delivery state, if not plain queued. */
export function queuedMessageStatus(
	item: Pick<Item, "blocked" | "delivery" | "state" | "target">,
	progressItems: readonly QueueProgress[],
	options: { agents?: readonly QueueAgent[]; paused?: boolean } = {}
): string | null {
	const name = queuedAgentName(item, progressItems, options.agents);
	if (item.state === "claimed") {
		return "Confirming delivery…";
	}
	if (item.state === "unconfirmed") {
		return item.delivery === "undecided"
			? `Couldn't confirm that ${name} received this. Retry it or remove it; later messages wait until you do.`
			: `Checking whether ${name} received this…`;
	}
	if (options.paused) {
		return "Waiting for the message above.";
	}
	return item.blocked
		? "Still queued. Edit and send it to start a new response."
		: null;
}

type SendNowState = { available: boolean; hint: string };
const LEADING_MENTION = /^@/;

/** Says whether "Send now" can reach the response, and why not when it can't. */
export function resolveSendNowState(
	item: Pick<Item, "blocked" | "target"> &
		Partial<Pick<Item, "delivery" | "state">>,
	progressItems: readonly QueueProgress[],
	options: { agents?: readonly QueueAgent[]; paused?: boolean } = {}
): SendNowState {
	const progress = progressItems.find(
		(candidate) =>
			candidate.dispatchId === item.target.dispatchId &&
			candidate.targetProfileId === item.target.targetProfileId
	);
	const name = queuedAgentName(item, progressItems, options.agents);
	if (item.state === "claimed" || item.state === "unconfirmed") {
		return {
			available: false,
			hint:
				item.delivery === "undecided"
					? "Retry or remove this message first."
					: `Checking whether ${name} received this…`,
		};
	}
	if (options.paused) {
		return {
			available: false,
			hint: "Sent after the message above is delivered, retried, or removed.",
		};
	}
	if (item.blocked || !progress || progress.terminal) {
		return {
			available: false,
			hint: "This response has ended. The message is sent when the next one starts.",
		};
	}
	if (progress.pendingInteraction) {
		return {
			available: false,
			hint: `${name} is waiting for your input. Answer it first, then send this message.`,
		};
	}
	if (
		progress.waitReasonCode ||
		(progress.phase !== "running" && progress.phase !== "writing")
	) {
		return {
			available: false,
			hint: `Available when ${name} is working again.`,
		};
	}
	return {
		available: true,
		hint: `Send this message to ${name} while it works`,
	};
}

function QueuedMessage({
	sendNowState,
	status,
	sendNow,
	item,
	saving,
	mutate,
	move,
	index,
	pendingCount,
	keyboardReorder,
	ref,
}: {
	sendNowState: SendNowState;
	status: string | null;
	sendNow: (item: Item) => Promise<void>;
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
	const undecided =
		item.state === "unconfirmed" && item.delivery === "undecided";
	const disabled = !pending || saving || !isPresent;
	const [confirmRemove, setConfirmRemove] = useState(false);
	const sortable = useSortable({
		id: item.inputId,
		disabled,
		transition: reduceMotion
			? null
			: { duration: 160, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
	});
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
								// Both states collapse runs of spaces the same way, so
								// expanding never moves the first line sideways.
								expanded ? "whitespace-pre-line break-words" : "truncate"
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
					{undecided ? (
						<UndecidedQueuedMessageActions
							confirmRemove={confirmRemove}
							item={item}
							mutate={mutate}
							onConfirmRemoveChange={setConfirmRemove}
							saving={saving || !isPresent}
						/>
					) : (
						<PendingQueuedMessageActions
							disabled={disabled}
							index={index}
							item={item}
							move={move}
							mutate={mutate}
							pendingCount={pendingCount}
							sendNow={sendNow}
							sendNowState={sendNowState}
						/>
					)}
				</div>
			</div>
		</motion.div>
	);
}

/** Send now, delete, edit and reorder for a message still in the queue. */
function PendingQueuedMessageActions({
	disabled,
	index,
	item,
	move,
	mutate,
	pendingCount,
	sendNow,
	sendNowState,
}: {
	disabled: boolean;
	index: number;
	item: Item;
	move: (inputId: string, to: number) => Promise<void> | undefined;
	mutate: (mutation: SpaceInputQueueMutation, editing?: Item) => Promise<void>;
	pendingCount: number;
	sendNow: (item: Item) => Promise<void>;
	sendNowState: SendNowState;
}) {
	return (
		<>
			{/* A disabled button gets no pointer events, so the wrapper owns
			the tooltip and stays focusable to explain why it is off. */}
			<TooltipHint content={sendNowState.hint}>
				<span
					className={cn(
						"inline-flex rounded-md outline-none focus-visible:ring-1 focus-visible:ring-ring",
						!sendNowState.available && "cursor-not-allowed"
					)}
					data-slot="queued-send-now"
					tabIndex={sendNowState.available ? undefined : 0}
				>
					<Button
						className="gap-1 px-1.5 text-foreground transition-colors disabled:text-muted-foreground"
						disabled={disabled || !sendNowState.available}
						onClick={() => sendNow(item)}
						size="sm"
						variant="ghost"
					>
						<ArrowBendUpRightIcon size={14} />
						Send now
					</Button>
				</span>
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
		</>
	);
}

/**
 * Core could not tell whether the Agent got this message. The author puts it
 * back in the queue or removes it; removing asks once, since the Agent may
 * have seen it.
 */
function UndecidedQueuedMessageActions(input: {
	item: Item;
	saving: boolean;
	confirmRemove: boolean;
	onConfirmRemoveChange: (open: boolean) => void;
	mutate: (mutation: SpaceInputQueueMutation) => Promise<void>;
}) {
	return (
		<>
			<Button
				className="gap-1 px-1.5 text-foreground"
				disabled={input.saving}
				onClick={() =>
					input.mutate({ action: "retry", inputId: input.item.inputId })
				}
				size="sm"
				variant="ghost"
			>
				<ArrowClockwiseIcon size={14} />
				Retry
			</Button>
			<Button
				aria-label="Remove from queue"
				disabled={input.saving}
				onClick={() => input.onConfirmRemoveChange(true)}
				size="icon-sm"
				variant="ghost"
			>
				<TrashIcon size={14} />
			</Button>
			<AlertDialog
				onOpenChange={input.onConfirmRemoveChange}
				open={input.confirmRemove}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Remove from queue?</AlertDialogTitle>
						<AlertDialogDescription>
							The agent may have already seen this message. Removing it only
							takes it out of the queue.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Keep</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => {
								input.onConfirmRemoveChange(false);
								input.mutate({ action: "delete", inputId: input.item.inputId });
							}}
						>
							Remove from queue
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

export function reorderVisibleSpaceQueue(
	allIds: readonly string[],
	visibleIds: readonly string[],
	from: number,
	to: number
): string[] {
	const reordered = arrayMove([...visibleIds], from, to);
	const visible = new Set(visibleIds);
	let index = 0;
	return allIds.map((id) =>
		visible.has(id) ? (reordered[index++] ?? id) : id
	);
}
