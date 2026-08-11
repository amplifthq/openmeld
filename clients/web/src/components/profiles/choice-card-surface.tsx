import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { cn } from "@openmeld/ui/lib/utils";
import type { ReactNode } from "react";

// Shared visual primitives for route-free "create profile" surfaces.
export const selectedChoiceSurfaceClassName =
	"border-border bg-muted/10 ring-2 ring-foreground/30 ring-inset";

export function SelectedStatusChip() {
	return (
		<span className="rounded-sm border border-foreground bg-foreground px-2 py-0.5 font-medium text-[11px] text-background uppercase">
			Selected
		</span>
	);
}

export function ChoiceCardSurface(input: {
	title: string;
	description: string;
	className?: string;
	action?: ReactNode;
}) {
	return (
		<Card
			className={cn(
				"relative h-full min-h-44 w-full justify-center gap-0 py-0 transition-colors hover:bg-muted/20",
				input.className
			)}
		>
			{input.action ? (
				<div className="absolute top-4 right-4 z-10">{input.action}</div>
			) : null}
			<CardHeader className="gap-3 text-left">
				<div className="w-full min-w-0 space-y-2 text-left">
					<CardTitle className="text-balance text-left text-foreground text-lg">
						{input.title}
					</CardTitle>
					<CardDescription className="w-full text-pretty text-left text-muted-foreground text-sm">
						{input.description}
					</CardDescription>
				</div>
			</CardHeader>
		</Card>
	);
}
