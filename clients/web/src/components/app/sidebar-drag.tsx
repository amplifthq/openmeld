import {
	DndContext,
	DragOverlay,
	defaultDropAnimationSideEffects,
	KeyboardSensor,
	MouseSensor,
	TouchSensor,
	useDndContext,
	useDroppable,
	useSensor,
	useSensors,
} from "@dnd-kit/core";
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
} from "@dnd-kit/sortable";
import { useMediaQuery } from "@openmeld/ui/hooks/use-media-query";
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
import { createPortal } from "react-dom";
import {
	type SidebarDropTarget,
	sidebarCollisionDetection,
} from "./sidebar-drop-target";

const GroupDragContext = createContext<readonly string[]>([]);
const stationaryStrategy = () => null;
const nextFrame = () =>
	new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

export function SidebarDrag(input: {
	children: ReactNode;
	onMove: (
		section: string,
		itemId: string,
		beforeId?: string
	) => void | Promise<void>;
	canDrop?: (itemId: string, section: string) => boolean;
	groupIds?: readonly string[];
	onMoveGroup?: (id: string, beforeId?: string) => void;
}) {
	const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
	const surface = useRef<HTMLDivElement>(null);
	const settling = useRef<{ node: HTMLElement; top: number }[]>([]);
	// Apply the inverse transform in the ordering commit, before its first paint.
	useLayoutEffect(() => {
		const movements = settling.current.map(({ node, top }) => ({
			node,
			delta: top - node.getBoundingClientRect().top,
		}));
		if (!movements.some(({ delta }) => delta !== 0)) {
			return;
		}
		settling.current = [];
		for (const { node, delta } of movements) {
			if (!reduced && node.isConnected && delta !== 0) {
				node.animate(
					[
						{ transform: `translateY(${delta}px)` },
						{ transform: "translateY(0)" },
					],
					{ duration: 160, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
				);
			}
		}
	});
	const sensors = useSensors(
		useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
		useSensor(TouchSensor, {
			activationConstraint: { delay: 180, tolerance: 5 },
		}),
		useSensor(KeyboardSensor, {
			coordinateGetter: (event, args) =>
				sortableKeyboardCoordinates(event, {
					...args,
					context: {
						...args.context,
						droppableRects: new Map(
							[...args.context.droppableRects].filter(([id]) => {
								const data =
									args.context.droppableContainers.get(id)?.data.current;
								const source = args.context.active?.data.current;
								return (
									data?.kind === source?.kind &&
									(source?.kind === "group" ||
										input.canDrop?.(source?.itemId, data?.section) !== false)
								);
							})
						),
					},
				}),
			keyboardCodes: {
				start: ["Space"],
				cancel: ["Escape"],
				end: ["Space", "Enter"],
			},
		})
	);
	const [preview, setPreview] = useState<HTMLElement | null>(null);
	const [dropping, setDropping] = useState(false);
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
			autoScroll={{
				enabled: !dropping,
				interval: 16,
				acceleration: 8,
				threshold: { x: 0, y: 0.12 },
				layoutShiftCompensation: false,
			}}
			cancelDrop={async ({ active, collisions }) => {
				setDropping(true);
				const target = collisions?.[0]?.data?.target as
					| SidebarDropTarget
					| undefined;
				if (!target) {
					return true;
				}
				const source = active.data.current;
				const order = source?.sortable?.items as string[] | undefined;
				const sourceIndex = order?.indexOf(String(active.id)) ?? -1;
				const nextId = target.beforeId
					? `${target.kind}:${target.beforeId}`
					: undefined;
				if (
					order &&
					sourceIndex >= 0 &&
					(target.kind === "group" || source?.section === target.section) &&
					order[sourceIndex + 1] === nextId
				) {
					return true;
				}
				settling.current = reduced
					? []
					: Array.from(
							surface.current?.querySelectorAll<HTMLElement>(
								`[data-sidebar-drag-kind="${target.kind}"]`
							) ?? []
						)
							.filter((node) => node !== active.data.current?.node?.current)
							.map((node) => ({ node, top: node.getBoundingClientRect().top }));
				if (target.kind === "group") {
					input.onMoveGroup?.(active.data.current?.itemId, target.beforeId);
				} else {
					await input.onMove(
						target.section,
						active.data.current?.itemId,
						target.beforeId
					);
				}
				// Let the existing optimistic preference update settle before dnd-kit
				// measures the real destination for its drop animation.
				await nextFrame();
				await nextFrame();
				settling.current = [];
				return false;
			}}
			collisionDetection={sidebarCollisionDetection(input.canDrop)}
			onDragCancel={() => {
				setPreview(null);
				setDropping(false);
			}}
			onDragEnd={() => {
				setPreview(null);
				setDropping(false);
			}}
			onDragStart={({ active }) => {
				const node = active.data.current?.node?.current as
					| HTMLElement
					| undefined;
				if (node) {
					const clone = node.cloneNode(true) as HTMLElement;
					clone.style.opacity = "1";
					clone.style.transform = "none";
					clone.removeAttribute("id");
					for (const child of clone.querySelectorAll("[id]")) {
						child.removeAttribute("id");
					}
					setPreview(clone);
				}
			}}
			sensors={sensors}
		>
			<GroupDragContext.Provider value={input.groupIds ?? []}>
				<SortableContext
					items={(input.groupIds ?? []).map((id) => `group:${id}`)}
					strategy={stationaryStrategy}
				>
					<div className="contents" ref={surface}>
						{input.children}
					</div>
				</SortableContext>
			</GroupDragContext.Provider>
			<SidebarInsertionLine />
			<DragOverlay
				dropAnimation={
					reduced
						? null
						: {
								duration: 160,
								easing: "cubic-bezier(0.22, 1, 0.36, 1)",
								sideEffects: defaultDropAnimationSideEffects({
									styles: { active: { opacity: "0" } },
								}),
							}
				}
				transition={reduced ? "none" : undefined}
			>
				{preview ? <SidebarDragPreview node={preview} /> : null}
			</DragOverlay>
		</DndContext>
	);
}

