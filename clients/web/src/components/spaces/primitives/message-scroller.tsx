import { Button } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowDownIcon } from "@phosphor-icons/react";
import { MessageScroller as MessageScrollerPrimitive } from "@shadcn/react/message-scroller";
import type { ComponentProps } from "react";

// Source-adapted from shadcn/ui base-lyra message-scroller, shadcn CLI 3.8.5.
// Wraps @shadcn/react@0.2.1 while keeping the Spaces class and DOM contract local.
function MessageScrollerProvider(
	props: ComponentProps<typeof MessageScrollerPrimitive.Provider>
) {
	return <MessageScrollerPrimitive.Provider {...props} />;
}

function MessageScroller({
	className,
	...props
}: ComponentProps<typeof MessageScrollerPrimitive.Root>) {
	return (
		<MessageScrollerPrimitive.Root
			className={cn(
				"group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden",
				className
			)}
			data-slot="message-scroller"
			{...props}
		/>
	);
}

function MessageScrollerViewport({
	className,
	...props
}: ComponentProps<typeof MessageScrollerPrimitive.Viewport>) {
	return (
		<MessageScrollerPrimitive.Viewport
			className={cn(
				"data-autoscrolling:scrollbar-thumb-transparent data-autoscrolling:scrollbar-track-transparent size-full min-h-0 min-w-0 overflow-y-auto overscroll-contain contain-content",
				className
			)}
			data-slot="message-scroller-viewport"
			{...props}
		/>
	);
}

function MessageScrollerContent({
	className,
	...props
}: ComponentProps<typeof MessageScrollerPrimitive.Content>) {
	return (
		<MessageScrollerPrimitive.Content
			className={cn("flex h-max min-h-full flex-col gap-6", className)}
			data-slot="message-scroller-content"
			{...props}
		/>
	);
}

function MessageScrollerItem({
	className,
	scrollAnchor = false,
	...props
}: ComponentProps<typeof MessageScrollerPrimitive.Item>) {
	return (
		<MessageScrollerPrimitive.Item
			className={cn(
				"min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]",
				className
			)}
			data-slot="message-scroller-item"
			scrollAnchor={scrollAnchor}
			{...props}
		/>
	);
}

function MessageScrollerButton({
	children,
	className,
	direction = "end",
	render,
	size = "icon-sm",
	variant = "secondary",
	...props
}: ComponentProps<typeof MessageScrollerPrimitive.Button> &
	Pick<ComponentProps<typeof Button>, "size" | "variant">) {
	return (
		<MessageScrollerPrimitive.Button
			className={cn(
				"absolute inset-s-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity,filter] duration-200 hover:bg-muted hover:text-foreground data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:data-[active=false]:-translate-y-full data-[active=false]:pointer-events-none data-[direction=start]:top-4 data-[direction=end]:bottom-4 data-[active=true]:translate-y-0 data-[active=false]:scale-95 data-[active=true]:scale-100 data-[active=false]:opacity-0 data-[active=true]:opacity-100 data-[active=false]:blur-[6px] data-[active=true]:blur-none data-[active=false]:duration-150 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none motion-reduce:data-[active=false]:blur-none rtl:translate-x-1/2 data-[direction=start]:[&_svg]:rotate-180",
				className
			)}
			data-direction={direction}
			data-size={size}
			data-slot="message-scroller-button"
			data-variant={variant}
			direction={direction}
			render={render ?? <Button size={size} variant={variant} />}
			{...props}
		>
			{children ?? (
				<>
					<ArrowDownIcon aria-hidden="true" />
					<span className="sr-only">
						{direction === "end" ? "Scroll to end" : "Scroll to start"}
					</span>
				</>
			)}
		</MessageScrollerPrimitive.Button>
	);
}

export {
	MessageScroller,
	MessageScrollerButton,
	MessageScrollerContent,
	MessageScrollerItem,
	MessageScrollerProvider,
	MessageScrollerViewport,
};
