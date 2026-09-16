import { Button } from "@openmeld/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	CornersOutIcon,
	MinusIcon,
	PlusIcon,
	SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";

export function DeskTools(input: {
	onReset: () => void;
	onZoomIn: () => void;
	onZoomOut: () => void;
}) {
	const [open, setOpen] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const cancel = () => {
		if (timer.current) {
			clearTimeout(timer.current);
		}
	};
	useEffect(
		() => () => {
			if (timer.current) {
				clearTimeout(timer.current);
			}
		},
		[]
	);
	return (
		// biome-ignore lint/a11y/noNoninteractiveElementInteractions: The toolbar delegates focus and pointer boundaries; all actions remain native buttons.
		<div
			aria-label="Desk tools"
			className="relative"
			onBlur={(event) => {
				if (!event.currentTarget.contains(event.relatedTarget)) {
					cancel();
					setOpen(false);
				}
			}}
			onFocus={() => {
				cancel();
				setOpen(true);
			}}
			onPointerEnter={(event) => {
				if (event.pointerType === "mouse") {
					cancel();
					setOpen(true);
				}
			}}
			onPointerLeave={(event) => {
				if (
					event.pointerType === "mouse" &&
					!event.currentTarget.contains(document.activeElement)
				) {
					timer.current = setTimeout(() => setOpen(false), 250);
				}
			}}
			role="toolbar"
		>
			<Button
				aria-controls="desk-tools"
				aria-expanded={open}
				aria-label="Canvas tools"
				className="border bg-background"
				onClick={() => setOpen(true)}
				size="icon"
				variant="outline"
			>
				<SlidersHorizontalIcon />
			</Button>
			<div
				className={`absolute bottom-full left-1/2 -translate-x-1/2 pb-1 transition-opacity duration-150 motion-reduce:transition-none ${open ? "visible opacity-100" : "pointer-events-none invisible opacity-0"}`}
				id="desk-tools"
				inert={!open}
			>
				<div
					aria-label="Canvas tools"
					aria-orientation="vertical"
					className="flex w-max max-w-[calc(100vw-48px)] flex-col items-start gap-1 rounded-md border bg-background p-1"
					role="toolbar"
				>
					{[
						{ label: "Zoom out", icon: MinusIcon, onClick: input.onZoomOut },
						{ label: "Zoom in", icon: PlusIcon, onClick: input.onZoomIn },
						{
							label: "Restore default view",
							icon: CornersOutIcon,
							onClick: input.onReset,
						},
					].map(({ label, icon: Icon, onClick }) => (
						<Tooltip key={label}>
							<TooltipTrigger
								render={
									<Button
										aria-label={label}
										onClick={onClick}
										size="icon-sm"
										variant="ghost"
									/>
								}
							>
								<Icon />
							</TooltipTrigger>
							<TooltipContent side="right">{label}</TooltipContent>
						</Tooltip>
					))}
				</div>
			</div>
		</div>
	);
}
