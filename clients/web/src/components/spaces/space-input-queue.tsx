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
import { Surface } from "@openmeld/ui/fluid/surface";
import { DotsSixVerticalIcon, XIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useSpaceInputQueue } from "./use-space-input-queue";

type Item = SpaceInputQueueResponse["items"][number];

export function SpaceInputQueue(input: { spaceId: string; profileId: string }) {
	const queue = useSpaceInputQueue({ ...input, enabled: true });
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const sensors = useSensors(
		useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
		useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
	);
	const pendingIds = queue.items
		.filter((item) => item.state === "queued")
		.map((item) => item.inputId);
	async function mutate(mutation: SpaceInputQueueMutation) {
		setSaving(true);
		setError(null);
		try {
			await queue.mutate(mutation);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Couldn't update queued messages."
			);
		} finally {
			setSaving(false);
		}
	}
	if (!(queue.items.length || queue.error)) {
		return null;
	}
	return (
		<section aria-label="Queued messages" className="space-y-1.5">
			<p className="text-muted-foreground text-xs">
				Queued · sent in this order after the current response
			</p>
			<DndContext
				collisionDetection={closestCenter}
				onDragEnd={({ active, over }) => {
					if (!over || active.id === over.id || saving) {
						return;
					}
					const from = pendingIds.indexOf(String(active.id));
					const to = pendingIds.indexOf(String(over.id));
					if (from < 0 || to < 0) {
						return;
					}
					return mutate({
						action: "reorder",
						expectedIds: pendingIds,
						orderedIds: arrayMove(pendingIds, from, to),
					});
				}}
				sensors={sensors}
			>
				<SortableContext
					items={pendingIds}
					strategy={verticalListSortingStrategy}
				>
					{queue.items.map((item) => (
						<QueuedMessage
							item={item}
							key={item.inputId}
							mutate={mutate}
							saving={saving}
						/>
					))}
				</SortableContext>
			</DndContext>
			{error || queue.error ? (
				<p className="text-destructive text-xs" role="alert">
					{error ?? "Couldn't load queued messages."}
				</p>
			) : null}
		</section>
	);
}

function QueuedMessage({
	item,
	saving,
	mutate,
}: {
	item: Item;
	saving: boolean;
	mutate: (mutation: SpaceInputQueueMutation) => Promise<void>;
}) {
	const pending = item.state === "queued";
	const sortable = useSortable({
		id: item.inputId,
		disabled: !pending || saving,
		transition: null,
	});
	let status: string | null = null;
	if (item.blocked) {
		status =
			"Still queued. The previous response ended or couldn't accept this message.";
	}
	if (item.state === "claimed") {
		status = "Confirming delivery…";
	}
	if (item.state === "unconfirmed") {
		status =
			"Delivery isn't confirmed. This message and later messages are paused.";
	}
	return (
		<div
			ref={sortable.setNodeRef}
			style={{
				transform: CSS.Transform.toString(sortable.transform),
				position: "relative",
				zIndex: sortable.isDragging ? 1 : undefined,
			}}
		>
			<Surface className="flex items-center gap-2 px-2 py-1.5">
				<Button
					aria-label="Reorder queued message"
					className="shrink-0 cursor-grab touch-none"
					disabled={!pending || saving}
					size="icon-sm"
					variant="ghost"
					{...sortable.attributes}
					{...sortable.listeners}
				>
					<DotsSixVerticalIcon size={16} />
				</Button>
				<div className="min-w-0 flex-1">
					<p className="line-clamp-2 whitespace-pre-wrap text-sm">
						{item.text}
					</p>
					{status ? (
						<output className="text-muted-foreground text-xs">{status}</output>
					) : null}
				</div>
				<Button
					disabled={!pending || item.blocked || saving}
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
					Steer
				</Button>
				<Button
					aria-label="Delete queued message"
					disabled={!pending || saving}
					onClick={() => mutate({ action: "delete", inputId: item.inputId })}
					size="icon-sm"
					variant="ghost"
				>
					<XIcon size={14} />
				</Button>
			</Surface>
		</div>
	);
}
