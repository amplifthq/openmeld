import { useDndContext } from "@dnd-kit/core";
import { Button } from "@openmeld/ui/components/button";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import {
	Children,
	type ComponentProps,
	useEffect,
	useRef,
	useState,
} from "react";

/** Layout and disclosure only; rows retain navigation, menus and status ownership. */
export function ConversationSidebarMenu({
	pinned,
	updateIndices,
	children,
	...props
}: ComponentProps<typeof FluidNavMenu> & {
	pinned: boolean;
	updateIndices: number[];
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [columns, setColumns] = useState(2);
	const [expanded, setExpanded] = useState(false);
	const { active } = useDndContext();
	useEffect(() => {
		const node = ref.current;
		if (!(node && pinned)) {
			return;
		}
		const sidebar = node.closest('[data-slot="sidebar"]') ?? node;
		const measure = () => {
			const width = sidebar.getBoundingClientRect().width;
			setColumns(Math.max(2, Math.min(4, Math.floor(width / 80))));
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(sidebar);
		return () => observer.disconnect();
	}, [pinned]);
	const items = Children.toArray(children);
	const limit = columns * 2;
	// Expose every drop target while dragging, including pins beyond the fold.
	const open = expanded || !!active;
	const hiddenUpdates = updateIndices.some((index) => index >= limit);
	return (
		<div ref={ref}>
			<FluidNavMenu
				{...props}
				listClassName={
					pinned
						? `grid gap-1 ${{ 2: "grid-cols-2", 3: "grid-cols-3", 4: "grid-cols-4" }[columns]}`
						: undefined
				}
			>
				{pinned && !open ? items.slice(0, limit) : items}
			</FluidNavMenu>
			{pinned && items.length > limit && (
				<Button
					aria-expanded={open}
					className="mt-1 h-7 w-full text-muted-foreground text-xs"
					disabled={!!active}
					onClick={() => setExpanded(!expanded)}
					variant="ghost"
				>
					{open ? "Show less" : `Show ${items.length - limit} more`}
					{!open && hiddenUpdates && (
						<span
							aria-label="Hidden conversations have updates"
							className="status-dot bg-primary"
							role="img"
						/>
					)}
				</Button>
			)}
		</div>
	);
}