function SidebarDragPreview({ node }: { node: HTMLElement }) {
	const Container = node.tagName === "LI" ? "ul" : "div";
	const ref = useCallback(
		(container: HTMLElement | null) => {
			if (container) {
				container.replaceChildren(node);
			}
		},
		[node]
	);
	return (
		<Container
			aria-hidden="true"
			className="pointer-events-none rounded-md bg-sidebar text-sidebar-foreground shadow-sm [&_*]:pointer-events-none"
			inert
			ref={ref}
		/>
	);
}

function SidebarInsertionLine() {
	const { active, collisions } = useDndContext();
	const target = collisions?.[0]?.data?.target as SidebarDropTarget | undefined;
	if (!(active && target)) {
		return null;
	}
	return createPortal(
		<div
			aria-hidden="true"
			className="pointer-events-none fixed z-[1000] h-0.5 rounded-full bg-sidebar-ring"
			data-before-id={target.beforeId}
			data-drop-section={target.section}
			data-sidebar-drop-indicator={target.kind}
			style={{
				left: target.left + 4,
				top: target.top - 1,
				width: Math.max(0, target.width - 8),
			}}
		/>,
		document.body
	);
}

export function SidebarDropSection(input: {
	section: string;
	ids: readonly string[];
	children: ReactNode;
}) {
	const { setNodeRef } = useDroppable({
		id: `section:${input.section}`,
		data: { kind: "section", section: input.section },
	});
	return (
		<div className="min-h-9" ref={setNodeRef}>
			<SortableContext
				items={input.ids.map((id) => `item:${id}`)}
				strategy={stationaryStrategy}
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
	kind?: "item" | "group";
}) {
	const { section } = input;
	const node = useRef<HTMLElement | null>(null);
	const { setNodeRef, attributes, listeners, isDragging } = useSortable({
		id: `${input.kind ?? "item"}:${input.itemId}`,
		disabled: { draggable: input.disabled, droppable: input.disabled },
		data: {
			node,
			kind: input.kind ?? "item",
			section,
			itemId: input.itemId,
			name: input.name,
		},
		strategy: stationaryStrategy,
	});
	// The preview reuses the rendered row, including avatars, status and density.
	const ref = useCallback(
		(element: HTMLElement | null) => {
			node.current = element;
			if (element) {
				element.dataset.sidebarDragKind = input.kind ?? "item";
			}
			setNodeRef(element);
		},
		[setNodeRef, input.kind]
	);
	const description = attributes["aria-describedby"];
	return useMemo(
		() => ({
			ref,
			style: {
				opacity: isDragging ? 0.3 : 1,
			},
			rowProps: {
				...listeners,
				"aria-describedby": input.disabled ? undefined : description,
				"aria-roledescription": input.disabled
					? undefined
					: `sortable ${input.kind ?? "item"}`,
			},
		}),
		[ref, isDragging, listeners, description, input.disabled, input.kind]
	);
}

export function useSortableSidebarGroup(id: string | undefined, name: string) {
	const ids = useContext(GroupDragContext);
	return useSortableSidebarItem({
		section: "groups",
		itemId: id ?? "",
		name,
		kind: "group",
		disabled: !(id && ids.includes(id)),
	});
}
