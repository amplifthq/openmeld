import { cn } from "@openmeld/ui/lib/utils";
import type { ComponentProps } from "react";

// Source-adapted from shadcn/ui base-lyra message, shadcn CLI 3.8.5.
// Kept Web-local for the Spaces transcript surface.
function MessageGroup({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn("flex min-w-0 flex-col gap-1.5", className)}
			data-slot="message-group"
			{...props}
		/>
	);
}

function Message({
	align = "start",
	className,
	...props
}: ComponentProps<"div"> & { align?: "start" | "end" }) {
	return (
		<div
			className={cn(
				"group/message relative flex w-full min-w-0 gap-1.5 text-xs data-[align=end]:flex-row-reverse",
				className
			)}
			data-align={align}
			data-slot="message"
			{...props}
		/>
	);
}

function MessageAvatar({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"flex w-fit min-w-8 shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted group-has-data-[slot=message-footer]/message:-translate-y-8",
				className
			)}
			data-slot="message-avatar"
			{...props}
		/>
	);
}

function MessageContent({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"wrap-break-word flex w-full min-w-0 flex-col gap-2 group-data-[align=end]/message:*:data-slot:self-end",
				className
			)}
			data-slot="message-content"
			{...props}
		/>
	);
}

function MessageHeader({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"mb-1.5 flex min-w-0 max-w-full items-center px-2.5 font-medium text-muted-foreground text-xs group-has-data-[variant=ghost]/message:px-0",
				className
			)}
			data-slot="message-header"
			{...props}
		/>
	);
}

function MessageFooter({ className, ...props }: ComponentProps<"div">) {
	return (
		<div
			className={cn(
				"flex min-w-0 max-w-full items-center px-2.5 font-medium text-muted-foreground text-xs group-has-data-[variant=ghost]/message:px-0 group-data-[align=end]/message:justify-end",
				className
			)}
			data-slot="message-footer"
			{...props}
		/>
	);
}

export {
	Message,
	MessageAvatar,
	MessageContent,
	MessageFooter,
	MessageGroup,
	MessageHeader,
};
