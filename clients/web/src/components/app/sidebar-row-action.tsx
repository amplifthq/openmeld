import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import { SidebarMenuAction } from "@openmeld/ui/fluid/sidebar-menu";
import type { ReactNode } from "react";

export function SidebarRowAction(input: {
	label: string;
	disabled?: boolean;
	onClick: () => void;
	children: ReactNode;
}) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<SidebarMenuAction
						aria-label={input.label}
						className="static size-6"
						disabled={input.disabled}
						onClick={input.onClick}
					/>
				}
			>
				{input.children}
			</TooltipTrigger>
			<TooltipContent>{input.label}</TooltipContent>
		</Tooltip>
	);
}
