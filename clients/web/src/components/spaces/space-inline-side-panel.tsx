import {
	Sidebar,
	SidebarProvider,
	SidebarRail,
} from "@openmeld/ui/components/sidebar";
import { cn } from "@openmeld/ui/lib/utils";
import {
	Activity,
	type ReactNode,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { widthToPx } from "#/lib/spaces/panel-width-storage";

export function SpaceInlineSidePanelHeader(input: {
	actions?: ReactNode;
	children: ReactNode;
}) {
	return (
		<header
			className="flex h-14 shrink-0 items-center border-border border-b px-4"
			data-slot="space-side-panel-header"
		>
			<div className="flex w-full items-center justify-between gap-2">
				<div className="flex min-w-0 items-baseline gap-2">
					{input.children}
				</div>
				{input.actions ? (
					<div className="flex shrink-0 items-center gap-1">
						{input.actions}
					</div>
				) : null}
			</div>
		</header>
	);
}

export function SpaceInlineSidePanel(input: {
	ariaLabel: string;
	children: ReactNode;
	className?: string;
	id: string;
	maxWidth: string;
	minWidth: string;
	minRemainingWidth?: number;
	onWidthChange: (width: string) => void;
	open: boolean;
	resizeHandleLabel: string;
	width: string;
}) {
	const rootRef = useRef<HTMLDivElement>(null);
	const [availableWidth, setAvailableWidth] = useState<number | null>(null);
	const [isOverlay, setIsOverlay] = useState(false);
	useLayoutEffect(() => {
		const root = rootRef.current;
		const parent = root?.parentElement;
		if (!(root && parent) || input.minRemainingWidth === undefined) {
			return;
		}
		const measure = () => {
			const otherPanelsWidth = Array.from(parent.children).reduce(
				(total, child) =>
					child !== root &&
					child.getAttribute("data-slot") === "sidebar-wrapper"
						? total + child.getBoundingClientRect().width
						: total,
				0
			);
			const remaining = Math.max(0, parent.clientWidth - otherPanelsWidth);
			const reserved = input.minRemainingWidth ?? 0;
			const overlay = remaining < reserved + widthToPx(input.minWidth);
			setIsOverlay(overlay);
			setAvailableWidth(overlay ? remaining : remaining - reserved);
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(parent);
		// The main conversation also resizes when another panel opens or closes.
		for (const child of parent.children) {
			observer.observe(child);
		}
		return () => observer.disconnect();
	}, [input.minRemainingWidth, input.minWidth]);
	const maxWidth =
		availableWidth === null
			? input.maxWidth
			: `${Math.min(widthToPx(input.maxWidth), availableWidth)}px`;
	const minWidth = `${Math.min(widthToPx(input.minWidth), widthToPx(maxWidth))}px`;
	// Only the rendered width is constrained by the viewport; keep the user's
	// wider preference so expanding the window restores their reading layout.
	const width = `${Math.min(widthToPx(input.width), widthToPx(maxWidth))}px`;
	let renderedWidth = availableWidth === null ? input.width : width;
	if (isOverlay && availableWidth !== null) {
		renderedWidth = `${availableWidth}px`;
	}
	return (
		<SidebarProvider
			className={cn(
				"h-full",
				input.className,
				isOverlay && input.open && "absolute inset-y-0 left-0 z-30"
			)}
			collapsedWidth="0rem"
			data-space-panel-overlay={isOverlay && input.open ? "true" : undefined}
			maxWidth={maxWidth}
			minWidth={minWidth}
			onWidthChange={input.onWidthChange}
			open={input.open}
			ref={rootRef}
			side="right"
			width={renderedWidth}
		>
			<Sidebar
				aria-hidden={!input.open}
				aria-label={input.ariaLabel}
				className={cn(
					"h-full overflow-hidden bg-background text-foreground transition-none",
					input.open ? "border-l" : "border-l-0"
				)}
				id={input.id}
				side="right"
				style={{
					width: input.open
						? "min(var(--sidebar-width), 100vw)"
						: "var(--sidebar-width-icon)",
				}}
			>
				<Activity mode={input.open ? "visible" : "hidden"}>
					<div className="flex h-full min-h-0 min-w-0 flex-col">
						{input.children}
					</div>
				</Activity>
				{input.open && !isOverlay && (
					<SidebarRail
						className="transition-colors motion-reduce:transition-none"
						enableToggle={false}
						nested
						separatorLabel={input.resizeHandleLabel}
					/>
				)}
			</Sidebar>
		</SidebarProvider>
	);
}
