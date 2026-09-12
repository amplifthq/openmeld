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
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { surfaceClasses } from "@openmeld/ui/lib/surface-classes";
import { SurfaceProvider, useSurface } from "@openmeld/ui/lib/surface-context";
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
				<div className="flex items-start gap-3">
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
	const card = (
		<div
			className={cn(
				"group flex h-full min-h-28 w-full min-w-0 items-start gap-3 rounded-md border border-transparent bg-transparent p-4 text-left data-[attention=true]:ring-1 data-[attention=true]:ring-primary/45",
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
						<div className="mb-4 flex items-start gap-3 pr-8">
							<span className="grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground [&_svg]:size-4">
								{input.icon}
							</span>
							<div className="min-w-0">
								<MorphingDialogTitle className="font-medium text-sm">
									{input.label}
								</MorphingDialogTitle>
								{input.description ? (
									<MorphingDialogSubtitle className="mt-0.5 text-muted-foreground text-xs leading-4.5">
										{input.description}
									</MorphingDialogSubtitle>
								) : null}
							</div>
						</div>
						<div className="max-h-[calc(100dvh-10rem)] overflow-y-auto">
							{input.children}
						</div>
						<MorphingDialogClose />
					</SurfaceProvider>
				</MorphingDialogContent>
			</MorphingDialogContainer>
		</MorphingDialog>
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
