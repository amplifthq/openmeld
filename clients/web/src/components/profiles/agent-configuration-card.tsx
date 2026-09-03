"use client";

import { Popover } from "@base-ui/react/popover";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { cn } from "@openmeld/ui/lib/utils";
import { CheckCircleIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

export function AgentConfigurationGrid(input: {
	children: ReactNode;
	className?: string;
}) {
	return (
		<FluidCardGroup
			className={cn("grid min-w-0 gap-3 sm:grid-cols-2", input.className)}
		>
			{input.children}
		</FluidCardGroup>
	);
}

export function AgentConfigurationEditorCard(input: {
	children: ReactNode;
	className?: string;
	description?: string;
	icon: ReactNode;
	label: string;
}) {
	return (
		<section
			className={cn(
				"grid min-w-0 content-start gap-4 rounded-2xl border border-border/65 bg-card/35 p-4",
				input.className
			)}
		>
			<div className="flex items-start gap-3">
				<span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 bg-background/80 text-muted-foreground shadow-sm [&_svg]:size-4">
					{input.icon}
				</span>
				<div className="min-w-0">
					<h3 className="font-medium text-sm">{input.label}</h3>
					{input.description ? (
						<p className="mt-0.5 text-muted-foreground text-xs leading-4.5">
							{input.description}
						</p>
					) : null}
				</div>
			</div>
			<div className="min-w-0">{input.children}</div>
		</section>
	);
}

export function AgentConfigurationCard(input: {
	attention?: boolean;
	children?: ReactNode;
	className?: string;
	description?: string;
	disabled?: boolean;
	icon: ReactNode;
	itemId: string;
	label: string;
	inlineContent?: ReactNode;
	onClick?: () => void;
	onOpenChange?: (open: boolean) => void;
	open?: boolean;
	readOnly?: boolean;
	status?: "idle" | "saving" | "saved";
	summary: string;
	summaryClassName?: string;
	summaryTitle?: string;
}) {
	const card = (
		<div
			className={cn(
				"group flex h-full min-h-28 w-full min-w-0 items-start gap-3 rounded-2xl border border-border/65 bg-transparent p-4 text-left shadow-[0_1px_0_rgb(255_255_255/0.025)_inset] transition-colors duration-150 data-[attention=true]:border-primary/45 data-[attention=true]:bg-primary/[0.045]",
				!(input.readOnly || input.disabled) && "hover:border-border",
				input.disabled && "cursor-not-allowed opacity-55",
				input.className
			)}
			data-attention={input.attention}
		>
			<span className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/60 bg-background/80 text-muted-foreground shadow-sm [&_svg]:size-4.5">
				{input.icon}
			</span>
			<div className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center justify-between gap-2">
					<span className="font-medium text-muted-foreground text-xs">
						{input.label}
					</span>
					{resolveConfigurationStatus(input.status)}
				</span>
				<span
					className={cn(
						"mt-1 block break-words font-medium text-sm leading-5",
						input.summaryClassName
					)}
					title={input.summaryTitle}
				>
					{input.summary}
				</span>
				{input.description ? (
					<span className="mt-1 block text-muted-foreground text-xs leading-4.5">
						{input.description}
					</span>
				) : null}
				<AgentConfigurationCardInlineContent>
					{input.inlineContent}
				</AgentConfigurationCardInlineContent>
			</div>
			{input.readOnly || input.disabled ? null : (
				<PencilSimpleIcon
					aria-hidden="true"
					className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
				/>
			)}
		</div>
	);

	if (input.readOnly || !(input.children || input.onClick)) {
		return (
			<FluidCardItem
				className="w-full rounded-2xl bg-card/45"
				indicatorClassName="rounded-2xl bg-muted/35"
				itemId={input.itemId}
			>
				{card}
			</FluidCardItem>
		);
	}
	if (!input.children && input.onClick) {
		return (
			<FluidCardItem
				className="w-full rounded-2xl bg-card/45"
				indicatorClassName="rounded-2xl bg-muted/35"
				itemId={input.itemId}
			>
				<button
					aria-label={`Edit ${input.label}`}
					className="h-full w-full min-w-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					disabled={input.disabled}
					onClick={input.onClick}
					type="button"
				>
					{card}
				</button>
			</FluidCardItem>
		);
	}

	return (
		<Popover.Root onOpenChange={input.onOpenChange} open={input.open}>
			<FluidCardItem
				className="w-full rounded-2xl bg-card/45"
				indicatorClassName="rounded-2xl bg-muted/35"
				itemId={input.itemId}
			>
				<Popover.Trigger
					disabled={input.disabled}
					render={
						<button
							aria-label={`Edit ${input.label}`}
							className="h-full w-full min-w-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
							type="button"
						/>
					}
				>
					{card}
				</Popover.Trigger>
			</FluidCardItem>
			<Popover.Portal>
				<Popover.Positioner
					align="start"
					className="z-50"
					collisionAvoidance={{
						align: "shift",
						fallbackAxisSide: "end",
						side: "flip",
					}}
					collisionPadding={12}
					side="bottom"
					sideOffset={8}
				>
					<Popover.Popup
						className="w-[min(25rem,calc(100vw-1.5rem))] origin-[var(--transform-origin)] rounded-2xl border border-border/75 bg-popover p-4 text-popover-foreground shadow-xl outline-none transition-[opacity,transform] duration-180 ease-[cubic-bezier(0.19,1,0.22,1)] data-[starting-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 data-[ending-style]:duration-100 motion-reduce:transform-none motion-reduce:transition-opacity"
						finalFocus={false}
					>
						<div className="mb-4 flex items-start gap-3">
							<span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/60 bg-background/75 text-muted-foreground [&_svg]:size-4">
								{input.icon}
							</span>
							<div className="min-w-0">
								<p className="font-medium text-sm">{input.label}</p>
								{input.description ? (
									<p className="mt-0.5 text-muted-foreground text-xs leading-4.5">
										{input.description}
									</p>
								) : null}
							</div>
						</div>
						{input.children}
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function AgentConfigurationCardInlineContent(input: { children?: ReactNode }) {
	if (!input.children) {
		return null;
	}
	return <div className="mt-3 min-w-0">{input.children}</div>;
}

function resolveConfigurationStatus(
	status: "idle" | "saving" | "saved" | undefined
) {
	if (status === "saving") {
		return <span className="text-[11px] text-muted-foreground">Saving…</span>;
	}
	if (status === "saved") {
		return (
			<span className="flex items-center gap-1 text-[11px] text-emerald-500">
				<CheckCircleIcon aria-hidden="true" className="size-3" />
				Saved
			</span>
		);
	}
	return null;
}
