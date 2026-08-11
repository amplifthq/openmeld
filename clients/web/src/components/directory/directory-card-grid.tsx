"use client";

import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { cn } from "@openmeld/ui/lib/utils";
import type { ComponentProps, ReactNode } from "react";

export function DirectoryCardGrid({
	children,
	className,
	...props
}: ComponentProps<typeof FluidCardGroup>) {
	return (
		<FluidCardGroup
			className={cn("grid gap-3 lg:grid-cols-2", className)}
			role="list"
			{...props}
		>
			{children}
		</FluidCardGroup>
	);
}

export function DirectoryCardItem({
	children,
	className,
	...props
}: ComponentProps<typeof FluidCardItem>) {
	return (
		<FluidCardItem className={className} role="listitem" {...props}>
			{children}
		</FluidCardItem>
	);
}

export function DirectoryOwnerGroup(input: {
	children: ReactNode;
	countLabel: string;
	ownerLabel: string;
}) {
	return (
		<section className="flex min-w-0 flex-col gap-2">
			<header className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
				<h2 className="font-medium text-foreground text-sm">
					{input.ownerLabel}
				</h2>
				<p className="text-muted-foreground text-xs">{input.countLabel}</p>
			</header>
			{input.children}
		</section>
	);
}
