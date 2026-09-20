import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@openmeld/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

// Source-adapted from shadcn/ui base-lyra bubble, shadcn CLI 3.8.5.
// The Space variant preserves OpenMeld transcript density and neutral bubbles.
function BubbleGroup({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn("flex min-w-0 flex-col gap-2", className)}
			data-slot="bubble-group"
			{...props}
		/>
	);
}

const bubbleVariants = cva(
	"group/bubble relative flex w-full min-w-0 max-w-full flex-col gap-1 data-[align=end]:self-end group-data-[align=end]/message:self-end",
	{
		defaultVariants: {
			variant: "space",
		},
		variants: {
			variant: {
				destructive:
					"*:data-[slot=bubble-content]:bg-destructive/10 *:data-[slot=bubble-content]:text-destructive dark:*:data-[slot=bubble-content]:bg-destructive/20",
				ghost:
					"border-none *:data-[slot=bubble-content]:rounded-md *:data-[slot=bubble-content]:bg-transparent *:data-[slot=bubble-content]:p-0",
				space: "*:data-[slot=bubble-content]:text-card-foreground",
				spaceHighlighted:
					"*:data-[slot=bubble-content]:border-transparent *:data-[slot=bubble-content]:bg-muted/50",
			},
		},
	}
);

function Bubble({
	align = "start",
	className,
	variant = "space",
	...props
}: ComponentProps<"div"> &
	VariantProps<typeof bubbleVariants> & {
		align?: "start" | "end";
	}) {
	return (
		<div
			className={cn(bubbleVariants({ variant }), className)}
			data-align={align}
			data-slot="bubble"
			data-variant={variant}
			{...props}
		/>
	);
}

function BubbleContent({
	className,
	render,
	...props
}: useRender.ComponentProps<"div">) {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(
					"wrap-break-word w-fit min-w-0 max-w-full border px-3 py-3 text-sm leading-6 group-data-[align=end]/bubble:self-end sm:px-4 [button,a]:outline-none [button,a]:transition-colors [button,a]:focus-visible:border-ring [button,a]:focus-visible:ring-1 [button,a]:focus-visible:ring-ring/50 [button]:text-left",
					className
				),
			},
			props
		),
		render,
		state: {
			slot: "bubble-content",
		},
	});
}

export { Bubble, BubbleContent, BubbleGroup, bubbleVariants };
