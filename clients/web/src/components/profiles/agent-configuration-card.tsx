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
import {
	ArrowUpRightIcon,
	CheckCircleIcon,
	PencilSimpleIcon,
} from "@phosphor-icons/react";
import {
	type ReactNode,
	type RefObject,
	useEffect,
	useRef,
	useState,
} from "react";

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
	actionKind?: "edit" | "open";
	attention?: boolean;
	attentionTone?: "danger" | "warning";
	children?: ReactNode;
	className?: string;
	/**
	 * A value of at most two lines and at most one muted line, so a row of
	 * cards keeps one height; longer text clamps with a tooltip.
	 */
	compact?: boolean;
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
	const ActionIcon =
		input.actionKind === "open" ? ArrowUpRightIcon : PencilSimpleIcon;
	const defaultActionLabel = `${input.actionKind === "open" ? "Open" : "Edit"} ${input.label}`;
	const card = (
		<div
			className={cn(
				"group flex h-full w-full min-w-0 items-start gap-3 rounded-md border border-transparent bg-transparent text-left",
				input.compact ? "min-h-20 p-3.5" : "min-h-28 p-4",
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
				<AgentConfigurationCardValue
					compact={input.compact}
					description={input.description}
					descriptionClassName={attentionTextClassName}
					summary={input.summary}
					summaryClassName={input.summaryClassName}
					summaryTitle={input.summaryTitle}
				/>
				<AgentConfigurationCardInlineContent>
					{input.inlineContent}
				</AgentConfigurationCardInlineContent>
			</div>
			{input.readOnly || input.disabled ? null : (
				<ActionIcon
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
					aria-label={input.actionLabel ?? defaultActionLabel}
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
				// Only the dialog trigger hides the card while its dialog morphs
				// out; a value tooltip also publishes data-popup-open.
				className="has-[[data-configuration-dialog-trigger][data-popup-open]]:opacity-0"
				itemId={input.itemId}
			>
				<MorphingDialogTrigger
					aria-label={input.actionLabel ?? defaultActionLabel}
					className="h-full w-full min-w-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
					data-configuration-dialog-trigger=""
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
	compact?: boolean;
}) {
	return (
		<AgentConfigurationSurface itemId={input.itemId}>
			<section
				aria-label={input.label}
				className={cn(
					"h-full min-w-0 rounded-md",
					input.compact ? "min-h-20 p-3.5" : "min-h-28 p-4"
				)}
			>
				<div className="flex items-center justify-between gap-2">
					<h3 className="font-medium text-muted-foreground text-xs">
						{input.label}
					</h3>
					{input.headerAccessory}
				</div>
				<div className={cn("min-w-0", input.compact ? "mt-2" : "mt-3")}>
					{input.children}
				</div>
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

function AgentConfigurationCardValue(input: {
	compact?: boolean;
	description?: string;
	descriptionClassName: string;
	summary: string;
	summaryClassName?: string;
	summaryTitle?: string;
}) {
	const summaryRef = useRef<HTMLSpanElement>(null);
	const truncated = useTextTruncated(summaryRef, input.summary);
	return (
		<>
			<span className="mt-1 flex min-w-0 items-center gap-2">
				<TooltipHint
					content={
						input.summaryTitle ??
						(input.compact && truncated ? input.summary : undefined)
					}
				>
					<span
						className={cn(
							"block min-w-0 font-medium text-sm leading-5",
							input.compact ? "line-clamp-2 break-words" : "break-words",
							input.summaryClassName
						)}
						ref={summaryRef}
					>
						{input.summary}
					</span>
				</TooltipHint>
			</span>
			{input.description ? (
				<span
					className={cn(
						"mt-1 block text-xs leading-4.5",
						input.compact && "truncate",
						input.descriptionClassName
					)}
					title={input.compact ? input.description : undefined}
				>
					{input.description}
				</span>
			) : null}
		</>
	);
}

/** Whether a clamped value is cut off at the card's current size. */
function useTextTruncated(
	ref: RefObject<HTMLElement | null>,
	text: string
): boolean {
	const [truncated, setTruncated] = useState(false);
	useEffect(() => {
		const element = ref.current;
		// A new value can overflow at the same width, so measure again.
		if (!(element && text)) {
			setTruncated(false);
			return;
		}
		const measure = () =>
			setTruncated(
				element.scrollHeight > element.clientHeight + 1 ||
					element.scrollWidth > element.clientWidth + 1
			);
		measure();
		if (typeof ResizeObserver === "undefined") {
			return;
		}
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref, text]);
	return truncated;
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
