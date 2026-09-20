import { Button } from "@openmeld/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	FluidDropdownMenuContent,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import { cn } from "@openmeld/ui/lib/utils";
import { DotsThreeIcon, PushPinIcon } from "@phosphor-icons/react";
import { useState } from "react";

export function DirectoryRowActions(input: {
	name: string;
	pinned: boolean;
	disabled: boolean;
	moveDisabledReason?: string;
	groupId: string;
	groups: readonly { id: string; name: string }[];
	onTogglePinned: () => void;
	onMove: (groupId: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const destinations = input.groups.filter(
		(group) => group.id !== input.groupId
	);
	const pinLabel = `${input.pinned ? "Unpin" : "Pin"} ${input.name}`;
	return (
		<div
			className={cn(
				"flex items-center opacity-0 group-focus-within/directory-row:opacity-100 group-hover/directory-row:opacity-100 [@media(hover:none)]:opacity-100",
				open && "opacity-100"
			)}
		>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							aria-label={pinLabel}
							disabled={input.disabled}
							onClick={input.onTogglePinned}
							size="icon-sm"
							variant="ghost"
						/>
					}
				>
					<PushPinIcon weight={input.pinned ? "fill" : "regular"} />
				</TooltipTrigger>
				<TooltipContent>{pinLabel}</TooltipContent>
			</Tooltip>
			{destinations.length > 0 && (
				<DropdownMenu onOpenChange={setOpen} open={open}>
					<DropdownMenuTrigger
						render={
							<Button
								aria-label={`Move ${input.name} to group`}
								disabled={input.disabled}
								size="icon-sm"
								variant="ghost"
							/>
						}
					>
						<DotsThreeIcon />
					</DropdownMenuTrigger>
					<FluidDropdownMenuContent align="end" className="w-56">
						<p className="px-2 py-1 text-muted-foreground text-xs">
							Move to group
						</p>
						{destinations.map((group, index) => (
							<FluidDropdownMenuItem
								disabled={!!input.moveDisabledReason}
								index={index}
								key={group.id}
								onClick={() => input.onMove(group.id)}
							>
								{group.name}
							</FluidDropdownMenuItem>
						))}
						{input.moveDisabledReason && (
							<p className="px-2 py-1 text-muted-foreground text-xs">
								{input.moveDisabledReason}
							</p>
						)}
					</FluidDropdownMenuContent>
				</DropdownMenu>
			)}
		</div>
	);
}
