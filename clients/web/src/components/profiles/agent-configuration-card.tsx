"use client";

import {
	MorphingDialog,
	MorphingDialogClose,
	MorphingDialogContainer,
	MorphingDialogContent,
	MorphingDialogSubtitle,
	MorphingDialogTitle,
	MorphingDialogTrigger,
} from "@openmeld/ui/components/morphing-dialog";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@openmeld/ui/lib/surface-context";
import { cn } from "@openmeld/ui/lib/utils";
import { CheckCircleIcon, PencilSimpleIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

const ATTENTION_TONE_CLASSES = {
	danger: {
		ring: "ring-destructive/55",
		text: "text-destructive",
	},
	warning: {
		ring: "ring-amber-700/45 dark:ring-amber-400/45",
		text: "text-amber-700 dark:text-amber-300",
	},
} as const;

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
	const surface = useSurface() + 2;
	return (
		<SurfaceProvider value={surface}>
			<section
				className={cn(
					"grid min-w-0 content-start gap-4 rounded-md p-4",
					surfaceClasses(surface),
					input.className
				)}
			>
				<div
					className={cn(
						"flex gap-3",
						input.description ? "items-start" : "items-center"
					)}
				>
					<span className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground [&_svg]:size-4">
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
		</SurfaceProvider>
	);
}

export function AgentConfigurationCard(input: {
	actionLabel?: string;
	attention?: boolean;
	attentionTone?: "danger" | "warning";
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
	initialFocus?: () => HTMLElement | boolean | null;
	open?: boolean;
	readOnly?: boolean;
	status?: "idle" | "saving" | "saved";
	summary: string;
	summaryClassName?: string;
	summaryTitle?: string;
}) {
	const surface = useSurface() + 2;
	const attentionClasses = input.attentionTone
		? ATTENTION_TONE_CLASSES[input.attentionTone]
		: null;
	const attentionTextClassName =
		attentionClasses?.text ?? "text-muted-foreground";
	const card = (
		<div
			className={cn(
				"group flex h-full min-h-28 w-full min-w-0 items-start gap-3 rounded-md border border-transparent bg-transparent p-4 text-left",
				input.attention && "ring-1",
				input.attention && (attentionClasses?.ring ?? "ring-primary/45"),
				input.disabled && "cursor-not-allowed opacity-55",
				input.className
			)}
			data-attention={input.attention}
		>
			<span className="grid size-9 shrink-0 place-items-center rounded-md text-muted-foreground [&_svg]:size-4.5">
				{input.icon}
			</span>
			<div className="min-w-0 flex-1">
				<span className="flex min-w-0 items-center justify-between gap-2">
					<span className="font-medium text-muted-foreground text-xs">
						{input.label}
					</span>
					{resolveConfigurationStatus(input.status)}
				</span>
				<TooltipHint content={input.summaryTitle}>
					<span
						className={cn(
							"mt-1 block break-words font-medium text-sm leading-5",
							input.summaryClassName
						)}
					>
						{input.summary}
					</span>
				</TooltipHint>
				{input.description ? (
					<span
						className={cn(
							"mt-1 block text-xs leading-4.5",
							attentionTextClassName
						)}
					>
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
			<AgentConfigurationSurface itemId={input.itemId}>
				{card}
			</AgentConfigurationSurface>
		);
	}
	if (!input.children && input.onClick) {
		return (
			<AgentConfigurationSurface itemId={input.itemId}>
				<button
					aria-label={input.actionLabel ?? `Edit ${input.label}`}
					className="h-full w-full min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					disabled={input.disabled}
					onClick={input.onClick}
					type="button"
				>
					{card}
				</button>
			</AgentConfigurationSurface>
		);
	}

	return (
		<MorphingDialog onOpenChange={input.onOpenChange} open={input.open}>
			<AgentConfigurationSurface
				className="has-[[data-popup-open]]:opacity-0"
				itemId={input.itemId}
			>
				<MorphingDialogTrigger
					aria-label={input.actionLabel ?? `Edit ${input.label}`}
					className="h-full w-full min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					disabled={input.disabled}
					type="button"
				>
					{card}
				</MorphingDialogTrigger>
			</AgentConfigurationSurface>
			<MorphingDialogContainer>
				<MorphingDialogContent
					className={cn(
						surfaceClasses(surface + 1),
						"w-full max-w-md rounded-md p-4 text-popover-foreground"
					)}
					initialFocus={input.initialFocus}
				>
					<SurfaceProvider value={surface + 1}>
						<div
							className={cn(
								"mb-4 flex gap-3 pr-8",
								input.description ? "items-start" : "items-center"
							)}
						>
							<span className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground [&_svg]:size-4">
								{input.icon}
							</span>
							<div className="min-w-0">
								<MorphingDialogTitle className="font-medium text-sm">
									{input.label}
								</MorphingDialogTitle>
								{input.description ? (
									<MorphingDialogSubtitle
										className={cn(
											"mt-0.5 text-xs leading-4.5",
											attentionTextClassName
										)}
									>
										{input.description}
									</MorphingDialogSubtitle>
								) : null}
							</div>
						</div>
						<ScrollArea className="max-h-[calc(100dvh-10rem)]">
							{input.children}
						</ScrollArea>
						<MorphingDialogClose />
					</SurfaceProvider>
				</MorphingDialogContent>
			</MorphingDialogContainer>
		</MorphingDialog>
	);
}

/** A measured/read-only fact shares the dashboard surface, not its edit affordance. */
export function AgentConfigurationReadoutCard(input: {
	itemId: string;
	label: string;
	headerAccessory?: ReactNode;
	children: ReactNode;
}) {
	return (
		<AgentConfigurationSurface itemId={input.itemId}>
			<section
				aria-label={input.label}
				className="h-full min-h-28 min-w-0 rounded-md p-4"
			>
				<div className="flex items-center justify-between gap-2">
					<h3 className="font-medium text-muted-foreground text-xs">
						{input.label}
					</h3>
					{input.headerAccessory}
				</div>
				<div className="mt-3 min-w-0">{input.children}</div>
			</section>
		</AgentConfigurationSurface>
	);
}

function AgentConfigurationSurface(input: {
	itemId: string;
	children: ReactNode;
	className?: string;
}) {
	const surface = useSurface() + 2;
	return (
		<SurfaceProvider value={surface}>
			<FluidCardItem
				className={cn(
					"w-full rounded-md",
					surfaceClasses(surface),
					input.className
				)}
				indicatorClassName="rounded-md bg-interaction-hover"
				itemId={input.itemId}
			>
				{input.children}
			</FluidCardItem>
		</SurfaceProvider>
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
