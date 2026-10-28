import {
	DropdownMenu,
	DropdownMenuRadioGroup,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuRadioItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import {
	SidebarGroupAction,
	SidebarGroupActions,
} from "@openmeld/ui/fluid/sidebar-group";
import {
	ListIcon,
	SlidersHorizontalIcon,
	SquaresFourIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useBrowserPreference } from "#/lib/use-browser-preference";

export type PinnedLayout = "grid" | "list";

export function usePinnedLayout(profileId: string, organizationId: string) {
	const [saved, setSaved] = useBrowserPreference(
		`openmeld.spaces.pinned-layout:${profileId}:${organizationId}`
	);
	return {
		pinnedLayout: saved === "grid" ? ("grid" as const) : ("list" as const),
		setPinnedLayout: (layout: PinnedLayout) => setSaved(layout),
	};
}

export function PinnedLayoutMenu({
	layout,
	onLayoutChange,
}: {
	layout: PinnedLayout;
	onLayoutChange: (layout: PinnedLayout) => void;
}) {
	const [open, setOpen] = useState(false);
	return (
		<SidebarGroupActions
			className="pointer-events-none static h-6 opacity-0 group-focus-within/sidebar-section:pointer-events-auto group-focus-within/sidebar-section:opacity-100 group-hover/sidebar-section:pointer-events-auto group-hover/sidebar-section:opacity-100 data-open:pointer-events-auto data-open:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
			data-open={open || undefined}
		>
			<DropdownMenu onOpenChange={setOpen} open={open}>
				<Tooltip>
					<TooltipTrigger
						render={
							<DropdownMenuTrigger
								render={<SidebarGroupAction aria-label="Pinned layout" />}
							/>
						}
					>
						<SlidersHorizontalIcon />
					</TooltipTrigger>
					<TooltipContent>Pinned layout</TooltipContent>
				</Tooltip>
				<FluidDropdownMenuContent
					align="end"
					aria-label="Pinned layout"
					className="w-40"
				>
					<p className="px-2 py-1 text-muted-foreground text-xs">Layout</p>
					<DropdownMenuRadioGroup
						onValueChange={(value) => {
							if (value === "grid" || value === "list") {
								onLayoutChange(value);
							}
						}}
						value={layout}
					>
						<FluidDropdownMenuRadioItem index={0} value="grid">
							<SquaresFourIcon aria-hidden="true" />
							Grid
						</FluidDropdownMenuRadioItem>
						<FluidDropdownMenuRadioItem index={1} value="list">
							<ListIcon aria-hidden="true" />
							List
						</FluidDropdownMenuRadioItem>
					</DropdownMenuRadioGroup>
				</FluidDropdownMenuContent>
			</DropdownMenu>
		</SidebarGroupActions>
	);
}
