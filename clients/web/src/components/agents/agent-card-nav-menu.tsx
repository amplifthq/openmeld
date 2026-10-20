import { FluidCardGroup } from "@openmeld/ui/fluid/card";
import { FluidNavMenu } from "@openmeld/ui/fluid/nav-menu";
import { cn } from "@openmeld/ui/lib/utils";
import type { ComponentProps } from "react";

export const AGENT_CARD_GRID_CLASS_NAME =
	"[&_[data-sidebar=menu]]:grid [&_[data-sidebar=menu]]:gap-3 [&_[data-sidebar=menu]]:md:grid-cols-2 [&_[data-sidebar=menu]]:xl:grid-cols-3";

/**
 * A grid of Agent cards with list navigation semantics. Each card draws its
 * own hover background on its own layer (FluidCardItem); the menu's shared
 * highlight would travel behind the opaque cards and show in the gaps, so it
 * stays off here.
 */
export function AgentCardNavMenu({
	className,
	...props
}: ComponentProps<typeof FluidNavMenu>) {
	return (
		<FluidCardGroup>
			<FluidNavMenu
				activeIndicatorClassName="hidden"
				className={cn(AGENT_CARD_GRID_CLASS_NAME, className)}
				hoverIndicatorClassName="hidden"
				{...props}
			/>
		</FluidCardGroup>
	);
}
