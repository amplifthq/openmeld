"use client";

import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	SharedLayoutGroup,
	SharedLayoutItem,
} from "@openmeld/ui/fluid/shared-layout-group";
import { cn } from "@openmeld/ui/lib/utils";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

const HOME_LIST_SKELETON_IDS = ["first", "second", "third"] as const;

export function OrganizationHomeSection(input: {
	children: ReactNode;
	className?: string;
	headingLevel?: 2 | 3;
	title: string;
}) {
	const sectionId = `organization-home-${input.title.toLowerCase().replace(" ", "-")}`;
	const Heading = input.headingLevel === 3 ? "h3" : "h2";
	return (
		<section
			aria-labelledby={sectionId}
			className={cn("grid gap-3", input.className)}
		>
			<Heading
				className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]"
				id={sectionId}
			>
				{input.title}
			</Heading>
			{input.children}
		</section>
	);
}

export function OrganizationHomePanel(input: {
	children: ReactNode;
	className?: string;
	href: string;
	status?: ReactNode;
	title: string;
}) {
	return (
		<Card className={cn("min-w-0 gap-0 rounded-lg py-0", input.className)}>
			<CardHeader className="flex min-h-12 flex-row items-center gap-3 border-border/70 border-b px-4 py-3">
				<CardTitle className="min-w-0 flex-1 truncate text-sm">
					{input.title}
				</CardTitle>
				{input.status ? (
					<span className="shrink-0 text-muted-foreground text-xs">
						{input.status}
					</span>
				) : null}
				<Link
					aria-label={`Open ${input.title}`}
					className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground outline-none transition-colors duration-100 hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
					to={input.href}
				>
					<ArrowRightIcon aria-hidden="true" className="size-3.5" />
				</Link>
			</CardHeader>
			<CardContent className="min-w-0 p-2">{input.children}</CardContent>
		</Card>
	);
}

export function OrganizationHomeList(input: { children: ReactNode }) {
	return (
		<SharedLayoutGroup>
			<ul className="divide-y divide-border/70 overflow-hidden rounded-md">
				{input.children}
			</ul>
		</SharedLayoutGroup>
	);
}

export function OrganizationHomeListItem(input: {
	href: string;
	icon: ReactNode;
	iconPresentation?: "bare" | "framed";
	itemId: string;
	meta?: ReactNode;
	title: string;
}) {
	return (
		<li>
			<SharedLayoutItem itemId={input.itemId}>
				<Link
					className="flex min-h-14 min-w-0 items-center gap-3 rounded-md px-2.5 py-2 outline-none transition-colors duration-100 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset motion-reduce:transition-none"
					to={input.href}
				>
					{input.iconPresentation === "bare" ? (
						input.icon
					) : (
						<span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-md border border-border/70 bg-background text-muted-foreground">
							{input.icon}
						</span>
					)}
					<span className="min-w-0 flex-1">
						<span className="block truncate font-medium text-foreground text-sm">
							{input.title}
						</span>
						{input.meta ? (
							<span className="mt-0.5 block truncate text-muted-foreground text-xs">
								{input.meta}
							</span>
						) : null}
					</span>
					<ArrowRightIcon
						aria-hidden="true"
						className="size-3.5 shrink-0 text-muted-foreground/60"
					/>
				</Link>
			</SharedLayoutItem>
		</li>
	);
}

export function OrganizationHomeListSkeleton() {
	return (
		<div aria-busy="true" className="divide-y divide-border/70">
			<span className="sr-only">Loading</span>
			{HOME_LIST_SKELETON_IDS.map((id) => (
				<div className="flex min-h-14 items-center gap-3 px-2.5 py-2" key={id}>
					<Skeleton className="size-8 shrink-0 motion-reduce:animate-none" />
					<Skeleton className="h-3.5 w-1/2 motion-reduce:animate-none" />
				</div>
			))}
		</div>
	);
}

export function OrganizationHomeEmpty(input: {
	actionHref?: string;
	actionLabel?: string;
	icon: ReactNode;
	label: string;
}) {
	return (
		<div className="grid min-h-36 place-items-center px-5 py-6 text-center">
			<div>
				<span className="mx-auto grid size-9 place-items-center rounded-md border border-border/70 bg-background text-muted-foreground">
					{input.icon}
				</span>
				<p className="mt-3 text-muted-foreground text-sm">{input.label}</p>
				{input.actionHref && input.actionLabel ? (
					<Link
						className="mt-2 inline-flex items-center gap-1 rounded-sm font-medium text-foreground text-xs outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
						to={input.actionHref}
					>
						{input.actionLabel}
						<ArrowRightIcon aria-hidden="true" className="size-3" />
					</Link>
				) : null}
			</div>
		</div>
	);
}

export function OrganizationHomeError(input: {
	label: string;
	onRetry: () => void;
}) {
	return (
		<div
			className="grid min-h-36 place-items-center px-5 py-6 text-center"
			role="alert"
		>
			<div>
				<p className="text-muted-foreground text-sm">{input.label}</p>
				<button
					className="mt-2 rounded-sm font-medium text-foreground text-xs underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
					onClick={input.onRetry}
					type="button"
				>
					Try again
				</button>
			</div>
		</div>
	);
}
