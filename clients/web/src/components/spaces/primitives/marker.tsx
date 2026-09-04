import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { cn } from "@openmeld/ui/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

// Source-adapted from shadcn/ui base-lyra marker, shadcn CLI 3.8.5.
// Kept Web-local because Space markers carry product-specific outcome meaning.
export const SPACE_SYSTEM_DIVIDER_CLASS_NAME =
	"before:mr-1 before:h-px before:min-w-0 before:flex-1 before:bg-border after:ml-1 after:h-px after:min-w-0 after:flex-1 after:bg-border";

const markerVariants = cva(
	"group/marker relative flex min-h-4 w-full items-center gap-2 text-left text-muted-foreground text-xs [&_svg:not([class*='size-'])]:size-3.5 [a]:underline [a]:underline-offset-3 [a]:hover:text-foreground",
	{
		variants: {
			variant: {
				border: "border-border border-b pb-2",
				default: "",
				separator: SPACE_SYSTEM_DIVIDER_CLASS_NAME,
			},
		},
	}
);

function Marker({
	className,
	render,
	variant = "default",
	...props
}: useRender.ComponentProps<"div"> & VariantProps<typeof markerVariants>) {
	return useRender({
		defaultTagName: "div",
		props: mergeProps<"div">(
			{
				className: cn(markerVariants({ className, variant })),
			},
			props
		),
		render,
		state: {
			slot: "marker",
			variant,
		},
	});
}

function MarkerIcon({ className, ...props }: ComponentProps<"span">) {
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-3.5 shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
				className
			)}
			data-slot="marker-icon"
			{...props}
		/>
	);
}

function MarkerContent({ className, ...props }: ComponentProps<"span">) {
	return (
		<span
			className={cn(
				"wrap-break-word min-w-0 group-data-[variant=separator]/marker:flex-none group-data-[variant=separator]/marker:text-center *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
				className
			)}
			data-slot="marker-content"
			{...props}
		/>
	);
}

export { Marker, MarkerContent, MarkerIcon, markerVariants };
