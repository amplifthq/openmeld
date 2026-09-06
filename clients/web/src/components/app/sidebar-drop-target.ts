import type { ClientRect, CollisionDetection } from "@dnd-kit/core";

type Coordinates = NonNullable<
	Parameters<CollisionDetection>[0]["pointerCoordinates"]
>;

export type SidebarDropTarget = {
	kind: "item" | "group";
	section: string;
	beforeId?: string;
	left: number;
	top: number;
	width: number;
};

/** Stable insertion boundaries: rows never move underneath the pointer. */
export function sidebarCollisionDetection(
	canDrop?: (itemId: string, section: string) => boolean
): CollisionDetection {
	return (args) => {
		const source = args.active.data.current;
		if (!source) {
			return [];
		}
		const point = args.pointerCoordinates ?? {
			x: args.collisionRect.left + args.collisionRect.width / 2,
			y: args.collisionRect.top + 1,
		};
		const viewport = source.node?.current
			?.closest('[data-slot="scroll-area-viewport"]')
			?.getBoundingClientRect() as ClientRect | undefined;
		if (viewport && !containsPoint(viewport, point)) {
			return [];
		}
		const containers = args.droppableContainers.flatMap((container) => {
			const rect = args.droppableRects.get(container.id);
			return rect ? [{ container, rect }] : [];
		});
		const groups = source.kind === "group";
		const sections = containers
			.filter(({ container }) =>
				groups
					? container.data.current?.kind === "group"
					: container.data.current?.kind === "section" &&
						canDrop?.(source.itemId, container.data.current.section) !== false
			)
			.sort((a, b) => a.rect.top - b.rect.top);
		// Section hitboxes stay enabled even when they contain rows.
		const section = hitSection(sections, point, groups);
		if (!section) {
			return [];
		}
		const sectionId = section.container.data.current?.section as string;
		const rows = (
			groups
				? sections
				: containers.filter(
						({ container }) =>
							container.data.current?.kind === "item" &&
							container.data.current.section === sectionId
					)
		).sort((a, b) => a.rect.top - b.rect.top);
		const remaining = rows.filter(
			({ container }) => container.id !== args.active.id
		);
		const before = args.pointerCoordinates
			? remaining.find(({ rect }) => point.y < rect.top + rect.height / 2)
			: keyboardInsertionTarget(
					remaining,
					args.collisionRect.top,
					args.droppableRects.get(args.active.id)?.top
				);
		const last = remaining.at(-1);
		const insertionTop =
			before?.rect.top ?? last?.rect.bottom ?? section.rect.top;
		const target: SidebarDropTarget = {
			kind: groups ? "group" : "item",
			section: sectionId,
			beforeId: before?.container.data.current?.itemId,
			left: section.rect.left,
			width: section.rect.width,
			top: viewport
				? Math.max(
						viewport.top + 1,
						Math.min(viewport.bottom - 1, insertionTop)
					)
				: insertionTop,
		};
		const container = before?.container ?? last?.container ?? section.container;
		return [
			{
				id: container.id,
				data: { droppableContainer: container, value: 1, target },
			},
		];
	};
}

function containsPoint(
	rect: Pick<ClientRect, "top" | "bottom" | "left" | "right">,
	point: Coordinates
) {
	return (
		point.x >= rect.left &&
		point.x <= rect.right &&
		point.y >= rect.top &&
		point.y <= rect.bottom
	);
}

function hitSection<T extends { rect: ClientRect }>(
	sections: readonly T[],
	point: Coordinates,
	groups: boolean
) {
	const first = sections[0];
	const last = sections.at(-1);
	if (!(first && last)) {
		return undefined;
	}
	return sections.find(({ rect }) =>
		containsPoint(
			groups
				? {
						left: rect.left,
						right: rect.right,
						top: first.rect.top,
						bottom: last.rect.bottom,
					}
				: rect,
			point
		)
	);
}

/** Keyboard coordinates identify a row, not a pointer's upper/lower half. */
function keyboardInsertionTarget<T extends { rect: { top: number } }>(
	rows: readonly T[],
	top: number,
	sourceTop: number | undefined
) {
	if (!rows.length) {
		return undefined;
	}
	const anchor = rows.reduce((nearest, entry) =>
		Math.abs(entry.rect.top - top) < Math.abs(nearest.rect.top - top)
			? entry
			: nearest
	);
	return sourceTop !== undefined && anchor.rect.top < sourceTop
		? anchor
		: rows[rows.indexOf(anchor) + 1];
}

export function moveSidebarGroup<T extends { id: string }>(
	groups: readonly T[],
	id: string,
	beforeId?: string
): T[] {
	const group = groups.find((entry) => entry.id === id);
	if (!group || beforeId === id) {
		return [...groups];
	}
	const next = groups.filter((entry) => entry.id !== id);
	const index = beforeId
		? next.findIndex((entry) => entry.id === beforeId)
		: -1;
	next.splice(index < 0 ? next.length : index, 0, group);
	return next;
}
