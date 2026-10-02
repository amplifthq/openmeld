import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { FluidCardItem } from "@openmeld/ui/fluid/card";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useContext, useId } from "react";
import { AgentGroupAvatar, AgentGroupContext } from "./agent-group-context";
import type { AgentCardSelection } from "./agent-list-selection";

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
	selection?: AgentCardSelection;
}) {
	const selectionId = useId();
	const group = useContext(AgentGroupContext);
	const content = (
		<>
			{input.selection && (
				<input
					aria-describedby={input.describedBy}
					aria-label={`Select ${input.name}`}
					checked={input.selection.checked}
					className="size-4 shrink-0 accent-primary"
					disabled={input.selection.disabled}
					id={selectionId}
					onChange={input.selection.onChange}
					type="checkbox"
				/>
			)}
			<AgentGroupAvatar profileId={input.profileId}>
				{input.renderAvatar(56)}
			</AgentGroupAvatar>
			<span className={group ? "w-full min-w-0" : "min-w-0 flex-1"}>
				<span
					className={`flex min-w-0 items-center gap-1.5 ${group ? "justify-center" : ""}`}
				>
					<TooltipHint content={input.name}>
						<span className="min-w-0 truncate font-medium text-foreground text-sm">
							{input.name}
						</span>
					</TooltipHint>
					{input.indicators}
				</span>
				<TooltipHint content={input.description}>
					<span className="mt-0.5 block truncate text-muted-foreground text-xs">
						{input.description}
					</span>
				</TooltipHint>
			</span>
			{input.badge}
		</>
	);
	const props = {
		"aria-label": `${input.selection ? "Select" : "Open"} ${input.name}`,
		"aria-describedby": input.describedBy,
		"data-profile-id": input.profileId,
		className: `relative flex w-full items-center gap-3 rounded-md p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring ${group ? "min-h-36 flex-col text-center" : "h-24 text-left"}`,
		onClick: input.onClick,
	};
	let action = (
		<button {...props} type="button">
			{content}
		</button>
	);
	if (input.to) {
		action = (
			<Link {...props} to={input.to}>
				{content}
			</Link>
		);
	}
	if (input.selection) {
		action = (
			<label
				className={`${props.className} cursor-pointer focus-within:ring-2 focus-within:ring-ring`}
				data-profile-id={input.profileId}
				htmlFor={selectionId}
			>
				{content}
			</label>
		);
	}
	return (
		<FluidCardItem
			className={`border border-border ${input.selection?.checked ? "bg-muted/60" : ""}`}
			itemId={input.profileId}
		>
			{action}
		</FluidCardItem>
	);
}
