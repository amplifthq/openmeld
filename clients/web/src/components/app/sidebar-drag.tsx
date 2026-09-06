import {
	DndContext,
	DragOverlay,
	KeyboardSensor,
	MouseSensor,
	rectIntersection,
	TouchSensor,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
import { type ReactNode, useMemo, useState } from "react";

export function SidebarDrag(input: {
	children: ReactNode;
	onMove: (section: string, itemId: string, beforeId?: string) => void;
	canDrop?: (itemId: string, section: string) => boolean;
}) {
	const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 180, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
			keyboardCodes: {
				start: ["Space"],
				cancel: ["Escape"],
				end: ["Space", "Enter"],
			},
		})
	);
	const [label, setLabel] = useState<string | null>(null);
	return (
		<DndContext
			accessibility={{
				announcements: {
					onDragStart: ({ active }) =>
						`Picked up ${active.data.current?.name ?? "Space"}. Use the arrow keys to move, Space to drop, or Escape to cancel.`,
					onDragOver: ({ active, over }) =>
						over
							? `${active.data.current?.name ?? "Space"}, over ${over.data.current?.name ?? "section"}.`
							: "Outside a drop area.",
					onDragEnd: ({ active, over }) =>
						over
							? `Dropped ${active.data.current?.name ?? "Space"}.`
							: "Move canceled.",
					onDragCancel: () => "Move canceled.",
				},
			}}
			collisionDetection={(args) =>
				rectIntersection({
					...args,
					droppableContainers: args.droppableContainers.filter(
						(container) =>
							input.canDrop?.(
								args.active.data.current?.itemId,
								container.data.current?.section
							) ?? true
					),
				})
			}
			onDragCancel={() => setLabel(null)}
			onDragEnd={({ active, over }) => {
				setLabel(null);
				if (!over || active.id === over.id) {
					return;
				}
				const source = active.data.current;
				const target = over.data.current;
				if (
					!(source && target) ||
					input.canDrop?.(source.itemId, target.section) === false
				) {
					return;
				}
				input.onMove(target.section, source.itemId, target.itemId);
			}}
			onDragStart={({ active }) =>
				setLabel(active.data.current?.name ?? "Space")
			}
			sensors={sensors}
		>
			{input.children}
			<DragOverlay
				dropAnimation={null}
				transition={reduced ? "none" : undefined}
			>
				{label ? (
					<div className="truncate rounded-md bg-sidebar-accent px-3 py-2 text-sidebar-accent-foreground text-sm shadow-sm">
						{label}
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	);
}

export function SidebarDropSection(input: {
	section: string;
	ids: readonly string[];
	children: ReactNode;
}) {
	const { setNodeRef, isOver } = useDroppable({
		id: `section:${input.section}`,
		disabled: input.ids.length > 0,
		data: { section: input.section },
	});
	return (
		<div
			className={
				isOver ? "min-h-9 rounded-md ring-1 ring-sidebar-ring/40" : "min-h-9"
			}
			ref={setNodeRef}
		>
			<SortableContext
				items={input.ids.map((id) => `${input.section}:${id}`)}
				strategy={verticalListSortingStrategy}
			>
				{input.children}
			</SortableContext>
		</div>
	);
}

export function useSortableSidebarItem(input: {
	section: string;
	itemId: string;
	name: string;
	disabled: boolean;
}) {
	const { section } = input;
	const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
	const {
		setNodeRef,
		attributes,
		listeners,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: `${section}:${input.itemId}`,
		disabled: input.disabled,
		data: { section, itemId: input.itemId, name: input.name },
	});
	const transformStyle = CSS.Transform.toString(transform);
	const description = attributes["aria-describedby"];
	return useMemo(
		() => ({
			ref: setNodeRef,
			style: {
				transform: transformStyle,
				transition: reduced ? "none" : transition,
				opacity: isDragging ? 0.3 : 1,
			},
			rowProps: {
				...listeners,
				"aria-describedby": description,
				"aria-roledescription": "sortable item",
			},
		}),
		[
			setNodeRef,
			transformStyle,
			reduced,
			transition,
			isDragging,
			listeners,
			description,
		]
	);
}
