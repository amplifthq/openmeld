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
	interactiveAvatar?: boolean;
	indicators?: ReactNode;
	/** Short status shown before the description, such as access. */
	meta?: ReactNode;
	badge?: ReactNode;
	describedBy?: string;
	to?: string;
	onClick?: () => void;
	selection?: AgentCardSelection;
}) {
	const selectionId = useId();
	const group = useContext(AgentGroupContext);
	const avatar = (
		<AgentGroupAvatar profileId={input.profileId}>
			{input.renderAvatar(56)}
		</AgentGroupAvatar>
	);
	const details = (
		<>
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
				{input.meta ? (
					<span
						className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs ${group ? "justify-center" : ""}`}
					>
						<span className="max-w-full shrink-0">{input.meta}</span>
						{input.description ? (
							<>
								<span aria-hidden="true">·</span>
								<TooltipHint content={input.description}>
									<span className="min-w-0 truncate">{input.description}</span>
								</TooltipHint>
							</>
						) : null}
					</span>
				) : (
					<TooltipHint content={input.description}>
						<span className="mt-0.5 block truncate text-muted-foreground text-xs">
							{input.description}
						</span>
					</TooltipHint>
				)}
			</span>
			{input.badge}
		</>
	);
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
			{avatar}
			{details}
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
		action = input.interactiveAvatar ? (
			<div className={props.className} data-profile-id={input.profileId}>
				<span className="relative z-10 shrink-0">{avatar}</span>
				<Link
					aria-describedby={input.describedBy}
					aria-label={props["aria-label"]}
					className="flex h-full min-w-0 flex-1 items-center gap-3 outline-none after:absolute after:inset-0 after:rounded-md focus-visible:after:ring-2 focus-visible:after:ring-ring"
					onClick={input.onClick}
					to={input.to}
				>
					{details}
				</Link>
			</div>
		) : (
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
