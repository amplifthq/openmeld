import { FluidCardItem } from "@openmeld/ui/fluid/card";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

export function AgentCard(input: {
	profileId: string;
	name: string;
	description: string;
	renderAvatar: (size: number) => ReactNode;
	indicators?: ReactNode;
	badge?: ReactNode;
	describedBy?: string;
	to?: string;
	onClick?: () => void;
}) {
	const content = (
		<>
			{input.renderAvatar(56)}
			<span className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center gap-1.5">
					<span
						className="min-w-0 truncate font-medium text-foreground text-sm"
						title={input.name}
					>
						{input.name}
					</span>
					{input.indicators}
				</span>
				<span
					className="mt-0.5 block truncate text-muted-foreground text-xs"
					title={input.description}
				>
					{input.description}
				</span>
			</span>
			{input.badge}
		</>
	);
	const props = {
		"aria-label": `Open ${input.name}`,
		"aria-describedby": input.describedBy,
		"data-profile-id": input.profileId,
		className:
			"relative flex h-24 w-full items-center gap-3 rounded-md p-4 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
		onClick: input.onClick,
	};
	return (
		<FluidCardItem className="border border-border" itemId={input.profileId}>
			{input.to ? (
				<Link {...props} to={input.to}>
					{content}
				</Link>
			) : (
				<button {...props} type="button">
					{content}
				</button>
			)}
		</FluidCardItem>
	);
}
