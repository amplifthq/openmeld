import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import {
	ArrowLeftIcon,
	CaretDownIcon,
	FileTextIcon,
	ListChecksIcon,
	NotePencilIcon,
} from "@phosphor-icons/react";
import { useRef } from "react";
import type { SpaceView } from "./space-view";

const RESOURCES = [
	{ icon: ListChecksIcon, label: "Tasks", view: "tasks" },
	{ icon: FileTextIcon, label: "Files", view: "files" },
	{ icon: NotePencilIcon, label: "Guide", view: "guide" },
] as const;

export function SpaceResourcesMenu(input: {
	activeView: SpaceView;
	onViewChange: (view: SpaceView) => void;
}) {
	const menuTrigger = useRef<HTMLButtonElement>(null);
	return (
		<div className="flex shrink-0 items-center gap-1">
			{input.activeView !== "messages" ? (
				<Button
					aria-label="Back to messages"
					onClick={() => {
						input.onViewChange("messages");
						menuTrigger.current?.focus();
					}}
					size="icon-sm"
					type="button"
					variant="ghost"
				>
					<ArrowLeftIcon aria-hidden="true" />
				</Button>
			) : null}
			<DropdownMenu>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label="Space resources"
							ref={menuTrigger}
							size="sm"
							type="button"
							variant="ghost"
						>
							<FileTextIcon aria-hidden="true" className="sm:hidden" />
							<span className="hidden sm:inline">Resources</span>
							<CaretDownIcon aria-hidden="true" className="hidden sm:block" />
						</Button>
					}
				/>
				<FluidDropdownMenuContent
					align="end"
					className="min-w-40"
					sideOffset={8}
				>
					{RESOURCES.map(({ icon: Icon, label, view }, index) => (
						<FluidDropdownMenuItem
							aria-current={input.activeView === view ? "true" : undefined}
							index={index}
							key={view}
							onClick={() => input.onViewChange(view)}
						>
							<Icon aria-hidden="true" />
							{label}
						</FluidDropdownMenuItem>
					))}
				</FluidDropdownMenuContent>
			</DropdownMenu>
		</div>
	);
}
