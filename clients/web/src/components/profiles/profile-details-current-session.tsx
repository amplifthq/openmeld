"use client";

import { buttonVariants } from "@openmeld/ui/components/button";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowSquareOutIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

export function ProfileDetailsCurrentSession(input: {
	className?: string;
	currentSession: {
		href: string;
		nativeSessionId: string;
		title: string;
	};
}) {
	return (
		<div
			className={cn(
				"flex min-w-0 items-start justify-between gap-3 rounded-md border border-border px-3 py-3",
				input.className
			)}
		>
			<div className="min-w-0 space-y-1">
				<p className="text-muted-foreground text-xs">Current Session</p>
				<p className="break-words font-medium text-sm">
					{input.currentSession.title}
				</p>
				<p className="break-all font-mono text-muted-foreground text-xs">
					{input.currentSession.nativeSessionId}
				</p>
			</div>
			<Link
				className={cn(
					buttonVariants({ size: "sm", variant: "outline" }),
					"shrink-0"
				)}
				to={input.currentSession.href}
			>
				<ArrowSquareOutIcon data-icon="inline-start" />
				View Session
			</Link>
		</div>
	);
}
