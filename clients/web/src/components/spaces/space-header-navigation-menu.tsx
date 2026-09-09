"use client";

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
import type { Icon } from "@phosphor-icons/react";
import { DotsThreeIcon, InfoIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";

export type SpaceHeaderNavigationMenuItem = {
	icon: Icon;
	label: string;
	to: string;
};

export function SpaceHeaderNavigationMenu(input: {
	ariaLabel: string;
	items: readonly SpaceHeaderNavigationMenuItem[];
	onOpenConversationInformation?: () => void;
}) {
	const navigate = useNavigate();

	return (
		<DropdownMenu>
			<Tooltip>
				<TooltipTrigger
					render={
						<DropdownMenuTrigger
							render={
								<Button
									aria-label={input.ariaLabel}
									size="icon-sm"
									type="button"
									variant="ghost"
								>
									<DotsThreeIcon />
								</Button>
							}
						/>
					}
				/>
				<TooltipContent side="bottom">{input.ariaLabel}</TooltipContent>
			</Tooltip>
			<FluidDropdownMenuContent align="end" className="min-w-52" sideOffset={8}>
				{input.items.map((item, index) => {
					const ItemIcon = item.icon;
					return (
						<FluidDropdownMenuItem
							index={index}
							key={item.label}
							onClick={() => {
								navigate({ to: item.to }).catch((error: unknown) => {
									console.error(
										`Failed to open ${item.label} from the header menu.`,
										error
									);
								});
							}}
						>
							<ItemIcon aria-hidden="true" />
							{item.label}
						</FluidDropdownMenuItem>
					);
				})}
				{input.onOpenConversationInformation ? (
					<FluidDropdownMenuItem
						index={input.items.length}
						onClick={input.onOpenConversationInformation}
					>
						<InfoIcon aria-hidden="true" />
						Chat settings
					</FluidDropdownMenuItem>
				) : null}
			</FluidDropdownMenuContent>
		</DropdownMenu>
	);
}
